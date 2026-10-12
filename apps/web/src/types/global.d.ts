export {};

export interface OpenReelHardwareInfo {
  cpu: { model: string; physicalCores: number; logicalCores: number };
  memory: { totalBytes: number; freeBytes: number };
  gpus: string[];
  encoders: string[];
  platform: "darwin" | "win32" | "linux";
  arch: string;
}

export interface OpenReelExportStartArgs {
  width: number;
  height: number;
  frameRate: number;
  codec: string;
  format: string;
  bitrateKbps: number;
  outputPath: string;
  totalFrames: number;
  audioSampleRate: number;
  audioChannels: number;
  encodeMode?: "fast" | "balanced" | "smallest";
  quality?: number;
  proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
}

export interface OpenReelExportSession {
  jobId: string;
}

export interface OpenReelAuroraRenderPreviewArgs {
  scene: unknown;
  assets: unknown[];
  width: number;
  height: number;
  background?: string;
  timeSeconds?: number;
  quality?: "preview" | "final";
}

export interface OpenReelAuroraPreviewSessionStartArgs
  extends OpenReelAuroraRenderPreviewArgs {
  sessionId?: string;
}

export interface OpenReelAuroraPreviewSessionStartResult {
  sessionId: string;
}

export interface OpenReelAuroraSequenceSessionStartArgs
  extends Omit<OpenReelAuroraRenderPreviewArgs, "timeSeconds"> {
  sessionId?: string;
  frameRate: number;
  durationSeconds: number;
}

export interface OpenReelAuroraSequenceSessionStartResult {
  sessionId: string;
}

export interface OpenReelAuroraRenderPreviewResult {
  backend: "native" | "cpu";
  pngBase64: string;
  dataUri: string;
  width: number;
  height: number;
  coveredPixels: number;
  shadowedPixels: number;
  renderMs: number;
}

export type OpenReelAuroraPreviewSessionEvent =
  | {
      kind: "update";
      sessionId: string;
      stage: "draft" | "refine" | "final";
      progress: number;
      done: boolean;
      targetWidth: number;
      targetHeight: number;
      result: OpenReelAuroraRenderPreviewResult;
    }
  | {
      kind: "error";
      sessionId: string;
      done: true;
      error: string;
    };

export type OpenReelAuroraSequenceSessionEvent =
  | {
      kind: "frame";
      sessionId: string;
      frameIndex: number;
      totalFrames: number;
      timeSeconds: number;
      progress: number;
      done: boolean;
      result: {
        backend: "native" | "cpu";
        rgba: Uint8Array;
        width: number;
        height: number;
        coveredPixels: number;
        shadowedPixels: number;
        renderMs: number;
      };
    }
  | {
      kind: "error";
      sessionId: string;
      done: true;
      error: string;
    };

export interface OpenReelMcpStatus {
  running: boolean;
  url: string;
  port: number;
  token: string;
  shimPath: string;
  endpointFile: string;
}

export interface OpenReelRiggingBackendProbe {
  available: boolean;
  provider: "blender";
  mode?: "configured" | "bundled" | "system";
  path?: string;
  version?: string;
  error?: string;
}

export interface OpenReelRiggingWarning {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface OpenReelRigHumanoidModelArgs {
  modelUrl: string;
  outputPath?: string;
  name?: string;
  heightMeters?: number;
  overwriteExisting?: boolean;
}

export interface OpenReelRigHumanoidModelResult {
  ok: boolean;
  provider: "blender";
  inputUrl: string;
  outputUrl?: string;
  outputPath?: string;
  armatureName?: string;
  createdArmature: boolean;
  preservedExistingArmature: boolean;
  skinnedMeshCount: number;
  meshCount: number;
  boneCount: number;
  warnings: OpenReelRiggingWarning[];
  error?: string;
}

export interface OpenReelComfyFileRef {
  filename: string;
  subfolder: string;
  type: string;
}

/** Pushed by the main process; `text: null` means the ComfyUI websocket closed. */
export interface OpenReelComfyWsEvent {
  subscriptionId: string;
  text: string | null;
}

export type OpenReelVoiceEngine = "windows" | "azure" | "openai";

export interface OpenReelVoiceInfo {
  engine: OpenReelVoiceEngine;
  /** Value to pass back as `voice`. */
  id: string;
  name: string;
  /** BCP 47 tag, or "multilingual" (OpenAI). */
  language: string;
  gender?: string;
}

export interface OpenReelVoiceSynthesizeArgs {
  engine: OpenReelVoiceEngine;
  text: string;
  voice: string;
  /** 1.0 = natural speed; omit to keep the engine default. */
  rate?: number;
  instructions?: string;
  azureRegion?: string;
}

export interface OpenReelVoiceSynthesizeResult {
  path: string;
  durationSec: number;
  voice: string;
  bytes: Uint8Array;
}

export type OpenReelUpdaterStatus =
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "none" }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

declare global {
  interface Window {
    openreel?: {
      platform: "desktop";
      publicOrigin: string;
      probeHardware(): Promise<OpenReelHardwareInfo>;
      onMenuAction(cb: (id: string) => void): () => void;
      fs: {
        showSaveDialog(opts: {
          defaultPath: string;
          filters: { name: string; extensions: string[] }[];
        }): Promise<string | null>;
        showOpenDialog(opts: {
          filters: { name: string; extensions: string[] }[];
        }): Promise<string | null>;
        /** Folder picker; resolves to null when cancelled. */
        showOpenFolderDialog(): Promise<string | null>;
        /** Multi-select; resolves to [] when cancelled. */
        showOpenFilesDialog(opts: {
          filters: { name: string; extensions: string[] }[];
        }): Promise<string[]>;
        readFile(path: string): Promise<string>;
        readFileBytes(path: string): Promise<ArrayBuffer>;
        tempFilePath(ext: string): Promise<string>;
        writeFile(path: string, data: string): Promise<void>;
        openWrite(path: string): Promise<string>;
        writeChunk(handleId: string, data: ArrayBuffer | Uint8Array, position: number): Promise<void>;
        closeWrite(handleId: string): Promise<void>;
        abortWrite(handleId: string): Promise<void>;
        revealInFolder(path: string): Promise<void>;
      };
      keychain: {
        get(id: string): Promise<string | null>;
        set(id: string, value: string): Promise<void>;
        delete(id: string): Promise<void>;
      };
      export: {
        start(args: OpenReelExportStartArgs): Promise<OpenReelExportSession>;
        writeAudioWav(jobId: string, wav: ArrayBuffer): Promise<void>;
        writeAudioChunk(jobId: string, chunk: ArrayBuffer, position: number): Promise<void>;
        finishAudio(jobId: string): Promise<void>;
        cancel(jobId: string): Promise<void>;
      };
      aurora?: {
        renderPreview(
          args: OpenReelAuroraRenderPreviewArgs,
        ): Promise<OpenReelAuroraRenderPreviewResult>;
        startPreviewSession(
          args: OpenReelAuroraPreviewSessionStartArgs,
        ): Promise<OpenReelAuroraPreviewSessionStartResult>;
        cancelPreviewSession(sessionId: string): Promise<void>;
        onPreviewEvent(
          cb: (event: OpenReelAuroraPreviewSessionEvent) => void,
        ): () => void;
        startSequenceSession(
          args: OpenReelAuroraSequenceSessionStartArgs,
        ): Promise<OpenReelAuroraSequenceSessionStartResult>;
        cancelSequenceSession(sessionId: string): Promise<void>;
        onSequenceEvent(
          cb: (event: OpenReelAuroraSequenceSessionEvent) => void,
        ): () => void;
      };
      cloud: {
        fetch(
          service:
            | "elevenlabs"
            | "openai"
            | "anthropic"
            | "openai-compatible"
            | "anthropic-compatible",
          path: string,
          options?: {
            method?: string;
            headers?: Record<string, string>;
            body?: string;
            baseUrl?: string;
          },
        ): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: ArrayBuffer }>;
      };
      win: {
        minimize(): Promise<void>;
        toggleMaximize(): Promise<void>;
        close(): Promise<void>;
        isMaximized(): Promise<boolean>;
        /** Fires whenever the window is maximized or restored; returns an unsubscribe function. */
        onMaximizedChange?(cb: (maximized: boolean) => void): () => void;
      };
      lifecycle: {
        onQueryUnsaved(handler: () => boolean): () => void;
        onFlush(handler: () => Promise<void>): () => void;
      };
      updater: {
        onStatus(cb: (status: OpenReelUpdaterStatus) => void): () => void;
        download(): Promise<void>;
        install(): Promise<void>;
      };
      crash: {
        report(payload: { message: string; stack?: string; type?: string; context?: unknown }): void;
      };
      mcp?: {
        onRequest(
          handler: (req: {
            callId: string;
            kind: "listTools" | "callTool";
            name?: string;
            args?: Record<string, unknown>;
          }) => Promise<{ ok: boolean; result?: unknown; error?: string }>,
        ): () => void;
        getStatus(): Promise<OpenReelMcpStatus>;
        rotateToken(): Promise<OpenReelMcpStatus>;
        testConnection(): Promise<{ ok: boolean; message?: string; toolCount?: number }>;
      };
      media: {
        generateProxy(args: { srcPath: string; preset: "low" | "medium" | "high" }): Promise<{ outPath: string }>;
        transcode(args: {
          srcPath: string;
          container?: "mp4" | "webm" | "mov";
          videoBitrateKbps?: number;
          audioBitrateKbps?: number;
        }): Promise<{ outPath: string }>;
        extractAudioWav(args: {
          srcPath: string;
          streamIndex?: number;
          /** "speech" = 16 kHz mono 16-bit (recognition); default "editor" = 48 kHz stereo float. */
          format?: "editor" | "speech";
        }): Promise<{ outPath: string }>;
        probeAudioStreams(args: { srcPath: string }): Promise<{
          streams: { index: number; codec: string; channels: number; sampleRate: number; language?: string }[];
        }>;
        fetchUrl(args: { url: string; maxBytes?: number }): Promise<{
          ok: boolean;
          status: number;
          statusText: string;
          contentType: string;
          body: ArrayBuffer;
          error?: string;
        }>;
      };
      comfy?: {
        request(args: {
          baseUrl: string;
          method: "GET" | "POST";
          path: string;
          jsonBody?: unknown;
        }): Promise<{ status: number; body: string }>;
        uploadImage(args: {
          baseUrl: string;
          bytes: Uint8Array;
          filename: string;
        }): Promise<OpenReelComfyFileRef>;
        download(args: { baseUrl: string; file: OpenReelComfyFileRef; destPath: string }): Promise<void>;
        subscribe(args: { subscriptionId: string; baseUrl: string; clientId: string }): Promise<void>;
        unsubscribe(subscriptionId: string): Promise<void>;
        onWsEvent(cb: (event: OpenReelComfyWsEvent) => void): () => void;
        launch(config: { comfyDir: string; args: string[]; preLaunchScript: string | null }): Promise<void>;
        stopLaunched(): Promise<void>;
        libraryDir(): Promise<string>;
        readFileBytes(path: string): Promise<Uint8Array>;
        writeTextFile(path: string, contents: string): Promise<void>;
        readTextFile(path: string): Promise<string | null>;
      };
      voice?: {
        listVoices(args: { engine: OpenReelVoiceEngine; azureRegion?: string }): Promise<OpenReelVoiceInfo[]>;
        synthesize(args: OpenReelVoiceSynthesizeArgs): Promise<OpenReelVoiceSynthesizeResult>;
        /** Whether a cloud key is stored; the key itself never reaches the renderer. */
        keyStatus(): Promise<{ azure: boolean; openai: boolean }>;
      };
      openaiText?: {
        chat(args: {
          instructions: string;
          input: string;
          jsonSchema: { name: string; schema: Record<string, unknown> };
          maxOutputTokens?: number;
          reasoningEffort?: "low" | "medium" | "high";
          /** Vision input: at most 12 base64 png/jpeg/webp data URLs, 8 MB each, 24 MB total. */
          images?: readonly { dataUrl: string; detail?: "low" | "high" | "auto" }[];
        }): Promise<{ text: string; model: string }>;
        keyStatus(): Promise<{ configured: boolean }>;
      };
      rigging?: {
        probeBackend(): Promise<OpenReelRiggingBackendProbe>;
        rigHumanoidModel(
          args: OpenReelRigHumanoidModelArgs,
        ): Promise<OpenReelRigHumanoidModelResult>;
      };
    };
  }
}
