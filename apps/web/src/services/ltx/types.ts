/**
 * Local AI video generation (LTX-2.5 through a local ComfyUI).
 *
 * Ownership:
 * - `ComfyTransport` is implemented by the desktop bridge
 *   (`comfy-transport.ts`, backed by Electron main-process IPC) and by test
 *   fakes. The renderer never talks to ComfyUI directly: ComfyUI's
 *   cross-site protection rejects browser-origin requests with 403.
 * - Everything else in `services/ltx/` is pure TypeScript plus the
 *   generation store, and is unit-tested against a fake transport.
 */

import type { LtxModelChoice } from "./model-choice";

/** A ComfyUI file reference as reported by `/upload/image` and `/history`. */
export interface ComfyFileRef {
  filename: string;
  subfolder: string;
  type: string;
}

export interface ComfyHttpResponse {
  status: number;
  /** Response body as UTF-8 text (JSON endpoints are parsed by the caller). */
  body: string;
}

export interface ComfyLaunchConfig {
  /** ComfyUI install folder containing `main.py` and `.venv`. */
  comfyDir: string;
  /** Python arguments; must start with `main.py` (the desktop bridge refuses anything else). */
  args: string[];
  /** Optional PowerShell script run (and awaited, max 60 s) before launch, e.g. to free memory. */
  preLaunchScript: string | null;
}

export interface ComfyTransport {
  request(baseUrl: string, method: "GET" | "POST", path: string, jsonBody?: unknown): Promise<ComfyHttpResponse>;
  /** Multipart upload to `/upload/image` (subfolder `flameblade-cut`, type `input`, overwrite). */
  uploadImage(baseUrl: string, bytes: Uint8Array, filename: string): Promise<ComfyFileRef>;
  /** Streams `/view?...` straight to `destPath` on disk (via a `.part` file). */
  download(baseUrl: string, file: ComfyFileRef, destPath: string): Promise<void>;
  /** Opens `/ws?clientId=`; every text frame goes to `onMessage`, `null` signals the socket closed. */
  subscribe(baseUrl: string, clientId: string, onMessage: (text: string | null) => void): Promise<() => Promise<void>>;
  /** Spawns ComfyUI hidden (PYTHONUTF8=1). Resolves when spawned, not when ready. */
  launch(config: ComfyLaunchConfig): Promise<void>;
  /** Stops the ComfyUI process started by `launch`, if any. */
  stopLaunched(): Promise<void>;
  /** Folder where finished videos are kept, e.g. `%USERPROFILE%\Videos\Flameblade Cut`. Created on demand. */
  libraryDir(): Promise<string>;
  readFileBytes(path: string): Promise<Uint8Array<ArrayBuffer>>;
  writeTextFile(path: string, contents: string): Promise<void>;
  readTextFile(path: string): Promise<string | null>;
}

/**
 * - `t2v` text → video, `i2v` first frame → video, `flf2v` first + last frame,
 *   `extend` continues a finished video from its last frame.
 * - `ref2v` reference images → video (LTX-2.5 IC-LoRA "Ingredients"): the
 *   images are packed into one reference sheet whose aspect sets the video
 *   size (960×544, 544×960 or 544×544; `quality` does not apply).
 */
export type GenerationMode = "t2v" | "i2v" | "flf2v" | "extend" | "ref2v";
export type GenerationAspect = "16:9" | "9:16" | "1:1";
export type GenerationQuality = "480p" | "720p";
/**
 * Whole seconds. The UI offers `GENERATION_DURATIONS`; records saved by early
 * previews may hold 3 or 8, which stay valid and replayable.
 */
export type GenerationDuration = number;
export const MAX_GENERATION_SECONDS = 20;

export const GENERATION_DURATIONS: readonly GenerationDuration[] = [5, 10, 15];
export const GENERATION_ASPECTS: readonly GenerationAspect[] = ["16:9", "9:16", "1:1"];
export const GENERATION_QUALITIES: readonly GenerationQuality[] = ["480p", "720p"];

/** A local image chosen by the user (absolute path on desktop). */
export interface ImageInput {
  path: string;
  name: string;
  /**
   * ref2v only: what this reference shows ("Character: ..."), as sent to the
   * model (English when translated). Written into the Ingredients prompt.
   */
  description?: string;
}

/** Reference images per `ref2v` request (one reference sheet holds at most 12 panels). */
export const MIN_REFERENCE_IMAGES = 1;
export const MAX_REFERENCE_IMAGES = 12;

export interface GenerationRequest {
  mode: GenerationMode;
  /** What is sent to the video model (English when the prompt was translated). */
  prompt: string;
  /**
   * The user's own prompt (e.g. Traditional Chinese) when `prompt` is its
   * translation; null when no translation happened.
   */
  promptOriginal: string | null;
  aspect: GenerationAspect;
  quality: GenerationQuality;
  durationSec: GenerationDuration;
  /** 0..2^48; random per request unless the user re-runs with the same seed. */
  seed: number;
  firstImage: ImageInput | null;
  lastImage: ImageInput | null;
  /**
   * For `ref2v`: 1–12 reference images (characters, props, a scene), packed
   * into the reference sheet in this order. Empty for every other mode.
   */
  referenceImages: ImageInput[];
  /** For `extend`: the finished video whose last frame starts the new clip. */
  extendFromRecordId: string | null;
  /** LTX prompt enhancer (slower, needs the small Gemma helper model). */
  enhancePrompt: boolean;
}

export type GenerationStatus =
  | "queued"
  | "preparing"
  | "running"
  | "downloading"
  | "done"
  | "failed"
  | "canceled";

export interface GenerationRecord {
  id: string;
  createdAt: string;
  request: GenerationRequest;
  status: GenerationStatus;
  /** 0..1 sampling progress reported by ComfyUI, when known. */
  progress: number;
  /** Absolute path of the finished MP4 in the library folder. */
  outputPath: string | null;
  /** Absolute path of a JPEG/PNG poster frame, when available. */
  posterPath: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  comfyPromptId: string | null;
}

export interface StoryboardShot {
  id: string;
  prompt: string;
  image: ImageInput | null;
  durationSec: GenerationDuration;
  /** Latest generation for this shot. */
  recordId: string | null;
}

export interface Storyboard {
  aspect: GenerationAspect;
  quality: GenerationQuality;
  shots: StoryboardShot[];
}

export type ComfyConnection = "unknown" | "offline" | "starting" | "ready" | "error";

export interface LtxSettings {
  baseUrl: string;
  comfyDir: string;
  /** Start ComfyUI automatically when a generation is requested and it is offline. */
  autoLaunch: boolean;
  launchArgs: string[];
  preLaunchScript: string | null;
  /** Where finished videos are saved; null = the default library folder (Videos\Flameblade Cut). */
  outputDir: string | null;
  /** Which LTX-2.5 transformer file to load ("auto" = best installed file for the GPU). */
  model: LtxModelChoice;
}

/**
 * Defaults for a fresh install on any machine: the ComfyUI folder is chosen
 * by the user in the engine settings, and only portable launch arguments are
 * used (machine-specific speed-ups such as `--use-sage-attention` need extra
 * packages and are added by users who have them). Saved settings are kept.
 */
export const DEFAULT_LTX_SETTINGS: LtxSettings = {
  baseUrl: "http://127.0.0.1:8188",
  comfyDir: "",
  autoLaunch: true,
  launchArgs: ["main.py", "--listen", "127.0.0.1", "--port", "8188"],
  preLaunchScript: null,
  outputDir: null,
  model: "auto",
};
