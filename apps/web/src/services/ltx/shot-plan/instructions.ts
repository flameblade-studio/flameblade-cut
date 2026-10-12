/**
 * What the planners are told, and how their answers are read back. Kept in
 * one place so the OpenAI and local Gemma planners stay in step.
 */
import type { GenerationMode } from "../types";
import type { NormalizedRect, PanelPlan, ShotPlan } from "./types";

const NAMES_RULE =
  "Write every name of a person or place in English: pinyin for Chinese names (林可芸 → Lin Keyun, 高雄 → Kaohsiung), and use exactly the same name every time it appears.";

const MODE_HINT: Record<GenerationMode, string> = {
  t2v: "The video is generated from text only.",
  i2v: "The video starts from the user's image; describe how that scene moves on.",
  flf2v: "The video goes from the user's first image to their last image; describe what happens in between.",
  extend: "The video continues an existing clip; describe what happens next.",
  ref2v: "The video uses a reference sheet of the panels described below; keep every character's look exactly as described.",
};

/** Asks for one sentence about a single reference image (local planner, one call per image). */
export const PANEL_SYSTEM_PROMPT = [
  "You describe one reference image for a video model.",
  "Answer with ONE English sentence of at most 40 words: what the main subject is and how it looks.",
  "For a person: gender, apparent age, hair, face, clothing with colors, and props. For an object or a place: shape, material, colors, mood.",
  "If the image is a design sheet or a poster with several pictures, describe the main character it shows.",
  "Ignore all printed text, logos, captions and labels.",
  NAMES_RULE,
  "Answer with the sentence only.",
].join("\n");

export function panelUserPrompt(note: string | undefined): string {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? "Describe this reference image." : `Describe this reference image. The user says it shows: ${trimmed}`;
}

/** Asks for the one shot (local planner, after the panels are described). */
export function shotSystemPrompt(durationSec: number): string {
  return [
    "You write prompts for the LTX-2.5 video model.",
    "The user writes in any language and any style, often a whole screenplay with many beats.",
    `Turn it into ONE continuous shot of about ${durationSec} seconds: the setting and light, the characters on screen, what they wear, the single most important action, the camera movement, and at most one short line of dialogue in quotes with how it is said.`,
    "Drop everything that would need a cut, a second scene or more time.",
    "Present tense, 60 to 120 words, English only.",
    NAMES_RULE,
    "Answer with the shot description only.",
  ].join("\n");
}

export function shotUserPrompt(mode: GenerationMode, request: string, panels: readonly string[]): string {
  const lines = [MODE_HINT[mode]];
  if (panels.length > 0) {
    lines.push("Reference panels:");
    panels.forEach((panel, index) => lines.push(`${index + 1}. ${panel}`));
  }
  lines.push("User request:", request.trim());
  return lines.join("\n");
}

/** One call with every reference image (OpenAI planner). */
export function openAiInstructions(mode: GenerationMode, durationSec: number, referenceCount: number): string {
  const lines = [shotSystemPrompt(durationSec), "", MODE_HINT[mode]];
  if (referenceCount > 0) {
    lines.push(
      "",
      `The user attached ${referenceCount} reference images, in order, after their request. For each image return:`,
      "- description: ONE English sentence of at most 40 words about the main subject and its look (for a person: gender, apparent age, hair, face, clothing with colors, props). Ignore printed text, logos and captions. Use the same names as in the shot.",
      "- crop: when the image holds extra material around that subject (text blocks, other small pictures, wide empty margins, several unrelated figures), the tightest box in 0..1 image coordinates (x, y = top-left) that still contains the whole subject — for a character design sheet, the full-body front/side/back views of the main character; for a poster, the main character. Otherwise null.",
      "Return the images in the order given.",
    );
  }
  return lines.join("\n");
}

const RECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "width", "height"],
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
  },
} as const;

/** Structured Outputs schema for the OpenAI planner (strict: every field required). */
export const SHOT_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["shot", "panels"],
  properties: {
    shot: { type: "string" },
    panels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "crop"],
        properties: {
          description: { type: "string" },
          crop: { anyOf: [RECT_SCHEMA, { type: "null" }] },
        },
      },
    },
  },
} as const;

/** Smallest crop side kept, as a share of the image; smaller boxes are treated as mistakes. */
const MIN_CROP_SIDE = 0.15;

/** Clamps a model-made box into the image; null when it is not a usable crop. */
export function sanitizeCrop(value: unknown): NormalizedRect | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const left = Math.min(Math.max(x as number, 0), 1);
  const top = Math.min(Math.max(y as number, 0), 1);
  const right = Math.min(Math.max((x as number) + (width as number), 0), 1);
  const bottom = Math.min(Math.max((y as number) + (height as number), 0), 1);
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  const rect = { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) };
  if (rect.width < MIN_CROP_SIDE || rect.height < MIN_CROP_SIDE) return null;
  // A box that keeps almost everything is not worth the resampling.
  if (rect.width > 0.97 && rect.height > 0.97) return null;
  return rect;
}

/** First line, without quotes or a "PANEL:"-style prefix the small model sometimes adds. */
export function cleanSentence(text: string): string {
  return text
    .trim()
    .replace(/^(panel|shot|description)\s*\d*\s*[:：-]\s*/iu, "")
    .replace(/^["“'](.*)["”']$/su, "$1")
    .trim();
}

/** Reads the OpenAI planner's JSON; throws when it does not match the references. */
export function parseOpenAiPlan(json: string, referenceCount: number): ShotPlan {
  const data = JSON.parse(json) as { shot?: unknown; panels?: unknown };
  if (typeof data.shot !== "string" || data.shot.trim() === "") throw new Error("the plan has no shot");
  const rawPanels = Array.isArray(data.panels) ? data.panels : [];
  if (rawPanels.length !== referenceCount) {
    throw new Error(`the plan describes ${rawPanels.length} references, expected ${referenceCount}`);
  }
  const panels: PanelPlan[] = rawPanels.map((panel) => {
    const record = (panel ?? {}) as { description?: unknown; crop?: unknown };
    return {
      description: typeof record.description === "string" ? cleanSentence(record.description) : "",
      crop: sanitizeCrop(record.crop),
    };
  });
  return { shot: data.shot.trim(), panels };
}
