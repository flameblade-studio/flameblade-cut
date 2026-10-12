/// <reference lib="webworker" />

import { env, pipeline } from "@huggingface/transformers";
import {
  DEFAULT_WHISPER_MODEL,
  WHISPER_MODELS,
  isWhisperModelKey,
  type WhisperModelKey,
} from "./whisper-models";

// Official Hugging Face hub (the upstream build used an OpenReel mirror). Both
// models derive from openai/whisper-* (MIT); verified 2026-10-12.
const MODEL_HOST = "https://huggingface.co/";

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.remoteHost = MODEL_HOST;
env.remotePathTemplate = "{model}/resolve/{revision}/";
env.useBrowserCache = true;

interface WhisperOutput {
  text: string;
  chunks?: Array<{
    text: string;
    timestamp: [number | null, number | null];
  }>;
}

type WhisperPipeline = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<WhisperOutput | WhisperOutput[]>;
const createPipeline = pipeline as unknown as (
  task: string,
  model: string,
  options: Record<string, unknown>,
) => Promise<WhisperPipeline>;
interface LoadedWhisperModel {
  readonly transcriber: WhisperPipeline;
  readonly backend: "webgpu" | "wasm";
}

const transcriberPromises = new Map<
  WhisperModelKey,
  Promise<LoadedWhisperModel>
>();

function post(requestId: string, payload: Record<string, unknown>): void {
  self.postMessage({ requestId, ...payload });
}

function progressCallback(requestId: string) {
  return (event: Record<string, unknown>) => {
    post(requestId, {
      type: "model-progress",
      status: event.status,
      file: event.file,
      progress: event.progress,
      loaded: event.loaded,
      total: event.total,
    });
  };
}

async function createWhisperModel(
  requestId: string,
  modelKey: WhisperModelKey,
): Promise<LoadedWhisperModel> {
  const modelId = WHISPER_MODELS[modelKey].id;
  const canUseWebGPU = modelKey === "accurate" && "gpu" in navigator;

  if (canUseWebGPU) {
    try {
      const transcriber = await createPipeline(
        "automatic-speech-recognition",
        modelId,
        {
          device: "webgpu",
          dtype: "q4",
          progress_callback: progressCallback(requestId),
        },
      );
      return { transcriber, backend: "webgpu" };
    } catch (error) {
      console.warn("[Whisper] WebGPU unavailable; falling back to WASM", error);
    }
  }

  const transcriber = await createPipeline(
    "automatic-speech-recognition",
    modelId,
    {
      device: "wasm",
      dtype: "q4",
      progress_callback: progressCallback(requestId),
    },
  );
  return { transcriber, backend: "wasm" };
}

function loadModel(
  requestId: string,
  modelKey: WhisperModelKey,
): Promise<LoadedWhisperModel> {
  let modelPromise = transcriberPromises.get(modelKey);
  if (!modelPromise) {
    modelPromise = createWhisperModel(requestId, modelKey);
    transcriberPromises.set(modelKey, modelPromise);
    modelPromise.catch(() => {
      transcriberPromises.delete(modelKey);
    });
  }
  return modelPromise;
}

self.onmessage = async (
  event: MessageEvent<{
    requestId: string;
    type: "load" | "transcribe";
    audio?: Float32Array;
    language?: string;
    model?: WhisperModelKey;
    /** Ask for word-level timestamps (needs a `_timestamped` model). */
    wordTimestamps?: boolean;
  }>,
) => {
  const { requestId, type, audio, language, wordTimestamps } = event.data;
  const modelKey = isWhisperModelKey(event.data.model)
    ? event.data.model
    : DEFAULT_WHISPER_MODEL;
  try {
    const { transcriber, backend } = await loadModel(requestId, modelKey);
    if (type === "load") {
      post(requestId, { type: "ready", model: modelKey, backend });
      return;
    }
    if (!audio?.length) throw new Error("The selected clip has no decodable audio.");

    post(requestId, { type: "transcription-progress", progress: 0.05 });
    const options = {
      language,
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    };
    let granularity: "word" | "segment" = "segment";
    let output: WhisperOutput | WhisperOutput[];
    if (wordTimestamps && WHISPER_MODELS[modelKey].id.endsWith("_timestamped")) {
      try {
        output = await transcriber(audio, { ...options, return_timestamps: "word" });
        granularity = "word";
      } catch (error) {
        // Word alignment is optional; segment timestamps always work.
        console.warn("[Whisper] word timestamps unavailable; using segments", error);
        output = await transcriber(audio, { ...options, return_timestamps: true });
      }
    } else {
      output = await transcriber(audio, { ...options, return_timestamps: true });
    }
    const result = Array.isArray(output) ? output[0] : output;
    post(requestId, {
      type: "result",
      text: result.text,
      chunks: result.chunks ?? [],
      granularity,
      model: modelKey,
      backend,
    });
  } catch (error) {
    post(requestId, {
      type: "error",
      message: error instanceof Error ? error.message : "Local transcription failed.",
    });
  }
};

export {};
