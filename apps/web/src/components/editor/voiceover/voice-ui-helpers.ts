import type { TFunction } from "i18next";
import { decodeVoiceError } from "../../../services/voiceover/voiceover-client";
import { VoiceoverPlacementError } from "../../../services/voiceover/place-voiceover";

/** Localized message for any voiceover failure; adds the technical detail for HTTP/engine errors. */
export function voiceErrorText(t: TFunction, error: unknown): string {
  if (error instanceof VoiceoverPlacementError) {
    return error.message === "no project is open"
      ? t("voice.panel.errors.noProject")
      : `${t("voice.panel.errors.placement")} (${error.message})`;
  }
  const { code, detail } = decodeVoiceError(error);
  const base = t(`voice.panel.errors.${code}`);
  return (code === "http" || code === "engine-failed" || code === "unknown") && detail ? `${base} ${detail}` : base;
}

/** "1:05.3" style time for toasts. */
export function formatSeconds(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = (safe - minutes * 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${rest}`;
}

/** Localized language name ("zh-TW" -> "中文（台灣）"), falling back to the tag. */
export function languageLabel(tag: string, uiLanguage: string, multilingual: string): string {
  if (tag === "multilingual") return multilingual;
  try {
    return new Intl.DisplayNames([uiLanguage], { type: "language" }).of(tag) ?? tag;
  } catch {
    // Unknown or malformed tags are shown as-is.
    return tag;
  }
}
