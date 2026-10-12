import { describe, expect, it } from "vitest";
import {
  getCaptionTranslationBridge,
  parseTranslationReply,
  translateCaptionLines,
  type CaptionTranslationBridge,
  type OpenAiTextChatRequest,
} from "./caption-translation";

function fakeBridge(reply: (items: { id: string; text: string }[], call: number) => unknown) {
  const requests: OpenAiTextChatRequest[] = [];
  const bridge: CaptionTranslationBridge = {
    async chat(request) {
      requests.push(request);
      const { items } = JSON.parse(request.input) as { items: { id: string; text: string }[] };
      const value = reply(items, requests.length);
      if (value instanceof Error) throw value;
      return { text: typeof value === "string" ? value : JSON.stringify(value), model: "fake" };
    },
  };
  return { bridge, requests };
}

const lines = Array.from({ length: 85 }, (_, index) => ({ id: `clip-${index}`, text: `第${index}句` }));

describe("caption translation", () => {
  it("batches 40 lines per request and maps ids back", async () => {
    const { bridge, requests } = fakeBridge((items) => ({
      items: items.map((item) => ({ id: item.id, text: `EN ${item.text}` })),
    }));
    const progress: number[] = [];
    const outcome = await translateCaptionLines(lines, "en", bridge, {
      onProgress: (done) => progress.push(done),
    });
    expect(requests).toHaveLength(3);
    expect(requests[0].jsonSchema.name).toBe("caption_translation");
    expect(requests[0].instructions).toContain("English");
    expect(outcome.failedIds).toEqual([]);
    expect(outcome.translations.get("clip-0")).toBe("EN 第0句");
    expect(outcome.translations.get("clip-84")).toBe("EN 第84句");
    expect(progress).toEqual([40, 80, 85]);
  });

  it("never partially applies a failed batch", async () => {
    const { bridge } = fakeBridge((items, call) =>
      call === 2
        ? { items: items.slice(1).map((item) => ({ id: item.id, text: "partial" })) }
        : { items: items.map((item) => ({ id: item.id, text: "ok" })) },
    );
    const outcome = await translateCaptionLines(lines, "ja", bridge);
    expect(outcome.translations.size).toBe(45);
    expect(outcome.failedIds).toHaveLength(40);
    expect(outcome.failedIds[0]).toBe("clip-40");
    expect([...outcome.translations.values()].every((text) => text === "ok")).toBe(true);
    expect(outcome.firstError).toMatch(/missing/);
  });

  it("treats bridge errors as failed batches", async () => {
    const { bridge } = fakeBridge(() => new Error("openai-text:missing-key: no key"));
    const outcome = await translateCaptionLines(lines.slice(0, 3), "ko", bridge);
    expect(outcome.translations.size).toBe(0);
    expect(outcome.failedIds).toEqual(["clip-0", "clip-1", "clip-2"]);
    expect(outcome.firstError).toContain("missing-key");
  });

  it("validates replies strictly", () => {
    expect(() => parseTranslationReply("not json", ["1"])).toThrow(/JSON/);
    expect(() => parseTranslationReply('{"items":[{"id":"9","text":"x"}]}', ["1"])).toThrow(/unknown/);
    expect(() =>
      parseTranslationReply('{"items":[{"id":"1","text":"a"},{"id":"1","text":"b"}]}', ["1"]),
    ).toThrow(/repeats/);
    expect(() => parseTranslationReply('{"items":[{"id":"1","text":"  "}]}', ["1"])).toThrow(/empty/);
    expect(parseTranslationReply('{"items":[{"id":"1","text":" a\\nb "}]}', ["1"]).get("1")).toBe("a b");
  });

  it("reports no bridge outside the desktop app", () => {
    expect(getCaptionTranslationBridge()).toBeNull();
  });
});
