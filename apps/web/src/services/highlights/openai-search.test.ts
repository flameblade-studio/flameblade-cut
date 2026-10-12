import { describe, expect, it } from "vitest";
import { syntheticTalk } from "./fixtures";
import {
  HIGHLIGHT_JSON_SCHEMA,
  HighlightResponseError,
  buildHighlightRequest,
  findOpenAiHighlights,
  formatTranscriptForPrompt,
  parseOpenAiHighlights,
  type OpenAiTextBridge,
} from "./openai-highlights";
import { basicNormalizer, createScriptNormalizer, createTaiwanConverter, searchTranscript } from "./search";
import { buildSentences } from "./transcript";
import { LENGTH_RANGES } from "./types";

const sentences = buildSentences(syntheticTalk());
const OPTIONS = { duration: 600, length: LENGTH_RANGES.short, count: 3, sentences };

function answer(clips: unknown[]): string {
  return JSON.stringify({ clips });
}

const GOOD = { start: 60.6, end: 75.2, title: "剪輯節奏的祕訣", hook: "你知道嗎？", score: 92, reason: "有清楚的技巧" };

describe("OpenAI highlight request", () => {
  it("formats the transcript with second timestamps and asks for Taiwan wording", () => {
    expect(formatTranscriptForPrompt([{ start: 1, end: 4.25, text: "你好" }])).toBe("[1.0-4.3] 你好");
    const request = buildHighlightRequest(sentences, OPTIONS);
    expect(request.instructions).toContain("between 15 and 30 seconds");
    expect(request.instructions).toContain("Taiwan Traditional Chinese");
    expect(request.jsonSchema.name).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(request.input.split("\n")).toHaveLength(sentences.length);
  });

  it("uses a strict-compatible schema (every property required, no extra properties)", () => {
    const item = (HIGHLIGHT_JSON_SCHEMA.properties as { clips: { items: { required: string[]; properties: object; additionalProperties: boolean } } }).clips.items;
    expect(item.additionalProperties).toBe(false);
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
    expect(HIGHLIGHT_JSON_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("parseOpenAiHighlights", () => {
  it("snaps times to sentence boundaries and keeps model text", () => {
    const [clip] = parseOpenAiHighlights(answer([GOOD]), OPTIONS);
    expect(clip.start).toBe(61);
    expect(clip.end).toBe(75);
    expect(clip.title).toBe("剪輯節奏的祕訣");
    expect(clip.reasonText).toBe("有清楚的技巧");
    expect(clip.engine).toBe("openai");
  });

  it("rejects malformed JSON and wrong shapes", () => {
    expect(() => parseOpenAiHighlights("{clips: [", OPTIONS)).toThrow(HighlightResponseError);
    expect(() => parseOpenAiHighlights('{"items": []}', OPTIONS)).toThrow(/no clips array/);
    expect(() => parseOpenAiHighlights(answer([{ ...GOOD, start: "60" }]), OPTIONS)).toThrow(/start is not a number/);
    expect(() => parseOpenAiHighlights(answer([{ ...GOOD, title: null }]), OPTIONS)).toThrow(/title is not a string/);
    expect(() => parseOpenAiHighlights(answer([]), OPTIONS)).toThrow(/no usable clips/);
  });

  it("clamps to the video, drops too-short/reversed clips and overlaps, sorts by score and caps the count", () => {
    const clips = parseOpenAiHighlights(
      answer([
        { ...GOOD, start: 590, end: 700, score: 50 },
        { ...GOOD, start: 100, end: 101, score: 99 },
        { ...GOOD, start: 200, end: 180, score: 99 },
        { ...GOOD, start: 65, end: 80, score: 80 },
        { ...GOOD, score: 150 },
        { ...GOOD, start: 300, end: 320, score: 70 },
        { ...GOOD, start: 400, end: 420, score: 10 },
      ]),
      OPTIONS,
    );
    expect(clips.map((clip) => [clip.start, clip.score])).toEqual([
      [61, 100],
      [301, 70],
      [591, 50],
    ]);
    expect(clips[2].end).toBe(600);
  });

  it("caps an over-long clip at the maximum length", () => {
    const [clip] = parseOpenAiHighlights(answer([{ ...GOOD, start: 100, end: 200 }]), OPTIONS);
    expect(clip.end - clip.start).toBe(30);
  });

  it("goes through the bridge", async () => {
    const calls: unknown[] = [];
    const bridge: OpenAiTextBridge = {
      chat: async (args) => {
        calls.push(args);
        return { text: answer([GOOD]), model: "gpt-6.1-sol" };
      },
      keyStatus: async () => ({ configured: true }),
    };
    const clips = await findOpenAiHighlights(bridge, sentences, OPTIONS);
    expect(clips).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

describe("transcript search", () => {
  const segments = [
    { start: 1, end: 3, text: "今天來聊剪輯軟體" },
    { start: 4, end: 6, text: "这个软件很好用" },
    { start: 7, end: 9, text: "Ｈｅｌｌｏ World" },
  ];

  it("matches case- and width-insensitively", () => {
    expect(searchTranscript(segments, "hello", basicNormalizer).map((match) => match.start)).toEqual([7]);
    expect(searchTranscript(segments, "   ", basicNormalizer)).toEqual([]);
  });

  it("matches Traditional and Simplified Chinese interchangeably via OpenCC", async () => {
    const normalize = await createScriptNormalizer();
    expect(searchTranscript(segments, "軟體", normalize).map((match) => match.start)).toEqual([1]);
    expect(searchTranscript(segments, "軟件", normalize).map((match) => match.start)).toEqual([4]);
    expect(searchTranscript(segments, "软件", normalize).map((match) => match.start)).toEqual([4]);
    expect(searchTranscript(segments, "剪辑", normalize).map((match) => match.start)).toEqual([1]);
  });

  it("converts Simplified Whisper output to Taiwan Traditional", async () => {
    const toTaiwan = await createTaiwanConverter();
    expect(toTaiwan("这个软件很好用")).toBe("這個軟件很好用");
  });
});
