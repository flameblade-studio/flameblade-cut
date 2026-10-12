/**
 * The unsent generation form. Kept in a store (not component state) so the
 * draft survives switching between modes and between the AI and edit pages.
 */
import { create } from "zustand";
import {
  MAX_REFERENCE_IMAGES,
  MIN_REFERENCE_IMAGES,
  type GenerationAspect,
  type GenerationDuration,
  type GenerationMode,
  type GenerationQuality,
  type GenerationRequest,
  type ImageInput,
} from "../../services/ltx/types";
import { containsChinese } from "../../services/prompt-translation/segments";
import type { TranslationEngine } from "../../services/prompt-translation/types";

export type CreateTab = GenerationMode | "director";

export interface CreateDraft {
  tab: CreateTab;
  prompt: string;
  aspect: GenerationAspect;
  quality: GenerationQuality;
  durationSec: GenerationDuration;
  firstImage: ImageInput | null;
  lastImage: ImageInput | null;
  /** `ref2v` reference images, in sheet order (1–12). */
  referenceImages: ImageInput[];
  extendFromRecordId: string | null;
  enhancePrompt: boolean;
  /** null = random seed per generation. */
  fixedSeed: number | null;
  /** Translate prompts that contain Chinese to English before sending (form and director). */
  autoTranslate: boolean;
  translationEngine: TranslationEngine;
  /** English shown under the prompt box (from "preview" or typed by the user). */
  englishPreview: string | null;
  /** The trimmed prompt `englishPreview` belongs to; a different prompt makes it stale. */
  englishPreviewSource: string | null;
  /** The user edited `englishPreview` by hand. */
  englishEdited: boolean;
}

interface DraftState extends CreateDraft {
  patch: (patch: Partial<CreateDraft>) => void;
  swapFrames: () => void;
}

export const useCreateDraft = create<DraftState>()((set) => ({
  tab: "t2v",
  prompt: "",
  aspect: "16:9",
  quality: "720p",
  durationSec: 5,
  firstImage: null,
  lastImage: null,
  referenceImages: [],
  extendFromRecordId: null,
  enhancePrompt: false,
  fixedSeed: null,
  autoTranslate: true,
  translationEngine: "local",
  englishPreview: null,
  englishPreviewSource: null,
  englishEdited: false,
  patch: (patch) => {
    set(patch);
  },
  swapFrames: () => {
    set((state) => ({ firstImage: state.lastImage, lastImage: state.firstImage }));
  },
}));

export type DraftProblem = "needPrompt" | "needFirst" | "needLast" | "needSource" | "needReferences" | "tooManyReferences";

/** Why the draft cannot be generated yet, or null when it is ready. */
export function draftProblem(draft: CreateDraft): DraftProblem | null {
  if (draft.tab === "director") return null;
  if (draft.prompt.trim() === "") return "needPrompt";
  if ((draft.tab === "i2v" || draft.tab === "flf2v") && !draft.firstImage) return "needFirst";
  if (draft.tab === "flf2v" && !draft.lastImage) return "needLast";
  if (draft.tab === "extend" && !draft.extendFromRecordId) return "needSource";
  if (draft.tab === "ref2v" && draft.referenceImages.length < MIN_REFERENCE_IMAGES) return "needReferences";
  if (draft.tab === "ref2v" && draft.referenceImages.length > MAX_REFERENCE_IMAGES) return "tooManyReferences";
  return null;
}

/** Random seed in [0, 2^48). */
export function randomSeed(): number {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return (words[0] ?? 0) * 0x10000 + ((words[1] ?? 0) & 0xffff);
}

export function draftToRequest(draft: CreateDraft, mode: GenerationMode): GenerationRequest {
  return {
    mode,
    prompt: draft.prompt.trim(),
    promptOriginal: null,
    aspect: draft.aspect,
    quality: draft.quality,
    durationSec: draft.durationSec,
    seed: draft.fixedSeed ?? randomSeed(),
    firstImage: mode === "i2v" || mode === "flf2v" ? draft.firstImage : null,
    lastImage: mode === "flf2v" ? draft.lastImage : null,
    referenceImages: mode === "ref2v" ? [...draft.referenceImages] : [],
    extendFromRecordId: mode === "extend" ? draft.extendFromRecordId : null,
    // The Ingredients (ref2v) workflow has no prompt enhancer.
    enhancePrompt: mode === "ref2v" ? false : draft.enhancePrompt,
  };
}

/**
 * What to do with the prompt on Generate:
 * - `none`: send as written (translation off, or no Chinese);
 * - `use`: send the preview English (edited or not) made for this exact prompt;
 * - `translate`: translate first (no preview, or the prompt changed since).
 */
export type TranslationPlan = { kind: "none" } | { kind: "use"; english: string } | { kind: "translate" };

export function translationPlan(
  draft: Pick<CreateDraft, "prompt" | "autoTranslate" | "englishPreview" | "englishPreviewSource">,
): TranslationPlan {
  const prompt = draft.prompt.trim();
  if (!draft.autoTranslate || !containsChinese(prompt)) return { kind: "none" };
  const english = draft.englishPreview?.trim() ?? "";
  if (english !== "" && draft.englishPreviewSource === prompt) return { kind: "use", english };
  return { kind: "translate" };
}

/** Puts a prompt back into the form (e.g. "use this prompt"), dropping any stale English preview. */
export function promptPatch(prompt: string): Partial<CreateDraft> {
  return { prompt, englishPreview: null, englishPreviewSource: null, englishEdited: false };
}

/** Picks the generation aspect closest to an image's width/height ratio. */
export function nearestAspect(width: number, height: number): GenerationAspect {
  const ratio = width / height;
  const candidates: [GenerationAspect, number][] = [
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
    ["1:1", 1],
  ];
  return candidates.reduce((best, current) =>
    Math.abs(Math.log(current[1] / ratio)) < Math.abs(Math.log(best[1] / ratio)) ? current : best,
  )[0];
}
