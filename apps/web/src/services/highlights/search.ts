/**
 * "Search by words" over the transcript. Matching ignores case, full/half
 * width and (with the OpenCC normalizer) Traditional vs Simplified Chinese.
 */
import type { TranscriptSegment } from "./types";

/** Maps text to a comparison form. Must not throw. */
export type TextNormalizer = (text: string) => string;

/** Case and width folding only (NFKC + lower case). */
export const basicNormalizer: TextNormalizer = (text) => text.normalize("NFKC").toLowerCase();

/**
 * Adds Traditional -> Simplified folding via the bundled `opencc-js`
 * dictionaries (loaded lazily; the page works with `basicNormalizer` until
 * this resolves).
 */
export async function createScriptNormalizer(): Promise<TextNormalizer> {
  const { Converter } = await import("opencc-js");
  const toSimplified = Converter({ from: "tw", to: "cn" });
  return (text) => toSimplified(basicNormalizer(text));
}

/** Converts Simplified Chinese to Taiwan Traditional (for Whisper output). */
export async function createTaiwanConverter(): Promise<(text: string) => string> {
  const { Converter } = await import("opencc-js");
  return Converter({ from: "cn", to: "tw" });
}

export interface TranscriptMatch {
  readonly segmentIndex: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Segments containing `query` (after normalization), in time order. */
export function searchTranscript(
  segments: readonly TranscriptSegment[],
  query: string,
  normalize: TextNormalizer,
  limit = 50,
): TranscriptMatch[] {
  const needle = normalize(query.trim());
  if (!needle) return [];
  const matches: TranscriptMatch[] = [];
  for (let index = 0; index < segments.length && matches.length < limit; index += 1) {
    const segment = segments[index];
    if (normalize(segment.text).includes(needle)) {
      matches.push({ segmentIndex: index, start: segment.start, end: segment.end, text: segment.text });
    }
  }
  return matches;
}
