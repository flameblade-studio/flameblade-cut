/**
 * Shot planning: the step between the user and the video model. The user
 * writes the way they like (any language, a whole screenplay, posters and
 * design-sheet pages as references); a planner turns that into what LTX-2.5
 * understands: one continuous English shot, an English description of each
 * reference image, and (when the planner can see well enough) a crop that
 * keeps only the useful part of each reference.
 *
 * Two planners implement the same contract:
 * - `openai`: the user's OpenAI key, one call with every reference image;
 * - `local`: LTX's bundled Gemma helper model running in ComfyUI (free,
 *   nothing leaves the computer), one look per reference image.
 */
import type { GenerationMode, ImageInput, NormalizedRect, ShotPlannerEngine } from "../types";

export type { NormalizedRect, ShotPlannerEngine };

export interface ShotPlanReference {
  /** `image.description` is the user's optional note ("林可芸的設定圖"). */
  image: ImageInput;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface ShotPlanInput {
  mode: GenerationMode;
  /** The user's own words: any language, any length (a whole screenplay is fine). */
  request: string;
  durationSec: number;
  /** ref2v only: the references in sheet order; empty for other modes. */
  references: readonly ShotPlanReference[];
}

export interface PanelPlan {
  /** One English sentence: who or what the reference shows and how it looks. */
  description: string;
  /** The useful part of the reference image, or null to keep it whole. */
  crop: NormalizedRect | null;
}

export interface ShotPlan {
  /** One continuous shot in English, ready for the video model. */
  shot: string;
  /** Same order as `ShotPlanInput.references`. */
  panels: PanelPlan[];
}

export interface ShotPlanner {
  plan(input: ShotPlanInput, signal: AbortSignal): Promise<ShotPlan>;
}

export class ShotPlanError extends Error {
  constructor(
    readonly engine: ShotPlannerEngine,
    message: string,
  ) {
    super(`[shot-plan:${engine}] ${message}`);
    this.name = "ShotPlanError";
  }
}
