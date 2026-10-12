/**
 * Promise wrapper around the existing local Whisper worker
 * (`workers/whisper-worker.ts`), speaking the same message protocol as
 * `components/editor/inspector/AutoCaptionPanel.tsx`. The worker cannot stop
 * mid-transcription, so cancelling terminates it; the next call starts a fresh
 * worker (the model reloads from the browser cache).
 */
import { DEFAULT_WHISPER_MODEL, type WhisperModelKey } from "../../workers/whisper-models";
import type { WhisperChunk } from "./transcript";

export type WhisperEvent =
  | { readonly kind: "model-download"; readonly progress: number }
  | { readonly kind: "transcribing" };

export interface TranscribeRequest {
  readonly samples: Float32Array;
  /** ISO 639-1 code, or undefined to let Whisper detect the language. */
  readonly language: string | undefined;
  readonly model?: WhisperModelKey;
  readonly onEvent?: (event: WhisperEvent) => void;
  readonly signal?: AbortSignal;
}

export class TranscriptionCancelledError extends Error {
  constructor() {
    super("transcription cancelled");
    this.name = "TranscriptionCancelledError";
  }
}

export class WhisperClient {
  private worker: Worker | null = null;

  private ensureWorker(): Worker {
    this.worker ??= new Worker(new URL("../../workers/whisper-worker.ts", import.meta.url), { type: "module" });
    return this.worker;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  transcribe(request: TranscribeRequest): Promise<WhisperChunk[]> {
    if (request.signal?.aborted) return Promise.reject(new TranscriptionCancelledError());
    const worker = this.ensureWorker();
    const requestId = crypto.randomUUID();
    return new Promise<WhisperChunk[]>((resolve, reject) => {
      const cleanup = (): void => {
        worker.removeEventListener("message", onMessage);
        request.signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = (): void => {
        cleanup();
        this.dispose();
        reject(new TranscriptionCancelledError());
      };
      const onMessage = (event: MessageEvent<Record<string, unknown>>): void => {
        if (event.data.requestId !== requestId) return;
        const type = event.data.type;
        if (type === "model-progress") {
          const raw = Number(event.data.progress ?? 0);
          request.onEvent?.({ kind: "model-download", progress: raw > 1 ? raw / 100 : raw });
        } else if (type === "transcription-progress") {
          request.onEvent?.({ kind: "transcribing" });
        } else if (type === "result") {
          cleanup();
          resolve(Array.isArray(event.data.chunks) ? (event.data.chunks as WhisperChunk[]) : []);
        } else if (type === "error") {
          cleanup();
          reject(new Error(String(event.data.message ?? "Local transcription failed.")));
        }
      };
      worker.addEventListener("message", onMessage);
      request.signal?.addEventListener("abort", onAbort, { once: true });
      // Copy so the caller's buffer survives the transfer.
      const audio = request.samples.slice();
      worker.postMessage(
        { requestId, type: "transcribe", audio, language: request.language, model: request.model ?? DEFAULT_WHISPER_MODEL },
        [audio.buffer],
      );
    });
  }
}
