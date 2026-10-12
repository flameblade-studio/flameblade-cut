import { z } from "zod";
import type {
  CreationAssetRecipe,
  CreationScene,
} from "../../../../packages/core/src/creation/index";

export { CHANNELS } from "./channels";

export const hardwareInfoSchema = z.object({
  cpu: z.object({
    model: z.string(),
    physicalCores: z.number().int().nonnegative(),
    logicalCores: z.number().int().nonnegative(),
  }),
  memory: z.object({
    totalBytes: z.number().nonnegative(),
    freeBytes: z.number().nonnegative(),
  }),
  gpus: z.array(z.string()),
  encoders: z.array(z.string()),
  platform: z.enum(["darwin", "win32", "linux"]),
  arch: z.string(),
});

export type HardwareInfo = z.infer<typeof hardwareInfoSchema>;

export const saveDialogArgsSchema = z.object({
  defaultPath: z.string(),
  filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })),
});
export const openDialogArgsSchema = z.object({
  filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })),
});
export const writeFileArgsSchema = z.object({ path: z.string(), data: z.string() });
export const readFileArgsSchema = z.object({ path: z.string() });

export const proxyArgsSchema = z.object({
  srcPath: z.string(),
  preset: z.enum(["low", "medium", "high"]),
});
export const transcodeArgsSchema = z.object({
  srcPath: z.string(),
  container: z.enum(["mp4", "webm", "mov"]).default("mp4"),
  videoBitrateKbps: z.number().int().positive().default(5000),
  audioBitrateKbps: z.number().int().positive().default(192),
});
export const extractAudioArgsSchema = z.object({
  srcPath: z.string(),
  streamIndex: z.number().int().nonnegative().optional(),
  format: z.enum(["editor", "speech"]).optional(),
});
export const probeAudioArgsSchema = z.object({ srcPath: z.string() });
export const fetchUrlArgsSchema = z.object({
  url: z.string().url(),
  maxBytes: z.number().int().positive().optional(),
});

export const riggingBackendModeSchema = z.enum(["configured", "bundled", "system"]);
export type RiggingBackendMode = z.infer<typeof riggingBackendModeSchema>;

export const riggingBackendProbeSchema = z.object({
  available: z.boolean(),
  provider: z.literal("blender"),
  mode: riggingBackendModeSchema.optional(),
  path: z.string().optional(),
  version: z.string().optional(),
  error: z.string().optional(),
});
export type RiggingBackendProbe = z.infer<typeof riggingBackendProbeSchema>;

export const riggingWarningSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
});

export const rigHumanoidModelArgsSchema = z.object({
  modelUrl: z.string().min(1),
  outputPath: z.string().optional(),
  name: z.string().optional(),
  heightMeters: z.number().positive().optional(),
  overwriteExisting: z.boolean().optional(),
});
export type RigHumanoidModelArgs = z.infer<typeof rigHumanoidModelArgsSchema>;

export const rigHumanoidModelResultSchema = z.object({
  ok: z.boolean(),
  provider: z.literal("blender"),
  inputUrl: z.string(),
  outputUrl: z.string().optional(),
  outputPath: z.string().optional(),
  armatureName: z.string().optional(),
  createdArmature: z.boolean(),
  preservedExistingArmature: z.boolean(),
  skinnedMeshCount: z.number().int().nonnegative(),
  meshCount: z.number().int().nonnegative(),
  boneCount: z.number().int().nonnegative(),
  warnings: z.array(riggingWarningSchema),
  error: z.string().optional(),
});
export type RigHumanoidModelResult = z.infer<typeof rigHumanoidModelResultSchema>;

export const cloudFetchArgsSchema = z.object({
  service: z.enum([
    "elevenlabs",
    "openai",
    "anthropic",
    "openai-compatible",
    "anthropic-compatible",
  ]),
  path: z.string(),
  method: z.string().optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  baseUrl: z.string().optional(),
});

export interface AuroraRenderPreviewArgs {
  readonly scene: CreationScene;
  readonly assets: readonly CreationAssetRecipe[];
  readonly width: number;
  readonly height: number;
  readonly background?: string;
  readonly timeSeconds?: number;
  readonly quality?: "preview" | "final";
}

export const auroraRenderPreviewArgsSchema = z.object({
  scene: z.unknown(),
  assets: z.array(z.unknown()),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
  background: z.string().optional(),
  timeSeconds: z.number().nonnegative().optional(),
  quality: z.enum(["preview", "final"]).optional(),
});

export interface AuroraPreviewSessionStartArgs extends AuroraRenderPreviewArgs {
  readonly sessionId?: string;
}

export const auroraPreviewSessionStartArgsSchema = auroraRenderPreviewArgsSchema.extend({
  sessionId: z.string().min(1).max(128).optional(),
});

export const auroraPreviewSessionStartResultSchema = z.object({
  sessionId: z.string().min(1).max(128),
});
export type AuroraPreviewSessionStartResult = z.infer<
  typeof auroraPreviewSessionStartResultSchema
>;

export const auroraRenderPreviewResultSchema = z.object({
  backend: z.enum(["native", "cpu"]),
  pngBase64: z.string(),
  dataUri: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  coveredPixels: z.number().int().nonnegative(),
  shadowedPixels: z.number().int().nonnegative(),
  renderMs: z.number().nonnegative(),
});
export type AuroraRenderPreviewResult = z.infer<typeof auroraRenderPreviewResultSchema>;

export const auroraPreviewSessionCancelArgsSchema = z.object({
  sessionId: z.string().min(1).max(128),
});

export const auroraPreviewSessionEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("update"),
    sessionId: z.string().min(1).max(128),
    stage: z.enum(["draft", "refine", "final"]),
    progress: z.number().min(0).max(1),
    done: z.boolean(),
    targetWidth: z.number().int().positive(),
    targetHeight: z.number().int().positive(),
    result: auroraRenderPreviewResultSchema,
  }),
  z.object({
    kind: z.literal("error"),
    sessionId: z.string().min(1).max(128),
    done: z.literal(true),
    error: z.string(),
  }),
]);
export type AuroraPreviewSessionEvent = z.infer<
  typeof auroraPreviewSessionEventSchema
>;

export interface AuroraSequenceRenderArgs {
  readonly scene: CreationScene;
  readonly assets: readonly CreationAssetRecipe[];
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly durationSeconds: number;
  readonly background?: string;
  readonly quality?: "preview" | "final";
}

export const auroraSequenceRenderArgsSchema = z.object({
  scene: z.unknown(),
  assets: z.array(z.unknown()),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
  frameRate: z.number().positive().max(240),
  durationSeconds: z.number().positive().max(7200),
  background: z.string().optional(),
  quality: z.enum(["preview", "final"]).optional(),
});

export interface AuroraSequenceSessionStartArgs extends AuroraSequenceRenderArgs {
  readonly sessionId?: string;
}

export const auroraSequenceSessionStartArgsSchema =
  auroraSequenceRenderArgsSchema.extend({
    sessionId: z.string().min(1).max(128).optional(),
  });

export const auroraSequenceSessionStartResultSchema = z.object({
  sessionId: z.string().min(1).max(128),
});
export type AuroraSequenceSessionStartResult = z.infer<
  typeof auroraSequenceSessionStartResultSchema
>;

export interface AuroraSequenceFrameResult {
  readonly backend: "native" | "cpu";
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly coveredPixels: number;
  readonly shadowedPixels: number;
  readonly renderMs: number;
}

export const auroraSequenceFrameResultSchema = z.object({
  backend: z.enum(["native", "cpu"]),
  rgba: z.instanceof(Uint8Array),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  coveredPixels: z.number().int().nonnegative(),
  shadowedPixels: z.number().int().nonnegative(),
  renderMs: z.number().nonnegative(),
});

export const auroraSequenceSessionCancelArgsSchema = z.object({
  sessionId: z.string().min(1).max(128),
});

export const auroraSequenceSessionEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("frame"),
    sessionId: z.string().min(1).max(128),
    frameIndex: z.number().int().nonnegative(),
    totalFrames: z.number().int().positive(),
    timeSeconds: z.number().nonnegative(),
    progress: z.number().min(0).max(1),
    done: z.boolean(),
    result: auroraSequenceFrameResultSchema,
  }),
  z.object({
    kind: z.literal("error"),
    sessionId: z.string().min(1).max(128),
    done: z.literal(true),
    error: z.string(),
  }),
]);
export type AuroraSequenceSessionEvent = z.infer<
  typeof auroraSequenceSessionEventSchema
>;

export const windowControlArgsSchema = z.object({
  action: z.enum(["minimize", "toggleMaximize", "close"]),
});

export const audioStreamInfoSchema = z.object({
  index: z.number().int(),
  codec: z.string(),
  channels: z.number().int(),
  sampleRate: z.number().int(),
  language: z.string().optional(),
});
export type AudioStreamInfo = z.infer<typeof audioStreamInfoSchema>;

// --- Local ComfyUI bridge (main-process HTTP/WebSocket client + launcher) ---

/** Drive-letter (`C:\` or `C:/`), UNC (`\\server`) or POSIX absolute path. */
export const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

const absolutePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => ABSOLUTE_PATH_PATTERN.test(value), "path must be absolute");

/** Loopback-only enforcement happens in `main/ipc/comfy.ts`; this only checks shape. */
const comfyBaseUrlSchema = z.string().url().max(256);

export const comfyFileRefSchema = z.object({
  filename: z.string().min(1).max(512),
  subfolder: z.string().max(512),
  type: z.string().min(1).max(32),
});
export type ComfyFileRef = z.infer<typeof comfyFileRefSchema>;

export const comfyRequestArgsSchema = z.object({
  baseUrl: comfyBaseUrlSchema,
  method: z.enum(["GET", "POST"]),
  path: z.string().startsWith("/").max(4096),
  jsonBody: z.unknown().optional(),
});
export type ComfyRequestArgs = z.infer<typeof comfyRequestArgsSchema>;

export const comfyUploadImageArgsSchema = z.object({
  baseUrl: comfyBaseUrlSchema,
  bytes: z.union([z.instanceof(Uint8Array), z.instanceof(ArrayBuffer)]),
  filename: z.string().min(1).max(255),
});

export const comfyDownloadArgsSchema = z.object({
  baseUrl: comfyBaseUrlSchema,
  file: comfyFileRefSchema,
  destPath: absolutePathSchema,
});

export const comfySubscribeArgsSchema = z.object({
  subscriptionId: z.string().min(1).max(128),
  baseUrl: comfyBaseUrlSchema,
  clientId: z.string().min(1).max(128),
});

export const comfyUnsubscribeArgsSchema = z.object({
  subscriptionId: z.string().min(1).max(128),
});

/** Pushed on `CHANNELS.comfyWsEvent`; `text: null` means the socket closed. */
export interface ComfyWsEvent {
  readonly subscriptionId: string;
  readonly text: string | null;
}

export const comfyLaunchConfigSchema = z.object({
  comfyDir: absolutePathSchema,
  // The first argument must be ComfyUI's entry script so the IPC surface can
  // only start ComfyUI, never arbitrary Python (`-c ...`).
  args: z
    .array(z.string().max(1024))
    .min(1)
    .max(64)
    .refine((args) => args[0] === "main.py", "args must start with main.py"),
  preLaunchScript: absolutePathSchema
    .refine((value) => value.toLowerCase().endsWith(".ps1"), "preLaunchScript must be a .ps1 file")
    .nullable(),
});
export type ComfyLaunchConfig = z.infer<typeof comfyLaunchConfigSchema>;

export const comfyPathArgsSchema = z.object({ path: absolutePathSchema });

export const comfyWriteTextFileArgsSchema = z.object({
  path: absolutePathSchema,
  contents: z.string(),
});

// --- Voiceover (text-to-speech; network calls and keys stay in main) ---

export const VOICE_ENGINES = ["windows", "azure", "openai"] as const;
export const voiceEngineSchema = z.enum(VOICE_ENGINES);
export type VoiceEngine = z.infer<typeof voiceEngineSchema>;

/** KeyStore ids of the cloud keys; the renderer only ever learns whether they are set. */
export const VOICE_KEY_IDS = {
  azure: "flameblade.azure-speech-key",
  openai: "flameblade.openai-key",
} as const;

export const VOICE_MAX_TEXT_CHARS = 5000;

const azureRegionSchema = z.string().max(40).optional();

export const voiceListArgsSchema = z.object({
  engine: voiceEngineSchema,
  azureRegion: azureRegionSchema,
});
export type VoiceListArgs = z.infer<typeof voiceListArgsSchema>;

export const voiceSynthesizeArgsSchema = z.object({
  engine: voiceEngineSchema,
  text: z
    .string()
    .max(VOICE_MAX_TEXT_CHARS)
    .refine((value) => value.trim().length > 0, "text must not be empty"),
  voice: z.string().min(1).max(256),
  /** 1.0 = natural speed (the default; never applied unless set). */
  rate: z.number().min(0.5).max(2).optional(),
  /** OpenAI steerable models only. */
  instructions: z.string().max(1000).optional(),
  azureRegion: azureRegionSchema,
});
export type VoiceSynthesizeArgs = z.infer<typeof voiceSynthesizeArgsSchema>;

export interface VoiceInfo {
  readonly engine: VoiceEngine;
  /** Value to pass back as `voice` (OneCore display name, Azure ShortName, OpenAI voice). */
  readonly id: string;
  readonly name: string;
  /** BCP 47 tag, or "multilingual" for OpenAI. */
  readonly language: string;
  readonly gender?: string;
}

export interface VoiceSynthesizeResult {
  /** Absolute path of the WAV under `<userData>/voiceover/`. */
  readonly path: string;
  readonly durationSec: number;
  /** Voice actually used (OneCore reports its display name). */
  readonly voice: string;
  readonly bytes: Uint8Array;
}

export interface VoiceKeyStatus {
  readonly azure: boolean;
  readonly openai: boolean;
}
