/**
 * OpenAI translation through the desktop bridge (`window.openreel.openaiText`);
 * the API key never leaves the Electron main process.
 */
import { PromptTranslationError, type TextTranslator } from "./types";

export interface OpenAiTextBridge {
  chat(args: {
    instructions: string;
    input: string;
    jsonSchema: { name: string; schema: Record<string, unknown> };
    maxOutputTokens?: number;
    reasoningEffort?: "low" | "medium" | "high";
  }): Promise<{ text: string; model: string }>;
  keyStatus(): Promise<{ configured: boolean }>;
}

export const OPENAI_TRANSLATION_INSTRUCTIONS = [
  "You translate Taiwan Mandarin video prompts into vivid, literal English for a text-to-video model.",
  "Read every word with its Taiwan meaning: 機車 = scooter/motorcycle (never a car, bus or tram), 捷運 = MRT/metro, 騎樓 = arcade sidewalk (covered walkway under shop-houses), 夜市 = night market, 便利商店 = convenience store, 路邊攤 = street food stall, 廟口 = temple square/temple entrance, 颱風天 = typhoon day, 珍珠奶茶 = bubble tea (tapioca pearl milk tea), 公車 = city bus, 腳踏車 = bicycle, 計程車 = taxi.",
  "Keep every concrete object, colour, count, action, camera move and sound. Do not add, remove, summarise or embellish anything.",
  "Camera terms: 搖 = pan/tilt, 推 = push in/dolly in, 拉 = pull back, 跟拍 = tracking shot, 俯拍 = high angle, 仰拍 = low angle.",
  "Text that is already English stays exactly as written, in place.",
  'Reply with JSON {"english": "..."} only.',
].join("\n");

const RESPONSE_SCHEMA = {
  name: "prompt_translation",
  schema: {
    type: "object",
    properties: { english: { type: "string" } },
    required: ["english"],
    additionalProperties: false,
  },
} as const;

export function parseOpenAiTranslation(text: string): string {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new PromptTranslationError("openai", "OpenAI returned a reply that is not JSON", { cause: error });
  }
  const english = typeof json === "object" && json !== null ? (json as { english?: unknown }).english : undefined;
  if (typeof english !== "string" || english.trim() === "") {
    throw new PromptTranslationError("openai", "OpenAI returned an empty translation");
  }
  return english.trim();
}

export function createOpenAiTranslator(getBridge: () => OpenAiTextBridge | undefined): TextTranslator {
  return {
    async translate(text) {
      const bridge = getBridge();
      if (!bridge) throw new PromptTranslationError("openai", "OpenAI translation needs the desktop app");
      let reply: { text: string };
      try {
        reply = await bridge.chat({
          instructions: OPENAI_TRANSLATION_INSTRUCTIONS,
          input: text,
          jsonSchema: { name: RESPONSE_SCHEMA.name, schema: { ...RESPONSE_SCHEMA.schema } },
          maxOutputTokens: 2000,
          reasoningEffort: "low",
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new PromptTranslationError("openai", `OpenAI translation failed: ${reason}`, { cause: error });
      }
      return parseOpenAiTranslation(reply.text);
    },
  };
}
