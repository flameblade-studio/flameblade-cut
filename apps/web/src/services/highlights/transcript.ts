/**
 * Transcript shaping: Whisper worker chunks -> timestamped segments ->
 * sentences (the units highlight windows snap to).
 */
import type { TranscriptSegment } from "./types";

/** Chunk shape posted by `workers/whisper-worker.ts` (`type: "result"`). */
export interface WhisperChunk {
  readonly text: string;
  readonly timestamp: readonly [number | null, number | null];
}

const TERMINAL_PUNCTUATION = /[。！？!?….;；]["'」』）)]*\s*$/u;
/** A pause at least this long ends a sentence even without punctuation. */
export const SENTENCE_GAP_SECONDS = 0.6;
/** Unpunctuated speech is split at this length so windows can still snap. */
export const MAX_SENTENCE_SECONDS = 12;

/**
 * Converts the chunks of one transcription piece (which started at `offset`
 * seconds and lasted `pieceDuration`) into absolute, ordered segments. Missing
 * timestamps borrow from their neighbours; empty text is dropped.
 */
export function chunksToSegments(chunks: readonly WhisperChunk[], offset: number, pieceDuration: number): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let cursor = 0;
  for (const chunk of chunks) {
    const text = chunk.text.trim();
    const rawStart = chunk.timestamp[0] ?? cursor;
    const start = Math.min(pieceDuration, Math.max(cursor, rawStart));
    const rawEnd = chunk.timestamp[1] ?? pieceDuration;
    const end = Math.min(pieceDuration, Math.max(start + 0.1, rawEnd));
    cursor = end;
    if (!text) continue;
    segments.push({ start: offset + start, end: offset + end, text });
  }
  return segments;
}

/** Joins two transcript texts, adding a space only between Latin-script words. */
export function joinText(left: string, right: string): string {
  if (!left) return right;
  const needsSpace = /[A-Za-z0-9,]$/.test(left) && /^[A-Za-z0-9]/.test(right);
  return needsSpace ? `${left} ${right}` : `${left}${right}`;
}

/** Merges segments into sentences ending at punctuation, pauses or a length cap. */
export function buildSentences(segments: readonly TranscriptSegment[]): TranscriptSegment[] {
  const sentences: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;
  for (const segment of segments) {
    if (current && segment.start - current.end >= SENTENCE_GAP_SECONDS) {
      sentences.push(current);
      current = null;
    }
    current = current ? { start: current.start, end: segment.end, text: joinText(current.text, segment.text) } : { ...segment };
    if (TERMINAL_PUNCTUATION.test(current.text) || current.end - current.start >= MAX_SENTENCE_SECONDS) {
      sentences.push(current);
      current = null;
    }
  }
  if (current) sentences.push(current);
  return sentences;
}

/** "mm:ss.s" (or "h:mm:ss.s") for prompts and labels. */
export function formatTimestamp(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const hours = Math.floor(tenths / 36_000);
  const minutes = Math.floor((tenths % 36_000) / 600);
  const rest = ((tenths % 600) / 10).toFixed(1).padStart(4, "0");
  const mm = String(minutes).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${rest}` : `${mm}:${rest}`;
}
