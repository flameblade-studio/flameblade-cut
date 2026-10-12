/**
 * Text-to-speech errors as explicit codes. The hooks throw / report a code
 * with keyed text; the panel translates the text at display time and decides
 * from the code alone whether to offer "Open Settings", so neither depends on
 * the wording of an English message.
 */
import {
  serviceMessage,
  ServiceMessageError,
  type ServiceMessage,
  type ServiceMessageParams,
} from "../../../../services/service-message";

export type TtsErrorCode =
  | "empty-text"
  | "session-locked"
  | "missing-key"
  | "invalid-key"
  | "quota"
  | "rate-limited"
  | "network"
  | "service"
  | "llm-not-configured"
  | "llm-session-locked"
  | "llm-network"
  | "llm-service"
  | "enhance-failed"
  | "generate-failed"
  | "save-failed"
  | "timeline-failed"
  | "import-failed"
  /** Raw text from a producer without a code (shown unchanged). */
  | "unknown";

type KeyedTtsErrorCode = Exclude<TtsErrorCode, "unknown">;

export interface TtsError {
  readonly code: TtsErrorCode;
  readonly message: ServiceMessage | string;
}

export type TtsSuccessCode = "saved-to-media";

const PREFIX = "tools.serviceMessages.tts";

/** i18n key name and English text (the pre-localization wording) per code. */
const ERROR_TEXT: Record<KeyedTtsErrorCode, { readonly key: string; readonly fallback: string }> = {
  "empty-text": { key: "emptyText", fallback: "Please enter some text" },
  "session-locked": { key: "sessionLocked", fallback: "Session locked. Unlock in Settings > API Keys first." },
  "missing-key": { key: "missingKey", fallback: "ElevenLabs API key not found. Add it in Settings > API Keys." },
  "invalid-key": {
    key: "invalidKey",
    fallback: "ElevenLabs did not accept the API key, or no key is saved. Check it in Settings > API Keys.",
  },
  quota: { key: "quota", fallback: "Your ElevenLabs character quota is used up. Check your ElevenLabs plan." },
  "rate-limited": { key: "rateLimited", fallback: "ElevenLabs is receiving too many requests. Wait a moment and try again." },
  network: { key: "network", fallback: "Could not reach ElevenLabs. Check your internet connection." },
  service: { key: "service", fallback: "ElevenLabs error ({{status}})" },
  "llm-not-configured": {
    key: "llmNotConfigured",
    fallback: "Configure an AI endpoint and model before using text enhancement.",
  },
  "llm-session-locked": {
    key: "llmSessionLocked",
    fallback: "Session locked. Unlock in Settings > API Keys to use text enhancement.",
  },
  "llm-network": { key: "llmNetwork", fallback: "Could not reach the AI endpoint. Check the address and your connection." },
  "llm-service": { key: "llmService", fallback: "{{provider}} error ({{status}})" },
  "enhance-failed": { key: "enhanceFailed", fallback: "Failed to enhance text" },
  "generate-failed": { key: "generateFailed", fallback: "Failed to generate speech" },
  "save-failed": { key: "saveFailed", fallback: "Failed to save to media" },
  "timeline-failed": { key: "timelineFailed", fallback: "Failed to add to timeline" },
  "import-failed": { key: "importFailed", fallback: "Failed to import audio" },
};

/** Variant used when the provider sent its own (untranslatable) detail text. */
const DETAIL_TEXT = {
  service: { key: "serviceDetail", fallback: "ElevenLabs error ({{status}}): {{detail}}" },
  "llm-service": { key: "llmServiceDetail", fallback: "{{provider}} error ({{status}}): {{detail}}" },
} as const;

const SUCCESS_TEXT: Record<TtsSuccessCode, { readonly key: string; readonly fallback: string }> = {
  "saved-to-media": { key: "savedToMedia", fallback: "Saved to Media Assets" },
};

/** Codes the user fixes in Settings > API Keys. */
const SETTINGS_CODES: ReadonlySet<TtsErrorCode> = new Set<TtsErrorCode>([
  "session-locked",
  "missing-key",
  "invalid-key",
  "llm-session-locked",
]);

export function offersSettings(error: TtsError): boolean {
  return SETTINGS_CODES.has(error.code);
}

function fill(template: string, params: ServiceMessageParams | undefined): string {
  return template.replace(/\{\{(\w+)\}\}/gu, (match, name: string) =>
    params !== undefined && name in params ? String(params[name]) : match,
  );
}

export function ttsErrorMessage(code: KeyedTtsErrorCode, params?: ServiceMessageParams): ServiceMessage {
  const hasDetail = params !== undefined && typeof params.detail === "string" && params.detail !== "";
  const text = hasDetail && (code === "service" || code === "llm-service") ? DETAIL_TEXT[code] : ERROR_TEXT[code];
  return serviceMessage(`${PREFIX}.errors.${text.key}`, fill(text.fallback, params), params);
}

export function ttsSuccessMessage(code: TtsSuccessCode): ServiceMessage {
  const text = SUCCESS_TEXT[code];
  return serviceMessage(`${PREFIX}.success.${text.key}`, text.fallback);
}

export function ttsError(code: KeyedTtsErrorCode, params?: ServiceMessageParams): TtsError {
  return { code, message: ttsErrorMessage(code, params) };
}

/** Thrown by the ElevenLabs / LLM request helpers; `message` stays English. */
export class TtsRequestError extends ServiceMessageError {
  readonly code: KeyedTtsErrorCode;

  constructor(code: KeyedTtsErrorCode, params?: ServiceMessageParams) {
    super(ttsErrorMessage(code, params));
    this.name = "TtsRequestError";
    this.code = code;
  }
}

/** Coded form of anything caught by the TTS actions. */
export function toTtsError(error: unknown, fallback: KeyedTtsErrorCode): TtsError {
  if (error instanceof TtsRequestError) return { code: error.code, message: error.serviceMessage };
  if (error instanceof Error && error.message) return { code: "unknown", message: error.message };
  return ttsError(fallback);
}

/** Provider detail text from an error body (`detail`, `detail.message`, `message`, `error`, `error.message`). */
export function providerDetail(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const record = body as Record<string, unknown>;
  for (const field of ["detail", "message", "error"]) {
    const value = record[field];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "object" && value !== null) {
      const message = (value as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim() !== "") return message.trim();
    }
  }
  return "";
}

function elevenLabsStatusCode(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const detail = (body as Record<string, unknown>).detail;
  if (typeof detail !== "object" || detail === null) return "";
  const status = (detail as Record<string, unknown>).status;
  return typeof status === "string" ? status : "";
}

/** Error for a failed ElevenLabs response. */
export function elevenLabsHttpError(status: number, body: unknown): TtsRequestError {
  if (elevenLabsStatusCode(body) === "quota_exceeded") return new TtsRequestError("quota");
  if (status === 401 || status === 403) return new TtsRequestError("invalid-key");
  if (status === 429) return new TtsRequestError("rate-limited");
  return new TtsRequestError("service", { status, detail: providerDetail(body) });
}

/** Error for a failed text-enhancement (LLM) response. */
export function llmHttpError(provider: string, status: number, body: unknown): TtsRequestError {
  return new TtsRequestError("llm-service", { provider, status, detail: providerDetail(body) });
}
