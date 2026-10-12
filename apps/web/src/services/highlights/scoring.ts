/**
 * Local (offline, free) highlight engine. Deterministic: the same transcript
 * and loudness profile always yield the same clips.
 *
 * 1. Candidates are every run of consecutive sentences whose span fits the
 *    target length, so each candidate starts and ends on a sentence boundary.
 * 2. Each candidate gets features: speech density and coverage, loudness and
 *    loudness variation (from the RMS profile), cue phrases, question and
 *    exclamation density, an opening hook and closeness to the target length.
 *    Density/loudness/variation are ranked as percentiles among candidates of
 *    the same video, so the score adapts to quiet or fast speakers.
 * 3. Clips are chosen greedily by score with no overlap and a minimum gap.
 */
import { countCuePhrases, countExclamations, countQuestions, speechUnits } from "./cue-phrases";
import type { HighlightClip, LengthRange, ReasonCode, RmsProfile, TranscriptSegment } from "./types";

export interface LocalHighlightOptions {
  readonly length: LengthRange;
  readonly count: number;
  /** Source duration (seconds); clips are clamped to it. */
  readonly duration: number;
  /** Minimum silence between two chosen clips. */
  readonly minGapSeconds?: number;
  /** Lead-in / tail added around the snapped sentences. */
  readonly padStartSeconds?: number;
  readonly padEndSeconds?: number;
}

export const SCORE_WEIGHTS = {
  density: 0.22,
  coverage: 0.12,
  loudness: 0.14,
  dynamics: 0.1,
  cues: 0.22,
  punctuation: 0.1,
  hook: 0.05,
  lengthFit: 0.05,
} as const;

const TITLE_MAX_CHARS = 28;
const HOOK_MAX_CHARS = 48;

interface SentenceFeatures {
  readonly units: number;
  readonly cues: number;
  readonly questions: number;
  readonly exclamations: number;
}

export interface ScoredWindow {
  readonly first: number;
  readonly last: number;
  readonly start: number;
  readonly end: number;
  readonly score: number;
  readonly reasonCodes: readonly ReasonCode[];
}

function prefixSums(values: readonly number[]): Float64Array {
  const sums = new Float64Array(values.length + 1);
  values.forEach((value, index) => {
    sums[index + 1] = sums[index] + value;
  });
  return sums;
}

/** Fraction of `sorted` strictly below `value`, plus half the ties (0..1). */
function percentile(sorted: Float64Array, value: number): number {
  if (sorted.length <= 1) return 0.5;
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] < value) low = mid + 1;
    else high = mid;
  }
  let equalEnd = low;
  while (equalEnd < sorted.length && sorted[equalEnd] === value) equalEnd += 1;
  return (low + (equalEnd - low) / 2) / sorted.length;
}

function truncate(text: string, maxChars: number): string {
  const chars = Array.from(text.trim());
  return chars.length <= maxChars ? chars.join("") : `${chars.slice(0, maxChars - 1).join("")}…`;
}

class RmsStats {
  private readonly sums: Float64Array;
  private readonly squares: Float64Array;
  readonly globalMean: number;

  constructor(private readonly profile: RmsProfile) {
    const values = Array.from(profile.values);
    this.sums = prefixSums(values);
    this.squares = prefixSums(values.map((value) => value * value));
    this.globalMean = values.length > 0 ? this.sums[values.length] / values.length : 0;
  }

  /** Mean and standard deviation of the frames overlapping [start, end). */
  window(start: number, end: number): { mean: number; std: number } {
    const count = this.profile.values.length;
    const first = Math.min(count, Math.max(0, Math.floor(start / this.profile.frameSeconds)));
    const last = Math.min(count, Math.max(first, Math.ceil(end / this.profile.frameSeconds)));
    const frames = last - first;
    if (frames === 0) return { mean: 0, std: 0 };
    const mean = (this.sums[last] - this.sums[first]) / frames;
    const variance = Math.max(0, (this.squares[last] - this.squares[first]) / frames - mean * mean);
    return { mean, std: Math.sqrt(variance) };
  }
}

/** Scores every sentence-aligned window that fits `length`. Exported for tests. */
export function scoreWindows(
  sentences: readonly TranscriptSegment[],
  rms: RmsProfile | null,
  length: LengthRange,
): ScoredWindow[] {
  const features: SentenceFeatures[] = sentences.map((sentence) => ({
    units: speechUnits(sentence.text),
    cues: countCuePhrases(sentence.text),
    questions: countQuestions(sentence.text),
    exclamations: countExclamations(sentence.text),
  }));
  const units = prefixSums(features.map((feature) => feature.units));
  const cues = prefixSums(features.map((feature) => feature.cues));
  const questions = prefixSums(features.map((feature) => feature.questions));
  const exclamations = prefixSums(features.map((feature) => feature.exclamations));
  const speech = prefixSums(sentences.map((sentence) => Math.max(0, sentence.end - sentence.start)));
  const stats = rms ? new RmsStats(rms) : null;

  interface Raw {
    first: number;
    last: number;
    density: number;
    coverage: number;
    loudness: number;
    dynamics: number;
    cues: number;
    punctuation: number;
    questions: number;
    exclamations: number;
    hook: boolean;
    lengthFit: number;
  }
  const raws: Raw[] = [];
  const middle = (length.min + length.max) / 2;
  for (let first = 0; first < sentences.length; first += 1) {
    for (let last = first; last < sentences.length; last += 1) {
      const span = sentences[last].end - sentences[first].start;
      if (span > length.max) break;
      if (span < length.min) continue;
      const speaking = speech[last + 1] - speech[first];
      const sentenceCount = last - first + 1;
      const windowQuestions = questions[last + 1] - questions[first];
      const windowExclamations = exclamations[last + 1] - exclamations[first];
      const loud = stats?.window(sentences[first].start, sentences[last].end);
      const opening = features[first];
      raws.push({
        first,
        last,
        density: speaking > 0 ? (units[last + 1] - units[first]) / speaking : 0,
        coverage: Math.min(1, speaking / span),
        loudness: stats && stats.globalMean > 0 && loud ? loud.mean / stats.globalMean : 0,
        dynamics: stats && stats.globalMean > 0 && loud ? loud.std / stats.globalMean : 0,
        cues: cues[last + 1] - cues[first],
        punctuation: (windowQuestions + windowExclamations) / sentenceCount,
        questions: windowQuestions,
        exclamations: windowExclamations,
        hook: opening.cues > 0 || opening.questions > 0,
        lengthFit: 1 - Math.min(1, Math.abs(span - middle) / Math.max(1, length.max - length.min)),
      });
    }
  }

  const sortedOf = (pick: (raw: Raw) => number): Float64Array => Float64Array.from(raws.map(pick)).sort();
  const densities = sortedOf((raw) => raw.density);
  const loudnesses = sortedOf((raw) => raw.loudness);
  const dynamics = sortedOf((raw) => raw.dynamics);

  return raws.map((raw) => {
    const pDensity = percentile(densities, raw.density);
    const pLoud = stats ? percentile(loudnesses, raw.loudness) : 0.5;
    const pDynamics = stats ? percentile(dynamics, raw.dynamics) : 0.5;
    const cueScore = Math.min(1, raw.cues / 2);
    const punctuationScore = Math.min(1, raw.punctuation * 2);
    const total =
      SCORE_WEIGHTS.density * pDensity +
      SCORE_WEIGHTS.coverage * raw.coverage +
      SCORE_WEIGHTS.loudness * pLoud +
      SCORE_WEIGHTS.dynamics * pDynamics +
      SCORE_WEIGHTS.cues * cueScore +
      SCORE_WEIGHTS.punctuation * punctuationScore +
      SCORE_WEIGHTS.hook * (raw.hook ? 1 : 0) +
      SCORE_WEIGHTS.lengthFit * raw.lengthFit;
    const reasonCodes: ReasonCode[] = [];
    if (raw.cues > 0) reasonCodes.push("cue");
    if (raw.hook) reasonCodes.push("hook");
    if (raw.questions > 0) reasonCodes.push("question");
    if (raw.exclamations > 0) reasonCodes.push("exclaim");
    if (pDensity >= 0.75) reasonCodes.push("dense");
    if (stats && pLoud >= 0.75) reasonCodes.push("loud");
    if (stats && pDynamics >= 0.75) reasonCodes.push("dynamic");
    return {
      first: raw.first,
      last: raw.last,
      start: sentences[raw.first].start,
      end: sentences[raw.last].end,
      score: Math.round(Math.min(1, Math.max(0, total)) * 100),
      reasonCodes,
    };
  });
}

function overlapsWithGap(window: ScoredWindow, chosen: readonly ScoredWindow[], gap: number): boolean {
  return chosen.some((other) => window.start < other.end + gap && other.start < window.end + gap);
}

/** Highest-scoring non-overlapping windows (score desc, then earlier, then shorter). */
export function selectTopWindows(windows: readonly ScoredWindow[], count: number, minGapSeconds: number): ScoredWindow[] {
  const ranked = [...windows].sort(
    (left, right) => right.score - left.score || left.start - right.start || left.end - right.end,
  );
  const chosen: ScoredWindow[] = [];
  for (const window of ranked) {
    if (chosen.length >= count) break;
    if (!overlapsWithGap(window, chosen, minGapSeconds)) chosen.push(window);
  }
  return chosen;
}

function titleFor(sentences: readonly TranscriptSegment[], window: ScoredWindow): string {
  for (let index = window.first; index <= window.last; index += 1) {
    if (countCuePhrases(sentences[index].text) > 0) return truncate(sentences[index].text, TITLE_MAX_CHARS);
  }
  return truncate(sentences[window.first].text, TITLE_MAX_CHARS);
}

/** Runs the whole local engine. Returns clips ordered by score (best first). */
export function findLocalHighlights(
  sentences: readonly TranscriptSegment[],
  rms: RmsProfile | null,
  options: LocalHighlightOptions,
): HighlightClip[] {
  const minGap = options.minGapSeconds ?? 5;
  const padStart = options.padStartSeconds ?? 0.2;
  const padEnd = options.padEndSeconds ?? 0.35;
  const chosen = selectTopWindows(scoreWindows(sentences, rms, options.length), options.count, minGap);
  return chosen.map((window) => {
    const start = Math.max(0, window.start - padStart);
    const end = Math.min(options.duration, window.end + padEnd);
    return {
      id: `h-${start.toFixed(2)}`,
      start,
      end,
      title: titleFor(sentences, window),
      hook: truncate(sentences[window.first].text, HOOK_MAX_CHARS),
      score: window.score,
      reasonCodes: window.reasonCodes,
      reasonText: "",
      engine: "local" as const,
    };
  });
}
