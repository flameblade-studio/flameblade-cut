/**
 * Main-process voiceover (text-to-speech) for Flameblade Cut.
 *
 * Three engines produce one WAV file per request under `<userData>/voiceover/`:
 *
 * - `windows`: Windows OneCore (`Windows.Media.SpeechSynthesis`) through
 *   `powershell.exe -EncodedCommand`. SAPI is deliberately NOT used: it cannot
 *   see OneCore-only voices such as zh-TW "Microsoft Yating". Ported from the
 *   proven MoHan recipe (`integrations/speech_windows_synthesis.py`,
 *   `_onecore_command`). No speaking rate is applied unless the caller asks.
 * - `azure`: Azure Speech REST (`/cognitiveservices/v1`, SSML).
 * - `openai`: OpenAI `POST /v1/audio/speech`.
 *
 * Secrets: Azure/OpenAI keys are read here from the encrypted KeyStore and
 * never leave the main process. They are never logged, never copied into an
 * error message (response excerpts are redacted), and never written to disk.
 *
 * Composition: `createVoiceService(deps)` is pure and testable (base URLs,
 * fetch, key lookup, PowerShell runner and output folder are injected);
 * `registerVoiceIpc()` wires it to Electron.
 */
import { app } from "electron";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { handle } from "./index";
import { getKeyStore } from "./keychain";
import {
  CHANNELS,
  VOICE_KEY_IDS,
  voiceListArgsSchema,
  voiceSynthesizeArgsSchema,
} from "../../shared/ipc-contract";
import type {
  VoiceEngine,
  VoiceInfo,
  VoiceKeyStatus,
  VoiceListArgs,
  VoiceSynthesizeArgs,
  VoiceSynthesizeResult,
} from "../../shared/ipc-contract";

export const POWERSHELL_TIMEOUT_MS = 120_000;
const HTTP_TIMEOUT_MS = 60_000;
const ERROR_EXCERPT_CHARS = 300;
const USER_AGENT = "FlamebladeCut-Voiceover/1.0";

/**
 * OpenAI speech models and voices, verified 2026-10-12 against
 * https://developers.openai.com/api/docs/guides/text-to-speech and
 * https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
 * (models: tts-1, tts-1-hd, gpt-4o-mini-tts, gpt-4o-mini-tts-2025-12-15;
 * `instructions` "does not work with tts-1 or tts-1-hd"; input max 4096 chars;
 * the guide recommends `marin` or `cedar` for best quality).
 */
export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
export const OPENAI_MAX_INPUT_CHARS = 4096;
export const OPENAI_VOICES = [
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
] as const;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type VoiceErrorCode =
  | "missing-key"
  | "invalid-region"
  | "unsupported-platform"
  | "voice-missing"
  | "engine-failed"
  | "timeout"
  | "http"
  | "bad-audio"
  | "too-long";

/**
 * The message starts with `[voice:<code>]` so the renderer can localize it:
 * Electron flattens IPC errors to "Error invoking remote method ...: <message>".
 */
export class VoiceError extends Error {
  constructor(
    readonly code: VoiceErrorCode,
    detail: string,
  ) {
    super(`[voice:${code}] ${detail}`);
    this.name = "VoiceError";
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** "zh-TW-HsiaoChenNeural" -> "zh-TW"; falls back to en-US. */
export function azureVoiceLocale(voice: string): string {
  const match = /^([a-z]{2,3}-[A-Za-z]{2,4}(?:-[A-Za-z]{2,4})?)-[A-Za-z0-9]+$/.exec(voice);
  return match?.[1] ?? "en-US";
}

/** Azure prosody rate as a signed percentage ("+20%"), or null for natural speed. */
function azureRate(rate: number | undefined): string | null {
  if (rate === undefined || rate === 1) return null;
  const percent = Math.round((rate - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

export function buildAzureSsml(text: string, voice: string, rate?: number): string {
  const locale = azureVoiceLocale(voice);
  const body = escapeXml(text);
  const prosody = azureRate(rate);
  const spoken = prosody ? `<prosody rate="${prosody}">${body}</prosody>` : body;
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(locale)}">` +
    `<voice name="${escapeXml(voice)}">${spoken}</voice></speak>`
  );
}

const AZURE_REGION = /^[a-z0-9]{2,40}$/;

/** The region becomes a host name label, so only plain lowercase letters/digits are accepted. */
export function azureBaseUrl(region: string | undefined): string {
  const value = (region ?? "").trim().toLowerCase();
  if (!AZURE_REGION.test(value)) {
    throw new VoiceError("invalid-region", "Azure region must be a plain region name such as eastasia.");
  }
  return `https://${value}.tts.speech.microsoft.com`;
}

function utf8Base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/** PowerShell `-EncodedCommand` payload: base64 of UTF-16LE script text. */
function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

const POWERSHELL_PRELUDE =
  "$ErrorActionPreference='Stop';" +
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime;" +
  "$null=[Windows.Media.SpeechSynthesis.SpeechSynthesizer," +
  "Windows.Media.SpeechSynthesis,ContentType=WindowsRuntime];" +
  "$null=[Windows.Storage.Streams.DataReader," +
  "Windows.Storage.Streams,ContentType=WindowsRuntime];";

/**
 * Builds the OneCore synthesis command. The text is read from a UTF-8 file
 * (not embedded) because a 5000-character text would exceed the 32767-char
 * Windows command-line limit once base64-encoded twice. Every value is
 * base64-encoded so no quoting of user text is ever needed.
 */
export function onecoreSynthesisCommand(args: {
  textPath: string;
  voice: string;
  outputPath: string;
  missingVoiceMessage: string;
  rate?: number;
}): string {
  const rate =
    args.rate === undefined || args.rate === 1
      ? ""
      : `$synth.Options.SpeakingRate=[double]${Number(args.rate).toFixed(2)};`;
  const script =
    POWERSHELL_PRELUDE +
    "function Await($Operation,$ResultType){" +
    "$method=[System.WindowsRuntimeSystemExtensions].GetMethods()|" +
    "Where-Object{$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and " +
    "$_.GetGenericArguments().Count -eq 1 -and " +
    "$_.GetParameters().Count -eq 1}|Select-Object -First 1;" +
    "$task=$method.MakeGenericMethod($ResultType).Invoke($null,@($Operation));" +
    "$task.Wait();$task.Result};" +
    `$textPath=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${utf8Base64(args.textPath)}'));` +
    `$voiceName=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${utf8Base64(args.voice)}'));` +
    `$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${utf8Base64(args.outputPath)}'));` +
    `$missingVoice=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${utf8Base64(args.missingVoiceMessage)}'));` +
    "$text=[IO.File]::ReadAllText($textPath,[Text.Encoding]::UTF8);" +
    "$synth=[Windows.Media.SpeechSynthesis.SpeechSynthesizer]::new();" +
    "$voice=[Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices|" +
    "Where-Object{$_.DisplayName -eq $voiceName -or $_.Id -eq $voiceName}|" +
    "Select-Object -First 1;" +
    "if(-not $voice){throw $missingVoice};" +
    "$synth.Voice=$voice;" +
    rate +
    "$stream=Await ($synth.SynthesizeTextToStreamAsync($text)) " +
    "([Windows.Media.SpeechSynthesis.SpeechSynthesisStream]);" +
    "$reader=[Windows.Storage.Streams.DataReader]::new($stream);" +
    "$null=Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]);" +
    "$bytes=New-Object byte[] ([int]$stream.Size);" +
    "$reader.ReadBytes($bytes);" +
    "[IO.File]::WriteAllBytes($path,$bytes);" +
    '$metadata=("{0}`n{1}" -f $voice.DisplayName,$voice.Id);' +
    "$reader.Dispose();$stream.Dispose();$synth.Dispose();" +
    "[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($metadata)));";
  return encodePowerShell(script);
}

/** Lists OneCore voices as base64(UTF-8 JSON) on stdout. */
export function onecoreListCommand(): string {
  const script =
    POWERSHELL_PRELUDE +
    "$list=@([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices|ForEach-Object{" +
    "[pscustomobject]@{id=$_.Id;name=$_.DisplayName;language=$_.Language;gender=[string]$_.Gender}});" +
    "$json=ConvertTo-Json -InputObject $list -Compress;" +
    "[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)));";
  return encodePowerShell(script);
}

export interface WavInfo {
  /** The WAV with RIFF and data sizes corrected to the actual byte count. */
  bytes: Uint8Array;
  durationSec: number;
}

/**
 * Validates a PCM WAV and returns its duration. Streamed WAVs (OpenAI) can
 * carry placeholder sizes (0xFFFFFFFF); those are rewritten to the real size
 * so every decoder accepts the file.
 */
export function normalizeWav(input: Uint8Array): WavInfo {
  const bytes = new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new VoiceError("bad-audio", "The engine did not return a WAV file.");
  }
  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset);
    const declared = view.getUint32(offset + 4, true);
    const bodyStart = offset + 8;
    if (id === "fmt ") {
      byteRate = view.getUint32(bodyStart + 8, true);
    } else if (id === "data") {
      const available = bytes.byteLength - bodyStart;
      const size = declared > available ? available : declared;
      if (byteRate <= 0) throw new VoiceError("bad-audio", "WAV has no format chunk.");
      view.setUint32(offset + 4, size, true);
      view.setUint32(4, bodyStart + size - 8, true);
      const end = bodyStart + size;
      return { bytes: end === bytes.byteLength ? bytes : bytes.slice(0, end), durationSec: size / byteRate };
    }
    offset = bodyStart + declared + (declared % 2);
  }
  throw new VoiceError("bad-audio", "WAV has no data chunk.");
}

function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("***") : text;
}

// ---------------------------------------------------------------------------
// PowerShell runner
// ---------------------------------------------------------------------------

export interface PowerShellResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type PowerShellRunner = (encodedCommand: string, timeoutMs: number) => Promise<PowerShellResult>;

/** Runs `powershell.exe -NoProfile -EncodedCommand` hidden, killing it after `timeoutMs`. */
export const runPowerShell: PowerShellRunner = (encodedCommand, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new VoiceError("engine-failed", `Windows speech could not start: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new VoiceError("timeout", `Windows speech timed out after ${timeoutMs / 1000} s.`));
        return;
      }
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface VoiceServiceDeps {
  /** Reads a secret from the encrypted KeyStore. */
  getKey(id: string): Promise<string | null>;
  /** Folder that receives the generated WAV files. */
  outputDir(): string;
  platform: NodeJS.Platform;
  runPowerShell: PowerShellRunner;
  fetch: typeof globalThis.fetch;
  /** Test seams only; production uses the real hosts. */
  azureBaseUrl?: (region: string | undefined) => string;
  openaiBaseUrl?: string;
}

export interface VoiceService {
  listVoices(args: VoiceListArgs): Promise<VoiceInfo[]>;
  synthesize(args: VoiceSynthesizeArgs): Promise<VoiceSynthesizeResult>;
  keyStatus(): Promise<VoiceKeyStatus>;
}

interface AzureVoiceRecord {
  ShortName?: string;
  DisplayName?: string;
  LocalName?: string;
  Locale?: string;
  Gender?: string;
}

interface OneCoreVoiceRecord {
  id?: string;
  name?: string;
  language?: string;
  gender?: string;
}

export function createVoiceService(deps: VoiceServiceDeps): VoiceService {
  const azureUrl = deps.azureBaseUrl ?? azureBaseUrl;
  const openaiUrl = deps.openaiBaseUrl ?? "https://api.openai.com";

  async function requireKey(engine: "azure" | "openai"): Promise<string> {
    const key = (await deps.getKey(VOICE_KEY_IDS[engine]))?.trim();
    if (!key) {
      const label = engine === "azure" ? "Azure Speech" : "OpenAI";
      throw new VoiceError("missing-key", `${label} key is not configured.`);
    }
    return key;
  }

  async function request(url: string, init: RequestInit, key: string): Promise<Response> {
    let response: Response;
    try {
      response = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new VoiceError(
        timedOut ? "timeout" : "http",
        timedOut ? `Request timed out after ${HTTP_TIMEOUT_MS / 1000} s.` : "Network request failed.",
      );
    }
    if (!response.ok) {
      const excerpt = redact((await response.text().catch(() => "")).slice(0, ERROR_EXCERPT_CHARS), key);
      throw new VoiceError("http", `HTTP ${response.status}${excerpt ? `: ${excerpt}` : ""}`);
    }
    return response;
  }

  function requireWindows(): void {
    if (deps.platform !== "win32") {
      throw new VoiceError("unsupported-platform", "Windows built-in voices are only available on Windows.");
    }
  }

  async function listWindows(): Promise<VoiceInfo[]> {
    if (deps.platform !== "win32") return [];
    const result = await deps.runPowerShell(onecoreListCommand(), POWERSHELL_TIMEOUT_MS);
    if (result.code !== 0) {
      throw new VoiceError("engine-failed", result.stderr.trim().slice(0, ERROR_EXCERPT_CHARS) || "Listing voices failed.");
    }
    const json = Buffer.from(result.stdout.trim(), "base64").toString("utf8");
    const records = JSON.parse(json || "[]") as OneCoreVoiceRecord[] | OneCoreVoiceRecord;
    return (Array.isArray(records) ? records : [records])
      .filter((record) => record.id && record.name)
      .map((record) => ({
        engine: "windows" as const,
        id: record.name as string,
        name: record.name as string,
        language: record.language ?? "",
        gender: record.gender,
      }));
  }

  async function listAzure(region: string | undefined): Promise<VoiceInfo[]> {
    const base = azureUrl(region);
    const key = await requireKey("azure");
    const response = await request(
      `${base}/cognitiveservices/voices/list`,
      { method: "GET", headers: { "Ocp-Apim-Subscription-Key": key, "User-Agent": USER_AGENT } },
      key,
    );
    const records = (await response.json()) as AzureVoiceRecord[];
    return records
      .filter((record) => record.ShortName)
      .map((record) => ({
        engine: "azure" as const,
        id: record.ShortName as string,
        name: record.LocalName || record.DisplayName || (record.ShortName as string),
        language: record.Locale ?? azureVoiceLocale(record.ShortName as string),
        gender: record.Gender,
      }));
  }

  function listOpenAi(): VoiceInfo[] {
    return OPENAI_VOICES.map((voice) => ({
      engine: "openai" as const,
      id: voice,
      name: voice,
      language: "multilingual",
    }));
  }

  async function newOutputPath(): Promise<string> {
    const dir = deps.outputDir();
    await fs.mkdir(dir, { recursive: true });
    return path.join(dir, `${randomUUID()}.wav`);
  }

  async function finish(outputPath: string, raw: Uint8Array, voice: string): Promise<VoiceSynthesizeResult> {
    const wav = normalizeWav(raw);
    await fs.writeFile(outputPath, wav.bytes);
    return { path: outputPath, durationSec: wav.durationSec, voice, bytes: wav.bytes };
  }

  async function synthesizeWindows(args: VoiceSynthesizeArgs): Promise<VoiceSynthesizeResult> {
    requireWindows();
    const outputPath = await newOutputPath();
    const textPath = outputPath.replace(/\.wav$/, ".txt");
    await fs.writeFile(textPath, args.text, "utf8");
    try {
      const result = await deps.runPowerShell(
        onecoreSynthesisCommand({
          textPath,
          voice: args.voice,
          outputPath,
          missingVoiceMessage: `[voice:voice-missing] Windows voice was not found: ${args.voice}`,
          rate: args.rate,
        }),
        POWERSHELL_TIMEOUT_MS,
      );
      const exists = await fs.stat(outputPath).then(
        (stat) => stat.isFile(),
        () => false,
      );
      if (result.code !== 0 || !exists) {
        const detail = result.stderr.trim();
        if (detail.includes("[voice:voice-missing]")) {
          throw new VoiceError("voice-missing", `Windows voice was not found: ${args.voice}`);
        }
        throw new VoiceError("engine-failed", detail.slice(0, ERROR_EXCERPT_CHARS) || "Windows speech produced no audio.");
      }
      const metadata = Buffer.from(result.stdout.trim(), "base64").toString("utf8");
      const [displayName] = metadata.split("\n");
      return await finish(outputPath, await fs.readFile(outputPath), displayName?.trim() || args.voice);
    } catch (error) {
      await fs.rm(outputPath, { force: true });
      throw error;
    } finally {
      await fs.rm(textPath, { force: true });
    }
  }

  async function synthesizeAzure(args: VoiceSynthesizeArgs): Promise<VoiceSynthesizeResult> {
    const base = azureUrl(args.azureRegion);
    const key = await requireKey("azure");
    const response = await request(
      `${base}/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
          "User-Agent": USER_AGENT,
        },
        body: buildAzureSsml(args.text, args.voice, args.rate),
      },
      key,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    return finish(await newOutputPath(), bytes, args.voice);
  }

  async function synthesizeOpenAi(args: VoiceSynthesizeArgs): Promise<VoiceSynthesizeResult> {
    if (args.text.length > OPENAI_MAX_INPUT_CHARS) {
      throw new VoiceError("too-long", `OpenAI accepts at most ${OPENAI_MAX_INPUT_CHARS} characters.`);
    }
    const key = await requireKey("openai");
    const payload: Record<string, unknown> = {
      model: OPENAI_TTS_MODEL,
      voice: args.voice,
      input: args.text,
      response_format: "wav",
    };
    if (args.instructions?.trim()) payload.instructions = args.instructions.trim();
    if (args.rate !== undefined && args.rate !== 1) payload.speed = args.rate;
    const response = await request(
      `${openaiUrl}/v1/audio/speech`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify(payload),
      },
      key,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    return finish(await newOutputPath(), bytes, args.voice);
  }

  const synthesizers: Record<VoiceEngine, (args: VoiceSynthesizeArgs) => Promise<VoiceSynthesizeResult>> = {
    windows: synthesizeWindows,
    azure: synthesizeAzure,
    openai: synthesizeOpenAi,
  };

  return {
    listVoices: async (args) => {
      switch (args.engine) {
        case "windows":
          return listWindows();
        case "azure":
          return listAzure(args.azureRegion);
        case "openai":
          return listOpenAi();
      }
    },
    synthesize: (args) => synthesizers[args.engine](args),
    keyStatus: async () => ({
      azure: Boolean((await deps.getKey(VOICE_KEY_IDS.azure))?.trim()),
      openai: Boolean((await deps.getKey(VOICE_KEY_IDS.openai))?.trim()),
    }),
  };
}

// ---------------------------------------------------------------------------
// IPC wiring
// ---------------------------------------------------------------------------

export function registerVoiceIpc(): void {
  const service = createVoiceService({
    getKey: (id) => getKeyStore().get(id),
    outputDir: () => path.join(app.getPath("userData"), "voiceover"),
    platform: process.platform,
    runPowerShell,
    fetch: globalThis.fetch,
  });
  handle(CHANNELS.voiceListVoices, voiceListArgsSchema, (args) => service.listVoices(args));
  handle(CHANNELS.voiceSynthesize, voiceSynthesizeArgsSchema, (args) => service.synthesize(args));
  handle(CHANNELS.voiceKeyStatus, z.undefined(), () => service.keyStatus());
}
