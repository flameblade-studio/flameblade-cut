/**
 * Word-by-word caption highlight for caption text clips.
 *
 * Caption text clips may carry per-word timing in `metadata.captionWords`
 * (clip-local seconds) and an enabled highlight colour in
 * `metadata.captionHighlightColor`. The title renderer (shared by the editor
 * preview and the video export) asks this module which characters of the
 * clip text are the currently spoken word and paints that run in the
 * highlight colour. Everything here is pure and side-effect free.
 *
 * The word that started most recently stays highlighted until the next word
 * starts, so short gaps between words never make the highlight flicker.
 */
import type { ClipMetadata } from "../types/timeline";

export const CAPTION_WORDS_METADATA_KEY = "captionWords";
export const CAPTION_HIGHLIGHT_COLOR_METADATA_KEY = "captionHighlightColor";

export interface CaptionTimedWord {
  readonly text: string;
  /** Clip-local start, in seconds. */
  readonly start: number;
  /** Clip-local end, in seconds. */
  readonly end: number;
}

export interface CaptionWordHighlight {
  readonly color: string;
  readonly words: readonly CaptionTimedWord[];
}

export interface CaptionTextRun {
  readonly text: string;
  readonly highlighted: boolean;
}

function isTimedWord(value: unknown): value is CaptionTimedWord {
  if (typeof value !== "object" || value === null) return false;
  const word = value as Record<string, unknown>;
  return (
    typeof word.text === "string" &&
    typeof word.start === "number" &&
    typeof word.end === "number" &&
    Number.isFinite(word.start) &&
    Number.isFinite(word.end)
  );
}

/** Reads a valid, enabled highlight from clip metadata, or null. */
export function readCaptionWordHighlight(
  metadata: ClipMetadata | undefined,
): CaptionWordHighlight | null {
  const color = metadata?.[CAPTION_HIGHLIGHT_COLOR_METADATA_KEY];
  const words = metadata?.[CAPTION_WORDS_METADATA_KEY];
  if (typeof color !== "string" || color.trim() === "") return null;
  if (!Array.isArray(words) || words.length === 0) return null;
  if (!words.every(isTimedWord)) return null;
  return { color, words };
}

/**
 * Character range `[start, end)` of the active word inside `text`, or null.
 * Words are located in order, skipping whitespace, so repeated words map to
 * their own occurrence. A word that cannot be found stops the search.
 */
export function activeCaptionWordRange(
  text: string,
  words: readonly CaptionTimedWord[],
  time: number,
): { start: number; end: number } | null {
  let activeIndex = -1;
  for (let index = 0; index < words.length; index++) {
    if (words[index].start <= time) activeIndex = index;
  }
  if (activeIndex < 0) return null;

  let cursor = 0;
  for (let index = 0; index <= activeIndex; index++) {
    const needle = words[index].text.trim();
    if (needle === "") continue;
    const found = text.indexOf(needle, cursor);
    if (found < 0) return null;
    if (index === activeIndex) return { start: found, end: found + needle.length };
    cursor = found + needle.length;
  }
  return null;
}

/**
 * Splits `text` (lines separated by "\n") into per-line runs, marking the
 * characters inside `range` as highlighted. Line breaks are not part of any
 * run; a range spanning a line break is clipped per line.
 */
export function splitCaptionLineRuns(
  text: string,
  range: { start: number; end: number } | null,
): CaptionTextRun[][] {
  const lines = text.split("\n");
  const result: CaptionTextRun[][] = [];
  let offset = 0;
  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1;
    if (!range || range.end <= lineStart || range.start >= lineEnd) {
      result.push([{ text: line, highlighted: false }]);
      continue;
    }
    const from = Math.max(range.start, lineStart) - lineStart;
    const to = Math.min(range.end, lineEnd) - lineStart;
    const runs: CaptionTextRun[] = [];
    if (from > 0) runs.push({ text: line.slice(0, from), highlighted: false });
    runs.push({ text: line.slice(from, to), highlighted: true });
    if (to < line.length) runs.push({ text: line.slice(to), highlighted: false });
    result.push(runs);
  }
  return result;
}
