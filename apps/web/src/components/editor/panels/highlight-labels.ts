/**
 * Highlight-extractor labels in the UI language. The service reports stage
 * ids and reason codes alongside its English text; this maps them to i18n
 * keys and falls back to the service's English text when a key is missing.
 */
import type { TFunction } from "i18next";
import type { HighlightResult, HighlightStage } from "../../../services/highlight-service";

/** Panel-side phases: the service stages plus the panel's own decode step. */
export type HighlightPhase = "decode" | HighlightStage;

const PHASE_FALLBACKS: Record<HighlightPhase, string> = {
  decode: "Decoding audio...",
  analyze: "Analyzing audio energy...",
  rank: "Ranking energetic moments locally...",
  done: "Local highlights ready",
};

const PREFIX = "tools.serviceMessages.highlights";

export function highlightPhaseKey(phase: HighlightPhase): string {
  // The panel's decode step predates the service stages and keeps its key.
  return phase === "decode" ? "tools.highlightExtractor.decoding" : `${PREFIX}.stages.${phase}`;
}

export function highlightPhaseLabel(t: TFunction, phase: HighlightPhase | null): string {
  if (phase === null) return "";
  return t(highlightPhaseKey(phase), { defaultValue: PHASE_FALLBACKS[phase] });
}

export function highlightReasonKey(reasonCode: HighlightResult["reasonCode"]): string {
  return `${PREFIX}.reasons.${reasonCode === "energy-speech" ? "energySpeech" : "energy"}`;
}

export function highlightTitleLabel(t: TFunction, highlight: Pick<HighlightResult, "title" | "number">): string {
  return t(`${PREFIX}.title`, { number: highlight.number, defaultValue: highlight.title });
}

export function highlightReasonLabel(t: TFunction, highlight: Pick<HighlightResult, "reason" | "reasonCode">): string {
  return t(highlightReasonKey(highlight.reasonCode), { defaultValue: highlight.reason });
}
