/**
 * Optional OpenAI highlight engine. The renderer builds the prompt and JSON
 * schema and validates the answer; the HTTP call and the API key live only in
 * the main process (`apps/desktop/src/main/ipc/openai-text.ts`), reached via
 * `window.openreel.openaiText`. When that bridge is absent the engine is
 * reported unavailable and the page hides it.
 */
import type { HighlightClip, LengthRange, TranscriptSegment } from "./types";

export interface OpenAiTextChatRequest {
  readonly instructions: string;
  readonly input: string;
  readonly jsonSchema: { readonly name: string; readonly schema: Record<string, unknown> };
  readonly maxOutputTokens?: number;
  readonly reasoningEffort?: "low" | "medium" | "high";
}

/** Shape of `window.openreel.openaiText` (preload namespace). */
export interface OpenAiTextBridge {
  chat(args: OpenAiTextChatRequest): Promise<{ text: string; model: string }>;
  keyStatus(): Promise<{ configured: boolean }>;
}

export function getOpenAiTextBridge(): OpenAiTextBridge | null {
  const openreel = window.openreel as unknown as { openaiText?: OpenAiTextBridge } | undefined;
  return openreel?.openaiText ?? null;
}

export class HighlightResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HighlightResponseError";
  }
}

export const HIGHLIGHT_SCHEMA_NAME = "video_highlights";

export const HIGHLIGHT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["clips"],
  properties: {
    clips: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["start", "end", "title", "hook", "score", "reason"],
        properties: {
          start: { type: "number", description: "Clip start in seconds, at a sentence start from the transcript." },
          end: { type: "number", description: "Clip end in seconds, at a sentence end from the transcript." },
          title: { type: "string", description: "Catchy short-video title in the transcript's language." },
          hook: { type: "string", description: "The opening line that grabs attention, quoted or lightly edited." },
          score: { type: "integer", description: "Virality / standalone value, 0-100." },
          reason: { type: "string", description: "One sentence on why this moment works, in the transcript's language." },
        },
      },
    },
  },
};

/** "[12.3-17.8] text" per line; seconds keep the model's numbers exact. */
export function formatTranscriptForPrompt(segments: readonly TranscriptSegment[]): string {
  return segments.map((segment) => `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text}`).join("\n");
}

export function buildHighlightRequest(
  segments: readonly TranscriptSegment[],
  options: { readonly length: LengthRange; readonly count: number; readonly duration: number },
): OpenAiTextChatRequest {
  const instructions = [
    "You are a senior short-form video editor (TikTok, Reels, YouTube Shorts).",
    `From the timestamped transcript of a ${Math.round(options.duration)}-second video, pick the ${options.count} best moments to publish as standalone short clips.`,
    `Each clip must last between ${options.length.min} and ${options.length.max} seconds, start at the beginning of a transcript line and end at the end of a line, make sense without the rest of the video, and must not overlap another clip.`,
    "Prefer strong hooks in the first seconds, clear payoffs, surprising facts, practical tips, emotion and humor.",
    "Write title, hook and reason in the transcript's language. If the transcript is Chinese, use Taiwan Traditional Chinese (zh-TW) characters and wording.",
    "Times are seconds as shown in the brackets. Return clips ordered from best to worst.",
  ].join("\n");
  return {
    instructions,
    input: formatTranscriptForPrompt(segments),
    jsonSchema: { name: HIGHLIGHT_SCHEMA_NAME, schema: HIGHLIGHT_JSON_SCHEMA },
    maxOutputTokens: 6_000,
    reasoningEffort: "low",
  };
}

interface RawClip {
  start: number;
  end: number;
  title: string;
  hook: string;
  score: number;
  reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readClip(value: unknown, index: number): RawClip {
  if (!isRecord(value)) throw new HighlightResponseError(`clip ${index} is not an object`);
  const { start, end, title, hook, score, reason } = value;
  for (const [name, field] of [["start", start], ["end", end], ["score", score]] as const) {
    if (typeof field !== "number" || !Number.isFinite(field)) throw new HighlightResponseError(`clip ${index}: ${name} is not a number`);
  }
  for (const [name, field] of [["title", title], ["hook", hook], ["reason", reason]] as const) {
    if (typeof field !== "string") throw new HighlightResponseError(`clip ${index}: ${name} is not a string`);
  }
  return { start, end, title, hook, score, reason } as RawClip;
}

/** Moves `time` to the nearest boundary within `tolerance` seconds, if any. */
function snap(time: number, boundaries: readonly number[], tolerance: number): number {
  let best = time;
  let bestDistance = tolerance;
  for (const boundary of boundaries) {
    const distance = Math.abs(boundary - time);
    if (distance <= bestDistance) {
      best = boundary;
      bestDistance = distance;
    }
  }
  return best;
}

export interface ParseHighlightOptions {
  readonly duration: number;
  readonly length: LengthRange;
  readonly count: number;
  /** Sentence list used to snap the model's times to real boundaries. */
  readonly sentences: readonly TranscriptSegment[];
  readonly snapToleranceSeconds?: number;
  /** Clips shorter than this after clamping are discarded. */
  readonly minClipSeconds?: number;
}

/**
 * Validates the model's JSON and turns it into clips: rejects malformed JSON
 * or wrong field types, clamps times to the video, snaps them to sentence
 * boundaries, caps over-long clips, drops overlaps and keeps the best `count`.
 */
export function parseOpenAiHighlights(text: string, options: ParseHighlightOptions): HighlightClip[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HighlightResponseError("model answer is not valid JSON");
  }
  if (!isRecord(data) || !Array.isArray(data.clips)) throw new HighlightResponseError("model answer has no clips array");
  const raw = data.clips.map(readClip);
  const tolerance = options.snapToleranceSeconds ?? 2;
  const minClip = options.minClipSeconds ?? 3;
  const starts = options.sentences.map((sentence) => sentence.start);
  const ends = options.sentences.map((sentence) => sentence.end);

  const candidates = raw
    .map((clip) => {
      const start = snap(Math.min(options.duration, Math.max(0, clip.start)), starts, tolerance);
      let end = snap(Math.min(options.duration, Math.max(0, clip.end)), ends, tolerance);
      if (end - start > options.length.max * 1.5) end = start + options.length.max;
      return { ...clip, start, end, score: Math.round(Math.min(100, Math.max(0, clip.score))) };
    })
    .filter((clip) => clip.end - clip.start >= minClip)
    .sort((left, right) => right.score - left.score || left.start - right.start);

  const chosen: typeof candidates = [];
  for (const clip of candidates) {
    if (chosen.length >= options.count) break;
    if (chosen.every((other) => clip.end <= other.start || clip.start >= other.end)) chosen.push(clip);
  }
  if (chosen.length === 0) throw new HighlightResponseError("model answer contains no usable clips");
  return chosen.map((clip) => ({
    id: `h-${clip.start.toFixed(2)}`,
    start: clip.start,
    end: clip.end,
    title: clip.title.trim(),
    hook: clip.hook.trim(),
    score: clip.score,
    reasonCodes: [],
    reasonText: clip.reason.trim(),
    engine: "openai" as const,
  }));
}

/** Calls the main-process bridge and parses the answer. */
export async function findOpenAiHighlights(
  bridge: OpenAiTextBridge,
  segments: readonly TranscriptSegment[],
  options: ParseHighlightOptions,
): Promise<HighlightClip[]> {
  const request = buildHighlightRequest(segments, options);
  const answer = await bridge.chat(request);
  return parseOpenAiHighlights(answer.text, options);
}
