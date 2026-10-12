import { afterEach, describe, expect, it } from "vitest";
import { i18next } from "../../../../i18n";
import { RESOURCE_LANGUAGES, stringsFor } from "../../../../i18n/resources";
import { translateServiceMessage } from "../../../../services/service-message";
import {
  elevenLabsHttpError,
  llmHttpError,
  offersSettings,
  toTtsError,
  ttsError,
  ttsErrorMessage,
  TtsRequestError,
  ttsSuccessMessage,
  type TtsErrorCode,
} from "./tts-errors";

function lookup(strings: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], strings);
}

const KEYED_CODES = [
  "empty-text",
  "session-locked",
  "missing-key",
  "invalid-key",
  "quota",
  "rate-limited",
  "network",
  "service",
  "llm-not-configured",
  "llm-session-locked",
  "llm-network",
  "llm-service",
  "enhance-failed",
  "generate-failed",
  "save-failed",
  "timeline-failed",
  "import-failed",
] as const satisfies readonly Exclude<TtsErrorCode, "unknown">[];

describe("tts errors", () => {
  const initial = i18next.language;
  afterEach(async () => {
    await i18next.changeLanguage(initial);
  });

  it.each(RESOURCE_LANGUAGES)("%s translates every error code and the success message", (language) => {
    const keys = [
      ...KEYED_CODES.map((code) => ttsErrorMessage(code).key),
      ttsErrorMessage("service", { status: 500, detail: "x" }).key,
      ttsErrorMessage("llm-service", { provider: "OpenAI", status: 500, detail: "x" }).key,
      ttsSuccessMessage("saved-to-media").key,
    ];
    const missing = keys.filter((key) => typeof lookup(stringsFor(language), key) !== "string");
    expect(missing).toEqual([]);
  });

  it("keeps the original English wording as the plain-text message", () => {
    expect(new TtsRequestError("missing-key").message).toBe("ElevenLabs API key not found. Add it in Settings > API Keys.");
    expect(new TtsRequestError("session-locked").message).toBe("Session locked. Unlock in Settings > API Keys first.");
    expect(ttsErrorMessage("service", { status: 500, detail: "" }).fallback).toBe("ElevenLabs error (500)");
  });

  it("offers Settings from the code, not the wording", () => {
    expect(offersSettings(ttsError("missing-key"))).toBe(true);
    expect(offersSettings(ttsError("invalid-key"))).toBe(true);
    expect(offersSettings(ttsError("session-locked"))).toBe(true);
    expect(offersSettings(ttsError("llm-session-locked"))).toBe(true);
    expect(offersSettings(ttsError("network"))).toBe(false);
    expect(offersSettings({ code: "unknown", message: "Your API key leaked" })).toBe(false);
  });

  it("classifies ElevenLabs responses", () => {
    expect(elevenLabsHttpError(401, {}).code).toBe("invalid-key");
    expect(elevenLabsHttpError(403, {}).code).toBe("invalid-key");
    expect(elevenLabsHttpError(401, { detail: { status: "quota_exceeded", message: "quota" } }).code).toBe("quota");
    expect(elevenLabsHttpError(429, {}).code).toBe("rate-limited");
    const server = elevenLabsHttpError(500, { detail: { message: "Upstream down" } });
    expect(server.code).toBe("service");
    expect(server.serviceMessage.params).toEqual({ status: 500, detail: "Upstream down" });
    expect(server.message).toBe("ElevenLabs error (500): Upstream down");
  });

  it("reads LLM provider error details", () => {
    const openAi = llmHttpError("OpenAI", 400, { error: { message: "bad model" } });
    expect(openAi.code).toBe("llm-service");
    expect(openAi.message).toBe("OpenAI error (400): bad model");
    expect(llmHttpError("Anthropic", 502, {}).message).toBe("Anthropic error (502)");
  });

  it("keeps uncoded errors as raw text and falls back to the given code", () => {
    expect(toTtsError(new Error("disk full"), "save-failed")).toEqual({ code: "unknown", message: "disk full" });
    expect(toTtsError("nope", "save-failed").code).toBe("save-failed");
    expect(toTtsError(new TtsRequestError("quota"), "generate-failed").code).toBe("quota");
  });

  it("translates at display time with interpolation", async () => {
    const message = ttsErrorMessage("service", { status: 503, detail: "busy" });
    await i18next.changeLanguage("zh-TW");
    expect(translateServiceMessage(i18next.t, message)).toBe("ElevenLabs 發生錯誤（503）：busy");
    await i18next.changeLanguage("en");
    expect(translateServiceMessage(i18next.t, message)).toBe("ElevenLabs error (503): busy");
  });
});
