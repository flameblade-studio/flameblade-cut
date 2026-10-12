/**
 * Bilingual captions (雙語字幕): translates caption lines through the desktop
 * OpenAI text bridge (`window.openreel.openaiText`, main process holds the
 * key). No local LLM is used.
 *
 * Lines are sent in batches (default 40) with short per-batch ids; the reply
 * must be strict JSON `{ "items": [{ "id", "text" }] }` covering exactly the
 * batch's ids once each, with non-empty text. A batch that fails validation
 * or throws is discarded as a whole — never partially applied — and its
 * lines are reported as failed so the caller can retry only those.
 */

export interface OpenAiTextChatRequest {
  readonly instructions: string;
  readonly input: string;
  readonly jsonSchema: { readonly name: string; readonly schema: Record<string, unknown> };
  readonly maxOutputTokens?: number;
  readonly reasoningEffort?: "low" | "medium" | "high";
}

export interface OpenAiTextChatReply {
  readonly text: string;
  readonly model: string;
}

/** Minimal shape of the desktop bridge this module depends on. */
export interface CaptionTranslationBridge {
  chat(request: OpenAiTextChatRequest): Promise<OpenAiTextChatReply>;
  keyStatus?(): Promise<{ configured: boolean }>;
}

export const TRANSLATION_TARGETS = [
  { id: "zh-TW", label: "繁體中文", promptName: "Traditional Chinese as used in Taiwan (台灣繁體中文用語)" },
  { id: "en", label: "English", promptName: "natural English" },
  { id: "ja", label: "日本語", promptName: "natural Japanese" },
  { id: "zh-CN", label: "简体中文", promptName: "Simplified Chinese as used in mainland China" },
  { id: "ko", label: "한국어", promptName: "natural Korean" },
] as const;

export type TranslationTargetId = (typeof TRANSLATION_TARGETS)[number]["id"];

export interface TranslatableLine {
  readonly id: string;
  readonly text: string;
}

export interface TranslationOutcome {
  /** Line id → translated text, from batches that fully validated. */
  readonly translations: ReadonlyMap<string, string>;
  /** Ids of lines whose batch failed (nothing applied for them). */
  readonly failedIds: readonly string[];
  /** First batch error message, when any batch failed. */
  readonly firstError: string | null;
}

export const DEFAULT_TRANSLATION_BATCH_SIZE = 40;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, text: { type: "string" } },
        required: ["id", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

/** The desktop OpenAI text bridge when present (absent on the web build). */
export function getCaptionTranslationBridge(): CaptionTranslationBridge | null {
  if (typeof window === "undefined") return null;
  return window.openreel?.openaiText ?? null;
}

export function translationInstructions(target: TranslationTargetId): string {
  const name = TRANSLATION_TARGETS.find((entry) => entry.id === target)?.promptName ?? target;
  return [
    `Translate each video caption line into ${name}.`,
    "Keep the meaning, tone and brevity of spoken subtitles; one output line per input line.",
    "Do not merge, split, skip, reorder or explain lines. Keep names, numbers and emoji.",
    'Return JSON {"items":[{"id","text"}]} with exactly the given ids.',
  ].join(" ");
}

/** Validates one batch reply; throws on any mismatch. */
export function parseTranslationReply(
  replyText: string,
  expectedIds: readonly string[],
): Map<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(replyText);
  } catch {
    throw new Error("translation reply is not valid JSON");
  }
  const items = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(items)) throw new Error("translation reply has no items array");
  const expected = new Set(expectedIds);
  const result = new Map<string, string>();
  for (const item of items) {
    const id = (item as { id?: unknown })?.id;
    const text = (item as { text?: unknown })?.text;
    if (typeof id !== "string" || typeof text !== "string") {
      throw new Error("translation item is malformed");
    }
    if (!expected.has(id)) throw new Error(`translation reply has unknown id ${id}`);
    if (result.has(id)) throw new Error(`translation reply repeats id ${id}`);
    const clean = text.replace(/\s*\n\s*/g, " ").trim();
    if (!clean) throw new Error(`translation for id ${id} is empty`);
    result.set(id, clean);
  }
  if (result.size !== expected.size) throw new Error("translation reply is missing lines");
  return result;
}

export async function translateCaptionLines(
  lines: readonly TranslatableLine[],
  target: TranslationTargetId,
  bridge: CaptionTranslationBridge,
  options: {
    batchSize?: number;
    signal?: AbortSignal;
    onProgress?(done: number, total: number): void;
  } = {},
): Promise<TranslationOutcome> {
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_TRANSLATION_BATCH_SIZE);
  const pending = lines.filter((line) => line.text.trim().length > 0);
  const translations = new Map<string, string>();
  const failedIds: string[] = [];
  let firstError: string | null = null;

  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    if (options.signal?.aborted) {
      failedIds.push(...batch.map((line) => line.id));
      firstError ??= "cancelled";
      continue;
    }
    const localIds = batch.map((_, index) => String(index + 1));
    try {
      const reply = await bridge.chat({
        instructions: translationInstructions(target),
        input: JSON.stringify({
          items: batch.map((line, index) => ({ id: localIds[index], text: line.text })),
        }),
        jsonSchema: { name: "caption_translation", schema: RESPONSE_SCHEMA },
        reasoningEffort: "low",
      });
      const parsed = parseTranslationReply(reply.text, localIds);
      batch.forEach((line, index) => translations.set(line.id, parsed.get(localIds[index])!));
    } catch (error) {
      failedIds.push(...batch.map((line) => line.id));
      firstError ??= error instanceof Error ? error.message : String(error);
    }
    options.onProgress?.(Math.min(offset + batch.length, pending.length), pending.length);
  }
  return { translations, failedIds, firstError };
}
