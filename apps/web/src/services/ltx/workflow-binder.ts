/**
 * Turns a `GenerationRequest` into a ComfyUI API-format prompt.
 *
 * Bindings are found by `class_type` + `_meta.title` (case-insensitive),
 * never by node id, so re-exporting a workflow from ComfyUI (which renumbers
 * nodes) keeps working. Any binding the chosen mode needs but cannot find is
 * a `WorkflowBindingError`: the binder fails closed instead of queueing a
 * prompt that would silently ignore the user's input.
 */
import t2vJson from "./workflows/ltx25-t2v.api.json";
import i2vJson from "./workflows/ltx25-i2v.api.json";
import flf2vJson from "./workflows/ltx25-flf2v.api.json";
import ref2vJson from "./workflows/ltx25-ref2v.api.json";
import type {
  ComfyFileRef,
  GenerationAspect,
  GenerationMode,
  GenerationQuality,
  GenerationRequest,
} from "./types";

export interface ComfyApiNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

/** ComfyUI API-format prompt: node id → node. */
export type ComfyApiPrompt = Record<string, ComfyApiNode>;

export interface BinderInputs {
  /** Used for the SaveVideo filename prefix `flameblade-cut/<recordId>`. */
  recordId: string;
  /** Uploaded first frame (i2v, flf2v, extend). */
  firstImage: ComfyFileRef | null;
  /** Uploaded last frame (flf2v). */
  lastImage: ComfyFileRef | null;
  /** Uploaded reference sheet (ref2v); omitted or null for every other mode. */
  referenceSheet?: ComfyFileRef | null;
  /** LTX-2.5 transformer file the UNETLoader loads (see `model-choice.ts`). */
  transformerFile: string;
}

export class WorkflowBindingError extends Error {
  readonly missing: readonly string[];

  constructor(template: string, missing: readonly string[]) {
    super(`Workflow "${template}" cannot be bound; missing: ${missing.join(", ")}`);
    this.name = "WorkflowBindingError";
    this.missing = missing;
  }
}

/** LTX-2.5 always runs at this frame rate in Flameblade Cut. */
export const LTX_FRAME_RATE = 24;

export interface Resolution {
  width: number;
  height: number;
}

/**
 * Output sizes. All are multiples of 64 because LTX's first pass samples at
 * half size and the latent grid needs multiples of 32 there.
 */
const RESOLUTIONS: Record<GenerationAspect, Record<GenerationQuality, Resolution>> = {
  "16:9": { "480p": { width: 832, height: 448 }, "720p": { width: 1280, height: 704 } },
  "9:16": { "480p": { width: 448, height: 832 }, "720p": { width: 704, height: 1280 } },
  "1:1": { "480p": { width: 640, height: 640 }, "720p": { width: 960, height: 960 } },
};

export function resolutionFor(aspect: GenerationAspect, quality: GenerationQuality): Resolution {
  return { ...RESOLUTIONS[aspect][quality] };
}

/**
 * `ref2v` output size: the Ingredients workflow takes the video size from the
 * reference sheet scaled to a 544 px shorter side (see `reference-sheet.ts`),
 * so `quality` does not apply.
 */
const REF2V_RESOLUTIONS: Record<GenerationAspect, Resolution> = {
  "16:9": { width: 960, height: 544 },
  "9:16": { width: 544, height: 960 },
  "1:1": { width: 544, height: 544 },
};

export function ref2vResolution(aspect: GenerationAspect): Resolution {
  return { ...REF2V_RESOLUTIONS[aspect] };
}

/**
 * Negative prompt bound into the Ingredients workflow (its export leaves the
 * field empty). Same text as the t2v template's fixed negative prompt, for
 * consistency across modes. The distilled model samples at CFG 1, where
 * ComfyUI skips the negative branch, so it is effectively inert; it is set
 * so the prompt stays explicit should the CFG ever change.
 */
export const DEFAULT_NEGATIVE_PROMPT = "pc game, console game, video game, cartoon, childish, ugly";

/*
 * Time estimates — ESTIMATES ONLY, measured on the owner's RTX 5060 Ti 16 GB
 * with warm (already loaded) models, one sample per point (2026-10-12):
 *   480p: 5 s ≈ 36 s, 15 s ≈ 54 s      720p: 5 s ≈ 50 s, 15 s ≈ 138 s
 * Each quality is a straight line through its two measured points. A cold
 * start (models not yet in memory) adds ≈ 40 s.
 */
const ESTIMATE_COLD_START_SEC = 40;
const ESTIMATE_LINE: Record<GenerationQuality, { baseSec: number; perVideoSec: number }> = {
  "480p": { baseSec: 27, perVideoSec: 1.8 },
  "720p": { baseSec: 6, perVideoSec: 8.8 },
};

/*
 * ref2v (Ingredients: 22B distilled + IC-LoRA, reference sheet repeated as
 * a guide on every frame) — ESTIMATE ONLY, measured 2026-10-12 on the same
 * RTX 5060 Ti 16 GB, 16:9 (960×544), 5 s = 121 frames, warm: 4-panel sheet
 * 156 s, 8-panel sheet 162 s (panel count barely matters; the sheet size is
 * fixed). The first run after other workflows took 180 s. Only 5 s was
 * measured; other durations use the same linear model as above.
 */
const REF2V_OVERHEAD_SEC = 10;
const REF2V_SEC_PER_VIDEO_SEC = 30;

/** Rough wall-clock estimate in whole seconds (see the measurement notes above). */
export function estimateSeconds(
  request: Pick<GenerationRequest, "quality" | "durationSec"> & { mode?: GenerationMode },
  options: { warm: boolean },
): number {
  const cold = options.warm ? 0 : ESTIMATE_COLD_START_SEC;
  if (request.mode === "ref2v") {
    return Math.round(REF2V_OVERHEAD_SEC + REF2V_SEC_PER_VIDEO_SEC * request.durationSec + cold);
  }
  const line = ESTIMATE_LINE[request.quality];
  return Math.round(line.baseSec + line.perVideoSec * request.durationSec + cold);
}

type TemplateName = "ltx25-t2v" | "ltx25-i2v" | "ltx25-flf2v" | "ltx25-ref2v";

function parseApiPrompt(json: unknown, name: TemplateName): ComfyApiPrompt {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new WorkflowBindingError(name, ["a JSON object of nodes"]);
  }
  for (const [id, node] of Object.entries(json)) {
    const candidate = node as Partial<ComfyApiNode> | null;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof candidate.class_type !== "string" ||
      typeof candidate.inputs !== "object" ||
      candidate.inputs === null
    ) {
      throw new WorkflowBindingError(name, [`a valid API node at id "${id}"`]);
    }
  }
  return json as ComfyApiPrompt;
}

const TEMPLATES: Record<TemplateName, ComfyApiPrompt> = {
  "ltx25-t2v": parseApiPrompt(t2vJson, "ltx25-t2v"),
  "ltx25-i2v": parseApiPrompt(i2vJson, "ltx25-i2v"),
  "ltx25-flf2v": parseApiPrompt(flf2vJson, "ltx25-flf2v"),
  "ltx25-ref2v": parseApiPrompt(ref2vJson, "ltx25-ref2v"),
};

const TEMPLATE_FOR_MODE: Record<GenerationMode, TemplateName> = {
  t2v: "ltx25-t2v",
  i2v: "ltx25-i2v",
  extend: "ltx25-i2v",
  flf2v: "ltx25-flf2v",
  ref2v: "ltx25-ref2v",
};

export function templateNameFor(mode: GenerationMode): TemplateName {
  return TEMPLATE_FOR_MODE[mode];
}

/** Name ComfyUI's LoadImage accepts for an uploaded input file. */
export function comfyImageName(file: ComfyFileRef): string {
  return file.subfolder ? `${file.subfolder}/${file.filename}` : file.filename;
}

function normalizeTitle(title: string | undefined): string {
  return (title ?? "").trim().toLowerCase();
}

type TitleMatcher = (normalizedTitle: string) => boolean;

function titleIn(...titles: string[]): TitleMatcher {
  const wanted = new Set(titles.map((t) => t.toLowerCase()));
  return (title) => wanted.has(title);
}

/** One binding: which nodes to find and what to write into them. */
interface Binding {
  label: string;
  classType: string;
  matches: TitleMatcher;
  /** `single` requires exactly one match; `all` requires at least one and writes to every match. */
  cardinality: "single" | "all";
  apply: (node: ComfyApiNode) => void;
}

function setInput(key: string, value: unknown): (node: ComfyApiNode) => void {
  return (node) => {
    node.inputs[key] = value;
  };
}

/** Bindings every template shares: the model file, the seed and the output file name. */
function commonBindings(request: GenerationRequest, inputs: BinderInputs): Binding[] {
  return [
    {
      label: "UNETLoader",
      classType: "UNETLoader",
      matches: () => true,
      cardinality: "single",
      apply: setInput("unet_name", inputs.transformerFile),
    },
    {
      label: "RandomNoise",
      classType: "RandomNoise",
      matches: () => true,
      cardinality: "all",
      apply: setInput("noise_seed", request.seed),
    },
    {
      label: "SaveVideo",
      classType: "SaveVideo",
      matches: () => true,
      cardinality: "single",
      apply: setInput("filename_prefix", `flameblade-cut/${inputs.recordId}`),
    },
  ];
}

function bindingsFor(request: GenerationRequest, inputs: BinderInputs, missing: string[]): Binding[] {
  const specific =
    request.mode === "ref2v"
      ? ref2vBindings(request, inputs, missing)
      : frameBindings(request, inputs, missing);
  return [...specific, ...commonBindings(request, inputs)];
}

/**
 * Reference-to-video template (`ltx25-ref2v.api.json`, written for this
 * project): the LTX-2.5 Ingredients IC-LoRA guided by one reference sheet.
 * Prompts are encoded locally by the Gemma text encoder; the template has no
 * hosted-API path at all.
 */
function ref2vBindings(request: GenerationRequest, inputs: BinderInputs, missing: string[]): Binding[] {
  if (request.enhancePrompt) missing.push("prompt enhancer (not available for reference-to-video)");
  const bindings: Binding[] = [
    {
      label: 'PrimitiveStringMultiline "Prompt"',
      classType: "PrimitiveStringMultiline",
      matches: titleIn("Prompt"),
      cardinality: "single",
      apply: setInput("value", request.prompt),
    },
    {
      label: 'PrimitiveStringMultiline "Negative prompt"',
      classType: "PrimitiveStringMultiline",
      matches: titleIn("Negative prompt"),
      cardinality: "single",
      apply: setInput("value", DEFAULT_NEGATIVE_PROMPT),
    },
    {
      label: 'PrimitiveFloat "Frame rate"',
      classType: "PrimitiveFloat",
      matches: titleIn("Frame rate"),
      cardinality: "single",
      apply: setInput("value", LTX_FRAME_RATE),
    },
    {
      label: 'PrimitiveFloat "Duration"',
      classType: "PrimitiveFloat",
      matches: titleIn("Duration"),
      cardinality: "single",
      apply: setInput("value", request.durationSec),
    },
  ];
  const sheet = inputs.referenceSheet ?? null;
  if (sheet === null) {
    missing.push("uploaded reference sheet");
  } else {
    bindings.push({
      label: 'LoadImage "Reference sheet"',
      classType: "LoadImage",
      matches: titleIn("Reference sheet"),
      cardinality: "single",
      apply: setInput("image", comfyImageName(sheet)),
    });
  }
  return bindings;
}

/** t2v / i2v / flf2v / extend: the official LTX-2.5 video templates. */
function frameBindings(request: GenerationRequest, inputs: BinderInputs, missing: string[]): Binding[] {
  const { width, height } = resolutionFor(request.aspect, request.quality);
  const bindings: Binding[] = [
    {
      label: 'PrimitiveStringMultiline "Prompt"',
      classType: "PrimitiveStringMultiline",
      matches: titleIn("Prompt"),
      cardinality: "single",
      apply: setInput("value", request.prompt),
    },
    {
      label: 'PrimitiveInt "Duration"',
      classType: "PrimitiveInt",
      matches: titleIn("Duration"),
      cardinality: "single",
      apply: setInput("value", request.durationSec),
    },
    {
      label: 'PrimitiveInt "Frame Rate"',
      classType: "PrimitiveInt",
      matches: titleIn("Frame Rate", "Frame Rate(int)"),
      cardinality: "single",
      apply: setInput("value", LTX_FRAME_RATE),
    },
    {
      label: 'PrimitiveInt "Width"',
      classType: "PrimitiveInt",
      matches: titleIn("Width"),
      cardinality: "single",
      apply: setInput("value", width),
    },
    {
      label: 'PrimitiveInt "Height"',
      classType: "PrimitiveInt",
      matches: titleIn("Height"),
      cardinality: "single",
      apply: setInput("value", height),
    },
    {
      label: 'PrimitiveBoolean "Enable Prompt Enhance"',
      classType: "PrimitiveBoolean",
      matches: (title) => title.includes("enable prompt enhance"),
      cardinality: "single",
      apply: setInput("value", request.enhancePrompt),
    },
  ];

  const needsFirst = request.mode !== "t2v";
  const needsLast = request.mode === "flf2v";
  if (needsFirst) {
    if (inputs.firstImage === null) {
      missing.push("uploaded first-frame image");
    } else {
      bindings.push({
        label: 'LoadImage "Load First Frame"',
        classType: "LoadImage",
        matches: titleIn("Load First Frame"),
        cardinality: "single",
        apply: setInput("image", comfyImageName(inputs.firstImage)),
      });
    }
  }
  if (needsLast) {
    if (inputs.lastImage === null) {
      missing.push("uploaded last-frame image");
    } else {
      bindings.push({
        label: 'LoadImage "Load Last Frame"',
        classType: "LoadImage",
        matches: titleIn("Load Last Frame"),
        cardinality: "single",
        apply: setInput("image", comfyImageName(inputs.lastImage)),
      });
    }
  }
  return bindings;
}

/**
 * Returns a deep copy of the mode's template with every request value bound.
 * Throws `WorkflowBindingError` listing every missing or ambiguous binding.
 */
export function buildComfyPrompt(request: GenerationRequest, inputs: BinderInputs): ComfyApiPrompt {
  const name = templateNameFor(request.mode);
  return bindTemplate(TEMPLATES[name], name, request, inputs);
}

/** Binds `request` into a deep copy of any API-format template (exported for tests and future templates). */
export function bindTemplate(
  template: ComfyApiPrompt,
  name: string,
  request: GenerationRequest,
  inputs: BinderInputs,
): ComfyApiPrompt {
  const prompt = structuredClone(template);
  const nodes = Object.values(prompt);
  const missing: string[] = [];
  const bindings = bindingsFor(request, inputs, missing);

  const resolved: Array<{ binding: Binding; targets: ComfyApiNode[] }> = [];
  for (const binding of bindings) {
    const targets = nodes.filter(
      (node) => node.class_type === binding.classType && binding.matches(normalizeTitle(node._meta?.title)),
    );
    if (targets.length === 0) {
      missing.push(binding.label);
    } else if (binding.cardinality === "single" && targets.length > 1) {
      missing.push(`${binding.label} (ambiguous: ${targets.length} matches)`);
    } else {
      resolved.push({ binding, targets });
    }
  }
  if (missing.length > 0) {
    throw new WorkflowBindingError(name, missing);
  }
  for (const { binding, targets } of resolved) {
    targets.forEach(binding.apply);
  }
  return prompt;
}

/** Node ids of the samplers whose `progress` messages drive the progress bar. */
export function samplerNodeIds(prompt: ComfyApiPrompt): string[] {
  return Object.entries(prompt)
    .filter(([, node]) => node.class_type === "SamplerCustomAdvanced")
    .map(([id]) => id);
}
