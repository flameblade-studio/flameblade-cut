/**
 * Which LTX-2.5 transformer file a generation loads. Lightricks publishes the
 * same distilled 22B transformer in three formats; the workflows are
 * identical apart from the UNETLoader file name:
 *   - nvfp4: 4-bit, fastest, needs an NVIDIA Blackwell GPU (RTX 50 series)
 *   - int8:  comfy int8 (convrot), for RTX 30/40 series and other NVIDIA GPUs
 *   - bf16:  full precision, largest (about 42 GB)
 * "auto" picks the best installed file for the GPU ComfyUI reports.
 */
export type LtxTransformer = "nvfp4" | "int8" | "bf16";
export type LtxModelChoice = "auto" | LtxTransformer;

export const LTX_TRANSFORMERS: readonly LtxTransformer[] = ["nvfp4", "int8", "bf16"];
export const LTX_MODEL_CHOICES: readonly LtxModelChoice[] = ["auto", ...LTX_TRANSFORMERS];

export const LTX_TRANSFORMER_FILES: Record<LtxTransformer, string> = {
  nvfp4: "ltx-2.5-22b-distilled-transformer-nvfp4.safetensors",
  int8: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
  bf16: "ltx-2.5-22b-distilled-transformer-bf16.safetensors",
};

/** NVFP4 kernels exist only on Blackwell GPUs (GeForce RTX 50 series, RTX PRO Blackwell). */
export function supportsNvfp4(gpuName: string): boolean {
  return /RTX\s*50\d\d|Blackwell/i.test(gpuName);
}

export type ModelResolution =
  | { ok: true; transformer: LtxTransformer; file: string }
  | { ok: false; reason: "missing"; wanted: readonly string[] }
  | { ok: false; reason: "nvfp4-unsupported"; gpuName: string };

/**
 * Picks the transformer to load.
 * @param installed  diffusion model file names ComfyUI can load (UNETLoader options)
 * @param gpuName    ComfyUI's device name, or null when it is not known
 */
export function resolveTransformer(
  choice: LtxModelChoice,
  installed: readonly string[],
  gpuName: string | null,
): ModelResolution {
  const has = (transformer: LtxTransformer) => installed.includes(LTX_TRANSFORMER_FILES[transformer]);
  const pick = (transformer: LtxTransformer): ModelResolution => ({
    ok: true,
    transformer,
    file: LTX_TRANSFORMER_FILES[transformer],
  });
  const nvfp4Works = gpuName === null || supportsNvfp4(gpuName);

  if (choice !== "auto") {
    if (!has(choice)) return { ok: false, reason: "missing", wanted: [LTX_TRANSFORMER_FILES[choice]] };
    if (choice === "nvfp4" && !nvfp4Works && gpuName !== null) return { ok: false, reason: "nvfp4-unsupported", gpuName };
    return pick(choice);
  }

  if (has("nvfp4") && nvfp4Works) return pick("nvfp4");
  if (has("int8")) return pick("int8");
  if (has("bf16")) return pick("bf16");
  if (has("nvfp4") && gpuName !== null) return { ok: false, reason: "nvfp4-unsupported", gpuName };
  return { ok: false, reason: "missing", wanted: LTX_TRANSFORMERS.map((transformer) => LTX_TRANSFORMER_FILES[transformer]) };
}

/** Error message prefix the record card turns into a localized explanation. */
export const MODEL_ERROR_PREFIX = "[ltx-model:";

export function modelErrorMessage(resolution: Extract<ModelResolution, { ok: false }>): string {
  return resolution.reason === "missing"
    ? `${MODEL_ERROR_PREFIX}missing] ComfyUI has none of: ${resolution.wanted.join(", ")}`
    : `${MODEL_ERROR_PREFIX}nvfp4-unsupported] ${resolution.gpuName} cannot run the NVFP4 model`;
}

/** The model error kind of a stored record error, if it is one. */
export function modelErrorKind(error: string | null): "missing" | "nvfp4-unsupported" | null {
  if (error === null || !error.startsWith(MODEL_ERROR_PREFIX)) return null;
  const kind = error.slice(MODEL_ERROR_PREFIX.length, error.indexOf("]"));
  return kind === "missing" || kind === "nvfp4-unsupported" ? kind : null;
}

/**
 * Reads the diffusion model names from ComfyUI's `/object_info/UNETLoader`
 * reply. ComfyUI has used two shapes for combo inputs: `[[...names], {...}]`
 * and `["COMBO", { options: [...names] }]`.
 */
export function unetNamesFromObjectInfo(json: unknown): string[] {
  const spec = (json as { UNETLoader?: { input?: { required?: { unet_name?: unknown } } } } | null)?.UNETLoader?.input?.required
    ?.unet_name;
  if (!Array.isArray(spec)) return [];
  const [first, second] = spec as [unknown, unknown];
  if (Array.isArray(first)) return first.filter((name): name is string => typeof name === "string");
  const options = (second as { options?: unknown } | undefined)?.options;
  return Array.isArray(options) ? options.filter((name): name is string => typeof name === "string") : [];
}

/** The first device name in ComfyUI's `/system_stats` reply, e.g. "cuda:0 NVIDIA GeForce RTX 5060 Ti : cudaMallocAsync". */
export function gpuNameFromSystemStats(json: unknown): string | null {
  const devices = (json as { devices?: unknown } | null)?.devices;
  if (!Array.isArray(devices) || devices.length === 0) return null;
  const name = (devices[0] as { name?: unknown }).name;
  return typeof name === "string" && name.trim() !== "" ? name : null;
}
