/**
 * Facade: `translatePrompt(text, { engine })` → `PromptTranslation`.
 *
 * - Text without Chinese is returned unchanged (`engine: null`, no model run).
 * - Results are cached in memory per engine + exact text.
 * - Composition root: `createPromptTranslator(engines)`; the app-wide default
 *   wires the local worker and the desktop OpenAI bridge lazily.
 */
import { loadChineseConverter } from "../captions/chinese-script";
import { createLocalTranslator, type LocalTranslator, type TranslationWorker } from "./local-engine";
import { createOpenAiTranslator, type OpenAiTextBridge } from "./openai-engine";
import { containsChinese } from "./segments";
import {
  PromptTranslationError,
  type ModelDownloadProgress,
  type PromptTranslation,
  type TextTranslator,
  type TranslationEngine,
} from "./types";

export const LOCAL_IDLE_MS = 3 * 60 * 1000;
const CACHE_LIMIT = 200;

export interface PromptTranslator {
  translatePrompt(text: string, options: { engine: TranslationEngine }): Promise<PromptTranslation>;
}

export function createPromptTranslator(engines: Readonly<Record<TranslationEngine, TextTranslator>>): PromptTranslator {
  const cache = new Map<string, string>();
  return {
    async translatePrompt(text, { engine }) {
      const original = text.trim();
      if (!containsChinese(original)) return { english: original, original, engine: null };
      const key = `${engine}\u0000${original}`;
      const cached = cache.get(key);
      if (cached !== undefined) return { english: cached, original, engine };
      let english: string;
      try {
        english = (await engines[engine].translate(original)).trim();
      } catch (error) {
        if (error instanceof PromptTranslationError) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        throw new PromptTranslationError(engine, reason, { cause: error });
      }
      if (english === "") throw new PromptTranslationError(engine, "The translation came back empty");
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(key, english);
      return { english, original, engine };
    },
  };
}

let defaultLocal: LocalTranslator | null = null;
let defaultTranslator: PromptTranslator | null = null;

function localTranslator(): LocalTranslator {
  defaultLocal ??= createLocalTranslator({
    createWorker: () =>
      new Worker(new URL("../../workers/prompt-translate-worker.ts", import.meta.url), {
        type: "module",
      }) as unknown as TranslationWorker,
    loadConverter: () => loadChineseConverter("simplified"),
    idleMs: LOCAL_IDLE_MS,
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
  return defaultLocal;
}

function openAiBridge(): OpenAiTextBridge | undefined {
  return typeof window === "undefined" ? undefined : window.openreel?.openaiText;
}

/** App-wide translator (local worker + desktop OpenAI bridge). */
export function translatePrompt(text: string, options: { engine: TranslationEngine }): Promise<PromptTranslation> {
  defaultTranslator ??= createPromptTranslator({
    local: { translate: (input) => localTranslator().translate(input) },
    openai: createOpenAiTranslator(openAiBridge),
  });
  return defaultTranslator.translatePrompt(text, options);
}

/** Download progress of the local model (first use only). */
export function onLocalModelProgress(listener: (progress: ModelDownloadProgress) => void): () => void {
  return localTranslator().onProgress(listener);
}

/** Frees the local model now (it also frees itself after `LOCAL_IDLE_MS`). */
export function disposeLocalTranslator(): void {
  defaultLocal?.dispose();
}

/** Whether the user saved an OpenAI key in the desktop app. */
export async function openAiKeyConfigured(): Promise<boolean> {
  const bridge = openAiBridge();
  if (!bridge) return false;
  try {
    return (await bridge.keyStatus()).configured;
  } catch (error) {
    console.warn("[prompt-translation] could not read the OpenAI key status:", error);
    return false;
  }
}
