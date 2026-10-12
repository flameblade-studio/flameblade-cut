/**
 * The local zh→en model. Chosen over Xenova/m2m100_418M (MIT, ~630 MB) after
 * a 11-prompt Taiwan evaluation (2026-10-12): opus-mt kept more concrete
 * objects and colours and is ~5x smaller.
 *
 * Base model: Helsinki-NLP/opus-mt-zh-en, CC BY 4.0 (attribution in README).
 */
export const LOCAL_TRANSLATION_MODEL = {
  id: "Xenova/opus-mt-zh-en",
  dtype: "q8",
  /** encoder 52.9 MB + decoder 60.2 MB + tokenizer/vocab files. */
  downloadSize: "≈ 115 MB",
  downloadBytes: 115_000_000,
  license: "CC BY 4.0 (Helsinki-NLP/opus-mt-zh-en)",
} as const;
