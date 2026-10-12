/**
 * Undo-history labels in the UI language. Core records each step with an
 * English description (`action-history.ts`); the panel shows the translation
 * for the step's action type and falls back to that English text for any
 * type without one.
 */
import type { TFunction } from "i18next";

interface HistoryAction {
  type: string;
  params?: unknown;
}

/** i18n key of an action type: "clip/add" → "tools.history.actions.clip_add". */
export function historyActionKey(type: string): string {
  return `tools.history.actions.${type.replace(/\//gu, "_")}`;
}

export function historyActionLabel(t: TFunction, action: HistoryAction, fallback: string): string {
  const params = (typeof action.params === "object" && action.params !== null ? action.params : {}) as Record<string, unknown>;
  const trackType = typeof params.trackType === "string" ? params.trackType : "";
  return t(historyActionKey(action.type), {
    defaultValue: fallback,
    trackType: trackType === "" ? "" : t(`tools.history.trackTypes.${trackType}`, { defaultValue: trackType }),
  });
}
