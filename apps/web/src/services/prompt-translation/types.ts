/**
 * Prompt translation (Chinese video prompt → English for LTX-2.5).
 *
 * LTX-2.5 keeps the mood of a Chinese prompt but drops or misreads concrete
 * objects, so the app translates before sending. Engines:
 * - `local`: Helsinki-NLP opus-mt-zh-en (ONNX, transformers.js, CPU/WASM in a
 *   worker; CC BY 4.0), after Taiwan → mainland normalisation.
 * - `openai`: the user's own OpenAI key through the desktop bridge.
 */
export type TranslationEngine = "local" | "openai";

export const TRANSLATION_ENGINES: readonly TranslationEngine[] = ["local", "openai"];

export function isTranslationEngine(value: unknown): value is TranslationEngine {
  return value === "local" || value === "openai";
}

export interface PromptTranslation {
  /** What is sent to the video model. */
  english: string;
  /** The user's text, unchanged. */
  original: string;
  /** null when the text had no Chinese and was passed through unchanged. */
  engine: TranslationEngine | null;
}

/** One engine: Chinese (possibly mixed) text in, English out. */
export interface TextTranslator {
  translate(text: string): Promise<string>;
}

/** Download progress of the local model's files (transformers.js `progress` events). */
export interface ModelDownloadProgress {
  file: string;
  loaded: number;
  total: number;
}

export class PromptTranslationError extends Error {
  readonly engine: TranslationEngine;

  constructor(engine: TranslationEngine, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PromptTranslationError";
    this.engine = engine;
  }
}
