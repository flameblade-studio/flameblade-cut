/**
 * Local MT engine: Taiwan → mainland normalisation, sentence splitting, and a
 * lazily created worker (`workers/prompt-translate-worker.ts`).
 *
 * Mixed Chinese/English text is split by `splitPromptSegments`; only Chinese
 * runs reach the model. The worker is terminated after `idleMs` without
 * requests (and by `dispose`) so the model's memory is returned before the
 * next video generation.
 */
import { joinTranslatedSegments, splitPromptSegments, splitSentences } from "./segments";
import { normaliseForMainlandMt, type ChineseConverter } from "./taiwan-normalizer";
import { PromptTranslationError, type ModelDownloadProgress, type TextTranslator } from "./types";

export type WorkerReply =
  | { requestId: string; type: "progress"; file: string; loaded: number; total: number }
  | { requestId: string; type: "result"; texts: string[] }
  | { requestId: string; type: "error"; message: string };

/** The subset of `Worker` the client uses (a fake in tests). */
export interface TranslationWorker {
  postMessage(message: { requestId: string; type: "translate"; texts: string[] }): void;
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export interface LocalEngineDeps {
  createWorker: () => TranslationWorker;
  loadConverter: () => Promise<ChineseConverter>;
  /** Terminate the worker after this long without requests. */
  idleMs: number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface LocalTranslator extends TextTranslator {
  /** Returns an unsubscribe function. */
  onProgress(listener: (progress: ModelDownloadProgress) => void): () => void;
  /** Terminates the worker (frees the model); the next request starts a new one. */
  dispose(): void;
}

interface Pending {
  resolve: (texts: string[]) => void;
  reject: (error: Error) => void;
}

export function createLocalTranslator(deps: LocalEngineDeps): LocalTranslator {
  let worker: TranslationWorker | null = null;
  let idleTimer: unknown = null;
  let nextId = 0;
  const pending = new Map<string, Pending>();
  const listeners = new Set<(progress: ModelDownloadProgress) => void>();

  const failAll = (message: string): void => {
    for (const entry of pending.values()) entry.reject(new PromptTranslationError("local", message));
    pending.clear();
  };

  const clearIdle = (): void => {
    if (idleTimer !== null) deps.clearTimer(idleTimer);
    idleTimer = null;
  };

  const dispose = (): void => {
    clearIdle();
    worker?.terminate();
    worker = null;
    failAll("Local translation was stopped");
  };

  const armIdle = (): void => {
    if (pending.size > 0 || worker === null) return;
    clearIdle();
    idleTimer = deps.setTimer(() => {
      idleTimer = null;
      if (pending.size === 0) dispose();
    }, deps.idleMs);
  };

  const ensureWorker = (): TranslationWorker => {
    if (worker) return worker;
    const created = deps.createWorker();
    created.onmessage = (event) => {
      const reply = event.data;
      if (reply.type === "progress") {
        for (const listener of listeners) listener({ file: reply.file, loaded: reply.loaded, total: reply.total });
        return;
      }
      const entry = pending.get(reply.requestId);
      if (!entry) return;
      pending.delete(reply.requestId);
      if (reply.type === "result") entry.resolve(reply.texts);
      else entry.reject(new PromptTranslationError("local", `Local translation failed: ${reply.message}`));
      armIdle();
    };
    created.onerror = (event) => {
      if (worker === created) worker = null;
      created.terminate();
      failAll(`Local translation worker crashed: ${event.message || "unknown error"}`);
    };
    worker = created;
    return created;
  };

  const runModel = (texts: string[]): Promise<string[]> => {
    clearIdle();
    const active = ensureWorker();
    const requestId = `t${++nextId}`;
    const result = new Promise<string[]>((resolve, reject) => pending.set(requestId, { resolve, reject }));
    active.postMessage({ requestId, type: "translate", texts });
    return result;
  };

  return {
    async translate(text) {
      const convert = await deps.loadConverter();
      const segments = splitPromptSegments(text);
      const sentences = segments.map((segment) =>
        segment.translate ? splitSentences(normaliseForMainlandMt(segment.text, convert)) : [],
      );
      const flat = sentences.flat();
      if (flat.length === 0) return text;
      const english = await runModel(flat);
      if (english.length !== flat.length || english.some((sentence) => sentence.trim() === "")) {
        throw new PromptTranslationError("local", "Local translation returned an empty sentence");
      }
      let cursor = 0;
      const parts = segments.map((segment, index) => {
        if (!segment.translate) return segment;
        const count = sentences[index].length;
        const joined = english
          .slice(cursor, cursor + count)
          .map((sentence) => sentence.trim())
          .join(" ");
        cursor += count;
        return { text: joined, translate: true };
      });
      return joinTranslatedSegments(parts);
    },
    onProgress(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose,
  };
}
