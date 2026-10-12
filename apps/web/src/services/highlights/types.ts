/**
 * Shared types for the AI Highlights feature (long video -> best short clips).
 * All times are seconds in the source video.
 */

/** One timestamped transcript piece as produced by local Whisper. */
export interface TranscriptSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Target clip length presets offered on the page. */
export type HighlightLength = "short" | "medium" | "long";

export interface LengthRange {
  readonly min: number;
  readonly max: number;
}

export const LENGTH_RANGES: Record<HighlightLength, LengthRange> = {
  short: { min: 15, max: 30 },
  medium: { min: 30, max: 60 },
  long: { min: 60, max: 180 },
};

export type HighlightEngine = "local" | "openai";

/** Why the local engine liked a window; the page translates each code. */
export type ReasonCode = "cue" | "question" | "exclaim" | "dense" | "loud" | "dynamic" | "hook";

export interface HighlightClip {
  /** Stable within one analysis (e.g. "h-12.40"). */
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly title: string;
  /** Short opening line that hooks the viewer (may be empty for the local engine). */
  readonly hook: string;
  /** 0..100. */
  readonly score: number;
  readonly reasonCodes: readonly ReasonCode[];
  /** Free-text reason (OpenAI engine); empty for the local engine. */
  readonly reasonText: string;
  readonly engine: HighlightEngine;
}

/** Loudness envelope: one RMS value per `frameSeconds`. */
export interface RmsProfile {
  readonly frameSeconds: number;
  readonly values: Float32Array;
}
