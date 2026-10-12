import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  VoiceError,
  azureBaseUrl,
  buildAzureSsml,
  createVoiceService,
  escapeXml,
  normalizeWav,
  onecoreListCommand,
  onecoreSynthesisCommand,
  runPowerShell,
  type PowerShellRunner,
  type VoiceServiceDeps,
} from "./voice";
import { VOICE_KEY_IDS, voiceSynthesizeArgsSchema } from "../../shared/ipc-contract";

/** 16-bit mono PCM WAV with `samples` zero samples. */
function makeWav(samples: number, sampleRate = 24_000, dataSizeField?: number): Uint8Array {
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(dataSizeField === undefined ? 36 + dataBytes : 0xffffffff, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSizeField ?? dataBytes, 40);
  return new Uint8Array(buffer);
}

function decodeCommand(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf16le");
}

function decodedVariable(script: string, name: string): string {
  const match = new RegExp(`\\$${name}=\\[Text\\.Encoding\\]::UTF8\\.GetString\\(\\[Convert\\]::FromBase64String\\('([^']*)'\\)\\)`).exec(
    script,
  );
  if (!match) throw new Error(`variable ${name} not found`);
  return Buffer.from(match[1], "base64").toString("utf8");
}

interface Recorded {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const SECRET = "sk-test-SECRET-0123456789";

let server: http.Server;
let baseUrl = "";
let recorded: Recorded[] = [];
let responder: (req: Recorded, res: http.ServerResponse) => void = () => undefined;
let workDir = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const entry = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      recorded.push(entry);
      responder(entry, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(async () => {
  recorded = [];
  if (workDir) await rm(workDir, { recursive: true, force: true });
  workDir = "";
});

async function makeService(overrides: Partial<VoiceServiceDeps> = {}) {
  workDir = await mkdtemp(path.join(tmpdir(), "flameblade-voice-"));
  const keys: Record<string, string> = { [VOICE_KEY_IDS.azure]: SECRET, [VOICE_KEY_IDS.openai]: SECRET };
  return createVoiceService({
    getKey: async (id) => keys[id] ?? null,
    outputDir: () => path.join(workDir, "voiceover"),
    platform: "win32",
    runPowerShell: async () => ({ code: 1, stdout: "", stderr: "not expected" }),
    fetch: globalThis.fetch,
    azureBaseUrl: () => baseUrl,
    openaiBaseUrl: baseUrl,
    ...overrides,
  });
}

describe("pure helpers", () => {
  it("escapes every XML special character", () => {
    expect(escapeXml(`a<b>&"c'`)).toBe("a&lt;b&gt;&amp;&quot;c&apos;");
  });

  it("builds SSML with escaped text, locale from the voice and no prosody at natural speed", () => {
    const ssml = buildAzureSsml("劍 <break/> & \"x\"", "zh-TW-HsiaoChenNeural");
    expect(ssml).toContain('xml:lang="zh-TW"');
    expect(ssml).toContain('<voice name="zh-TW-HsiaoChenNeural">');
    expect(ssml).toContain("劍 &lt;break/&gt; &amp; &quot;x&quot;");
    expect(ssml).not.toContain("<break/>");
    expect(ssml).not.toContain("prosody");
    expect(buildAzureSsml("x", "en-US-AvaNeural", 1.2)).toContain('<prosody rate="+20%">x</prosody>');
  });

  it("accepts only plain Azure region names", () => {
    expect(azureBaseUrl("eastasia")).toBe("https://eastasia.tts.speech.microsoft.com");
    for (const bad of ["", "evil.com/", "east asia", "a@b", "x.y"]) {
      expect(() => azureBaseUrl(bad)).toThrow(VoiceError);
    }
  });

  it("measures WAV duration and repairs streamed placeholder sizes", () => {
    expect(normalizeWav(makeWav(24_000)).durationSec).toBeCloseTo(1, 5);
    const streamed = normalizeWav(makeWav(12_000, 24_000, 0xffffffff));
    expect(streamed.durationSec).toBeCloseTo(0.5, 5);
    const view = Buffer.from(streamed.bytes);
    expect(view.readUInt32LE(40)).toBe(24_000);
    expect(view.readUInt32LE(4)).toBe(36 + 24_000);
    expect(() => normalizeWav(new TextEncoder().encode('{"error":"nope"}'.padEnd(60)))).toThrow(/voice:bad-audio/);
  });

  it("caps text length and rejects blank text in the IPC schema", () => {
    const base = { engine: "windows", voice: "Microsoft Yating" };
    expect(voiceSynthesizeArgsSchema.safeParse({ ...base, text: "x".repeat(5000) }).success).toBe(true);
    expect(voiceSynthesizeArgsSchema.safeParse({ ...base, text: "x".repeat(5001) }).success).toBe(false);
    expect(voiceSynthesizeArgsSchema.safeParse({ ...base, text: "   " }).success).toBe(false);
    expect(voiceSynthesizeArgsSchema.safeParse({ ...base, engine: "sapi", text: "x" }).success).toBe(false);
  });
});

describe("OneCore command construction", () => {
  it("uses WinRT SpeechSynthesis (not SAPI), reads text from a file and sets no rate by default", () => {
    const script = decodeCommand(
      onecoreSynthesisCommand({
        textPath: "C:\\v\\a.txt",
        voice: "Microsoft Yating",
        outputPath: "C:\\v\\a.wav",
        missingVoiceMessage: "missing",
      }),
    );
    expect(script).toContain("Windows.Media.SpeechSynthesis.SpeechSynthesizer");
    expect(script).toContain("SynthesizeTextToStreamAsync");
    expect(script).not.toContain("System.Speech");
    expect(script).not.toContain("SpeakingRate");
    expect(decodedVariable(script, "voiceName")).toBe("Microsoft Yating");
    expect(decodedVariable(script, "textPath")).toBe("C:\\v\\a.txt");
    expect(decodedVariable(script, "path")).toBe("C:\\v\\a.wav");
    expect(script).toContain("if(-not $voice){throw $missingVoice}");
  });

  it("applies SpeakingRate only when a non-default rate is requested", () => {
    const script = decodeCommand(
      onecoreSynthesisCommand({ textPath: "C:\\a.txt", voice: "v", outputPath: "C:\\a.wav", missingVoiceMessage: "m", rate: 1.25 }),
    );
    expect(script).toContain("$synth.Options.SpeakingRate=[double]1.25;");
  });

  it("lists AllVoices with id, name, language and gender", () => {
    const script = decodeCommand(onecoreListCommand());
    expect(script).toContain("SpeechSynthesizer]::AllVoices");
    expect(script).toMatch(/id=\$_\.Id;name=\$_\.DisplayName;language=\$_\.Language;gender=/);
  });
});

describe("windows engine", () => {
  it("writes the text file, runs PowerShell once and returns the WAV with the reported voice", async () => {
    const commands: string[] = [];
    let textSeen = "";
    const runner: PowerShellRunner = async (encoded, timeoutMs) => {
      expect(timeoutMs).toBe(120_000);
      const script = decodeCommand(encoded);
      commands.push(script);
      textSeen = await readFile(decodedVariable(script, "textPath"), "utf8");
      await writeFile(decodedVariable(script, "path"), makeWav(48_000));
      return { code: 0, stdout: Buffer.from("Microsoft Yating\nMSTTS_V110_zhTW_YatingM").toString("base64"), stderr: "" };
    };
    const service = await makeService({ runPowerShell: runner });
    const result = await service.synthesize({ engine: "windows", text: "歡迎使用炎劍剪輯", voice: "Microsoft Yating" });
    expect(commands).toHaveLength(1);
    expect(textSeen).toBe("歡迎使用炎劍剪輯");
    expect(result.voice).toBe("Microsoft Yating");
    expect(result.durationSec).toBeCloseTo(2, 5);
    expect(path.dirname(result.path)).toBe(path.join(workDir, "voiceover"));
    expect((await stat(result.path)).size).toBe(44 + 96_000);
    // The temporary text file is removed.
    expect((await readdir(path.join(workDir, "voiceover"))).filter((name) => name.endsWith(".txt"))).toEqual([]);
  });

  it("reports a missing voice as a hard failure and leaves no files behind", async () => {
    const service = await makeService({
      runPowerShell: async (encoded) => ({
        code: 1,
        stdout: "",
        stderr: decodedVariable(decodeCommand(encoded), "missingVoice"),
      }),
    });
    await expect(service.synthesize({ engine: "windows", text: "x", voice: "Nope" })).rejects.toThrow(/voice:voice-missing/);
    expect(await readdir(path.join(workDir, "voiceover"))).toEqual([]);
  });

  it("parses the voice list and is empty off Windows", async () => {
    const json = JSON.stringify([
      { id: "a", name: "Microsoft Yating", language: "zh-TW", gender: "Female" },
      { id: "b", name: "Microsoft David", language: "en-US", gender: "Male" },
    ]);
    const service = await makeService({
      runPowerShell: async () => ({ code: 0, stdout: Buffer.from(json).toString("base64"), stderr: "" }),
    });
    expect(await service.listVoices({ engine: "windows" })).toEqual([
      { engine: "windows", id: "Microsoft Yating", name: "Microsoft Yating", language: "zh-TW", gender: "Female" },
      { engine: "windows", id: "Microsoft David", name: "Microsoft David", language: "en-US", gender: "Male" },
    ]);
    const mac = await makeService({ platform: "darwin" });
    expect(await mac.listVoices({ engine: "windows" })).toEqual([]);
    await expect(mac.synthesize({ engine: "windows", text: "x", voice: "v" })).rejects.toThrow(/voice:unsupported-platform/);
  });
});

describe("azure engine", () => {
  it("posts escaped SSML with the documented headers", async () => {
    responder = (_req, res) => {
      res.writeHead(200, { "content-type": "audio/wav" });
      res.end(Buffer.from(makeWav(24_000)));
    };
    const service = await makeService();
    const result = await service.synthesize({
      engine: "azure",
      text: "Tom & Jerry <3",
      voice: "zh-TW-HsiaoChenNeural",
      azureRegion: "eastasia",
    });
    expect(recorded).toHaveLength(1);
    const [req] = recorded;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/cognitiveservices/v1");
    expect(req.headers["ocp-apim-subscription-key"]).toBe(SECRET);
    expect(req.headers["content-type"]).toBe("application/ssml+xml");
    expect(req.headers["x-microsoft-outputformat"]).toBe("riff-24khz-16bit-mono-pcm");
    expect(req.headers["user-agent"]).toMatch(/FlamebladeCut/);
    expect(req.body).toContain("Tom &amp; Jerry &lt;3");
    expect(result.durationSec).toBeCloseTo(1, 5);
  });

  it("maps the voice list", async () => {
    responder = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify([
          { ShortName: "zh-TW-HsiaoChenNeural", DisplayName: "HsiaoChen", LocalName: "曉臻", Locale: "zh-TW", Gender: "Female" },
        ]),
      );
    };
    const service = await makeService();
    expect(await service.listVoices({ engine: "azure", azureRegion: "eastasia" })).toEqual([
      { engine: "azure", id: "zh-TW-HsiaoChenNeural", name: "曉臻", language: "zh-TW", gender: "Female" },
    ]);
    expect(recorded[0].url).toBe("/cognitiveservices/voices/list");
    expect(recorded[0].method).toBe("GET");
  });

  it("redacts the key from HTTP error excerpts", async () => {
    responder = (_req, res) => {
      res.writeHead(401);
      res.end(`invalid subscription key ${SECRET}`);
    };
    const service = await makeService();
    const error = await service
      .synthesize({ engine: "azure", text: "x", voice: "en-US-AvaNeural", azureRegion: "eastasia" })
      .then(
        () => new Error("expected a rejection"),
        (caught: unknown) => caught as Error,
      );
    expect(error.message).toMatch(/voice:http\] HTTP 401/);
    expect(error.message).not.toContain(SECRET);
    expect(error.message).toContain("***");
  });
});

describe("openai engine", () => {
  it("posts the documented JSON body with wav output and optional instructions", async () => {
    responder = (_req, res) => {
      res.writeHead(200, { "content-type": "audio/wav" });
      res.end(Buffer.from(makeWav(6_000, 24_000, 0xffffffff)));
    };
    const service = await makeService();
    const result = await service.synthesize({
      engine: "openai",
      text: "你好",
      voice: "marin",
      instructions: "溫柔地說",
    });
    const [req] = recorded;
    expect(req.url).toBe("/v1/audio/speech");
    expect(req.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(req.body)).toEqual({
      model: "gpt-4o-mini-tts",
      voice: "marin",
      input: "你好",
      response_format: "wav",
      instructions: "溫柔地說",
    });
    expect(result.durationSec).toBeCloseTo(0.25, 5);
  });

  it("refuses text above the OpenAI input limit before any request", async () => {
    const service = await makeService();
    await expect(service.synthesize({ engine: "openai", text: "x".repeat(4097), voice: "marin" })).rejects.toThrow(/voice:too-long/);
    expect(recorded).toHaveLength(0);
  });
});

describe("keys", () => {
  it("fails with missing-key, leaks nothing and sends no request", async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "flameblade-voice-"));
    const service = createVoiceService({
      getKey: async () => null,
      outputDir: () => path.join(workDir, "voiceover"),
      platform: "win32",
      runPowerShell: async () => ({ code: 1, stdout: "", stderr: "" }),
      fetch: globalThis.fetch,
      azureBaseUrl: () => baseUrl,
      openaiBaseUrl: baseUrl,
    });
    for (const engine of ["azure", "openai"] as const) {
      const error = await service
        .synthesize({ engine, text: "x", voice: "v", azureRegion: "eastasia" })
        .then(
        () => new Error("expected a rejection"),
        (caught: unknown) => caught as Error,
      );
      expect(error).toBeInstanceOf(VoiceError);
      expect(error.message).toMatch(/^\[voice:missing-key\] (Azure Speech|OpenAI) key is not configured\.$/);
    }
    expect(recorded).toHaveLength(0);
    expect(await service.keyStatus()).toEqual({ azure: false, openai: false });
  });

  it("reports configured keys as booleans only", async () => {
    const service = await makeService();
    expect(await service.keyStatus()).toEqual({ azure: true, openai: true });
  });
});

const runIntegration = process.platform === "win32" && process.env.FLAMEBLADE_VOICE_INTEGRATION === "1";

describe.skipIf(!runIntegration)("OneCore integration (FLAMEBLADE_VOICE_INTEGRATION=1)", () => {
  it("synthesizes with a real Windows voice", async () => {
    const service = await makeService({ runPowerShell });
    const voices = await service.listVoices({ engine: "windows" });
    expect(voices.length).toBeGreaterThan(0);
    const result = await service.synthesize({ engine: "windows", text: "測試", voice: voices[0].id });
    expect(result.durationSec).toBeGreaterThan(0.1);
  }, 130_000);
});
