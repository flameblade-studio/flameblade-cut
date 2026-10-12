/**
 * Recognised transcript → caption clip payloads: smart line breaking,
 * optional Chinese script conversion that keeps word timing, and the clip
 * metadata the word highlight and transcript export read.
 */
import {
  CAPTION_HIGHLIGHT_COLOR_METADATA_KEY,
  CAPTION_WORDS_METADATA_KEY,
  type ClipMetadata,
} from "@openreel/core";
import type { ChineseConverter } from "./chinese-script";
import { CAPTION_SPOKEN_TEXT_KEY } from "./caption-documents";
import {
  breakCaptionSegments,
  estimateWordTimings,
  type CaptionCue,
  type LineBreakOptions,
  type TimedWord,
  type TranscriptSegment,
} from "./line-breaking";

export const DEFAULT_HIGHLIGHT_COLOR = "#FFD54A";

/**
 * Converts a cue's text with `convert`. Word timing is kept character-exact
 * when the conversion preserves length (the usual case: 视频→影片); when it
 * does not (内存→記憶體) the words are re-estimated over the cue's time.
 */
export function convertCue(cue: CaptionCue, convert: ChineseConverter): CaptionCue {
  const text = convert(cue.text);
  const spokenText = convert(cue.spokenText);
  if (text === cue.text && spokenText === cue.spokenText) return cue;
  let words: TimedWord[] | null = text.length === cue.text.length ? [] : null;
  let cursor = 0;
  for (const word of cue.words) {
    if (!words) break;
    const at = cue.text.indexOf(word.text, cursor);
    if (at < 0) {
      words = null;
      break;
    }
    words.push({ ...word, text: text.slice(at, at + word.text.length) });
    cursor = at + word.text.length;
  }
  return {
    ...cue,
    text,
    spokenText,
    words: words ?? estimateWordTimings(text, cue.startTime, cue.endTime),
  };
}

export function buildCaptionCues(
  segments: readonly TranscriptSegment[],
  options: Partial<LineBreakOptions> & { convert?: ChineseConverter | null },
): CaptionCue[] {
  const { convert, ...lineBreak } = options;
  const cues = breakCaptionSegments(segments, lineBreak);
  return convert ? cues.map((cue) => convertCue(cue, convert)) : cues;
}

/** Word timing relative to the clip start, rounded to milliseconds. */
export function clipLocalWords(words: readonly TimedWord[], clipStart: number): TimedWord[] {
  const round = (value: number) => Math.round(Math.max(0, value - clipStart) * 1000) / 1000;
  return words.map((word) => ({ text: word.text, start: round(word.start), end: round(word.end) }));
}

/** Metadata for a new caption clip created from `cue`. */
export function cueClipMetadata(cue: CaptionCue, highlightColor: string | null): ClipMetadata {
  return {
    [CAPTION_SPOKEN_TEXT_KEY]: cue.spokenText,
    [CAPTION_WORDS_METADATA_KEY]: clipLocalWords(cue.words, cue.startTime),
    ...(highlightColor ? { [CAPTION_HIGHLIGHT_COLOR_METADATA_KEY]: highlightColor } : {}),
  };
}

/**
 * Metadata enabling (colour) or disabling (null) the word highlight on an
 * existing caption. Captions without word timing (imported SRT) get an
 * estimate over their duration.
 */
export function withWordHighlight(
  clip: { text: string; duration: number; metadata?: ClipMetadata },
  highlightColor: string | null,
  originalText: string,
): ClipMetadata {
  const metadata: Record<string, unknown> = { ...clip.metadata };
  if (!highlightColor) {
    delete metadata[CAPTION_HIGHLIGHT_COLOR_METADATA_KEY];
    return metadata;
  }
  const words = metadata[CAPTION_WORDS_METADATA_KEY];
  if (!Array.isArray(words) || words.length === 0) {
    metadata[CAPTION_WORDS_METADATA_KEY] = clipLocalWords(
      estimateWordTimings(originalText, 0, clip.duration),
      0,
    );
  }
  metadata[CAPTION_HIGHLIGHT_COLOR_METADATA_KEY] = highlightColor;
  return metadata;
}

/**
 * Word timing for edited caption text: keeps `words` (converted with
 * `convert` when given) if they still occur in `text` in order, otherwise
 * re-estimates them over [0, duration].
 */
export function reconcileWords(
  text: string,
  words: readonly TimedWord[],
  duration: number,
  convert?: ChineseConverter,
): TimedWord[] {
  const candidate = convert ? words.map((word) => ({ ...word, text: convert(word.text) })) : [...words];
  let cursor = 0;
  for (const word of candidate) {
    const at = text.indexOf(word.text, cursor);
    if (at < 0) return clipLocalWords(estimateWordTimings(text, 0, duration), 0);
    cursor = at + word.text.length;
  }
  return candidate;
}
