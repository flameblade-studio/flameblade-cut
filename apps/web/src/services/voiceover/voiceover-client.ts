/**
 * Engine-agnostic voiceover client. All synthesis runs in the Electron main
 * process (`window.openreel.voice`); cloud keys stay there too. This module
 * only adds error decoding, voice grouping and default-voice choice.
 */
import type {
  OpenReelVoiceEngine,
  OpenReelVoiceInfo,
  OpenReelVoiceSynthesizeArgs,
  OpenReelVoiceSynthesizeResult,
} from "../../types/global";

export type VoiceEngine = OpenReelVoiceEngine;
export type VoiceInfo = OpenReelVoiceInfo;
export type SynthesizeArgs = OpenReelVoiceSynthesizeArgs;
export type SynthesizeResult = OpenReelVoiceSynthesizeResult;

export const VOICE_ENGINES: readonly VoiceEngine[] = ["windows", "azure", "openai"];

/** KeyStore ids; must match `VOICE_KEY_IDS` in apps/desktop/src/shared/ipc-contract.ts. */
export const VOICE_KEY_IDS = {
  azure: "flameblade.azure-speech-key",
  openai: "flameblade.openai-key",
} as const;

export type CloudVoiceEngine = keyof typeof VOICE_KEY_IDS;

export const VOICE_MAX_TEXT_CHARS = 5000;
export const OPENAI_MAX_TEXT_CHARS = 4096;

export function maxTextChars(engine: VoiceEngine): number {
  return engine === "openai" ? OPENAI_MAX_TEXT_CHARS : VOICE_MAX_TEXT_CHARS;
}

export type VoiceBridge = NonNullable<NonNullable<Window["openreel"]>["voice"]>;

export function getVoiceBridge(): VoiceBridge | null {
  return typeof window === "undefined" ? null : (window.openreel?.voice ?? null);
}

export const VOICE_ERROR_CODES = [
  "missing-key",
  "invalid-region",
  "unsupported-platform",
  "voice-missing",
  "engine-failed",
  "timeout",
  "http",
  "bad-audio",
  "too-long",
] as const;
export type VoiceErrorCode = (typeof VOICE_ERROR_CODES)[number] | "unavailable" | "unknown";

export interface DecodedVoiceError {
  code: VoiceErrorCode;
  /** Technical detail for display under the localized message (never contains a key). */
  detail: string;
}

/** Decodes the `[voice:<code>] detail` convention used by the main process. */
export function decodeVoiceError(error: unknown): DecodedVoiceError {
  const message = error instanceof Error ? error.message : String(error);
  const match = /\[voice:([a-z-]+)\]\s*(.*)$/s.exec(message);
  if (match && (VOICE_ERROR_CODES as readonly string[]).includes(match[1])) {
    return { code: match[1] as VoiceErrorCode, detail: match[2].trim() };
  }
  return { code: "unknown", detail: message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") };
}

export interface VoiceGroup {
  language: string;
  voices: VoiceInfo[];
}

/**
 * Groups voices by language: zh-TW first, then the UI language family,
 * then the rest alphabetically. Voices inside a group sort by name.
 */
export function groupVoices(voices: readonly VoiceInfo[], uiLanguage = "zh-TW"): VoiceGroup[] {
  const groups = new Map<string, VoiceInfo[]>();
  for (const voice of voices) {
    const key = voice.language || "other";
    groups.set(key, [...(groups.get(key) ?? []), voice]);
  }
  const uiFamily = uiLanguage.split("-")[0].toLowerCase();
  const rank = (language: string): number => {
    if (language.toLowerCase() === "zh-tw") return 0;
    if (language.toLowerCase() === uiLanguage.toLowerCase()) return 1;
    if (language.toLowerCase().startsWith("zh")) return 2;
    if (language.split("-")[0].toLowerCase() === uiFamily) return 3;
    return 4;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([language, list]) => ({
      language,
      voices: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

const PREFERRED_VOICES: Record<VoiceEngine, readonly string[]> = {
  windows: ["Microsoft Yating"],
  azure: ["zh-TW-HsiaoChenNeural", "zh-TW-HsiaoYuNeural"],
  openai: ["marin"],
};

/** Keeps `current` when still offered; else the engine's preferred voice, a zh-TW voice, or the first. */
export function chooseVoice(engine: VoiceEngine, voices: readonly VoiceInfo[], current?: string | null): string | null {
  if (current && voices.some((voice) => voice.id === current)) return current;
  for (const preferred of PREFERRED_VOICES[engine]) {
    if (voices.some((voice) => voice.id === preferred)) return preferred;
  }
  return voices.find((voice) => voice.language.toLowerCase() === "zh-tw")?.id ?? voices[0]?.id ?? null;
}

function requireBridge(): VoiceBridge {
  const bridge = getVoiceBridge();
  if (!bridge) throw new Error("[voice:unavailable] Voiceover requires the desktop app.");
  return bridge;
}

export function listVoices(engine: VoiceEngine, azureRegion?: string): Promise<VoiceInfo[]> {
  return requireBridge().listVoices({ engine, azureRegion });
}

export function synthesize(args: SynthesizeArgs): Promise<SynthesizeResult> {
  return requireBridge().synthesize(args);
}

export function keyStatus(): Promise<Record<CloudVoiceEngine, boolean>> {
  return requireBridge().keyStatus();
}

/** Stores a cloud key in the OS-encrypted KeyStore. The value is never kept in renderer state. */
export async function saveCloudKey(engine: CloudVoiceEngine, value: string): Promise<void> {
  const keychain = window.openreel?.keychain;
  if (!keychain) throw new Error("[voice:unavailable] Voiceover requires the desktop app.");
  await keychain.set(VOICE_KEY_IDS[engine], value.trim());
}

export async function deleteCloudKey(engine: CloudVoiceEngine): Promise<void> {
  const keychain = window.openreel?.keychain;
  if (!keychain) throw new Error("[voice:unavailable] Voiceover requires the desktop app.");
  await keychain.delete(VOICE_KEY_IDS[engine]);
}
