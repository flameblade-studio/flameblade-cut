import { describe, expect, it } from "vitest";
import {
  breakCaptionSegments,
  defaultMaxCharsForLanguage,
  tokenizeCaptionText,
} from "./line-breaking";

const cjkWidth = (text: string) => Array.from(text).length;

describe("tokenizeCaptionText", () => {
  it("splits Han characters, keeps Latin words and attaches punctuation", () => {
    expect(tokenizeCaptionText("用AI剪輯，好嗎？").map((token) => token.text)).toEqual([
      "用",
      "AI",
      "剪",
      "輯，",
      "好",
      "嗎？",
    ]);
    expect(tokenizeCaptionText("Hello, world! It's 3.5x").map((token) => token.text)).toEqual([
      "Hello,",
      "world!",
      "It's",
      "3.5x",
    ]);
    expect(tokenizeCaptionText("他說「你好」").map((token) => token.text)).toEqual([
      "他",
      "說",
      "「你",
      "好」",
    ]);
  });
});

describe("breakCaptionSegments", () => {
  it("prefers punctuation breaks and respects the CJK limit", () => {
    const cues = breakCaptionSegments([
      {
        text: "大家好，歡迎來到我的頻道，今天我們要來聊聊如何用本機AI剪輯影片，非常簡單。",
        startTime: 0,
        endTime: 8,
      },
    ]);
    expect(cues.map((cue) => cue.text)).toEqual([
      "大家好，歡迎來到我的頻道，",
      "今天我們要來聊聊如何用本機AI剪輯",
      "影片，非常簡單。",
    ]);
    // "AI" counts 2 × 16/42 units, so the second line weighs 15.76 ≤ 16.
    for (const cue of cues) expect(cjkWidth(cue.text.replace(/AI/, ""))).toBeLessThanOrEqual(16);
    expect(cues[0].startTime).toBe(0);
    expect(cues[cues.length - 1].endTime).toBeCloseTo(8, 5);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startTime).toBeGreaterThanOrEqual(cues[i - 1].endTime - 1e-9);
    }
  });

  it("never splits a Latin word and honours the Latin limit", () => {
    const text =
      "Today we are going to talk about extraordinarily long captions and how to keep them readable on vertical video.";
    const cues = breakCaptionSegments([{ text, startTime: 10, endTime: 16 }]);
    const words = text.split(" ");
    expect(cues.flatMap((cue) => cue.text.split(" "))).toEqual(words);
    for (const cue of cues) expect(cue.text.length).toBeLessThanOrEqual(42);
  });

  it("gives an over-long single word its own line", () => {
    const cues = breakCaptionSegments(
      [{ text: "see https://example.com/a/very/long/path/that/never/ends/here ok", startTime: 0, endTime: 4 }],
      { maxCharsLatin: 20 },
    );
    expect(cues.some((cue) => cue.text.includes("https://example.com/a/very/long/path/that/never/ends/here"))).toBe(true);
    expect(cues.every((cue) => !cue.text.includes("here ok") || cue.text.startsWith("https"))).toBe(true);
  });

  it("uses word timestamps when provided and breaks on silence", () => {
    const cues = breakCaptionSegments([
      {
        text: " Hello there. How are you",
        startTime: 0,
        endTime: 5,
        words: [
          { text: " Hello", start: 0, end: 0.4 },
          { text: " there.", start: 0.4, end: 0.9 },
          { text: " How", start: 2.5, end: 2.8 },
          { text: " are", start: 2.8, end: 3.0 },
          { text: " you", start: 3.0, end: 3.4 },
        ],
      },
    ]);
    expect(cues.map((cue) => [cue.text, cue.startTime, cue.endTime])).toEqual([
      ["Hello there.", 0, 0.9],
      ["How are you", 2.5, 3.4],
    ]);
    expect(cues[0].words).toEqual([
      { text: "Hello", start: 0, end: 0.4 },
      { text: "there", start: 0.4, end: 0.9 },
    ]);
  });

  it("merges tiny fragments and enforces a minimum duration", () => {
    const cues = breakCaptionSegments([
      { text: "嗯，", startTime: 0, endTime: 0.2 },
      { text: "我們開始吧", startTime: 0.25, endTime: 1.2 },
      { text: "好", startTime: 3, endTime: 3.1 },
    ]);
    expect(cues.map((cue) => cue.text)).toEqual(["嗯，我們開始吧", "好"]);
    expect(cues[1].endTime - cues[1].startTime).toBeCloseTo(0.7, 5);
  });

  it("does not extend a cue over the next one", () => {
    const cues = breakCaptionSegments([
      { text: "第一句話。", startTime: 0, endTime: 0.4 },
      { text: "第二句話。", startTime: 0.5, endTime: 1.5 },
    ]);
    expect(cues).toHaveLength(2);
    expect(cues[0].endTime).toBe(0.5);
    expect(cues[0].endTime).toBeLessThanOrEqual(cues[1].startTime);
  });

  it("strips trailing Chinese punctuation but keeps tone marks and spoken text", () => {
    const cues = breakCaptionSegments(
      [{ text: "今天天氣很好，我們出去走走。你要來嗎？", startTime: 0, endTime: 5 }],
      { stripTrailingPunctuation: true, maxCharsCjk: 8 },
    );
    expect(cues.map((cue) => cue.text)).toEqual(["今天天氣很好", "我們出去走走", "你要來嗎？"]);
    expect(cues[0].spokenText).toBe("今天天氣很好，");
    expect(cues[0].words.map((word) => word.text).join("")).toBe("今天天氣很好");
  });

  it("returns nothing for blank input and picks language defaults", () => {
    expect(breakCaptionSegments([{ text: "   ", startTime: 0, endTime: 1 }])).toEqual([]);
    expect(defaultMaxCharsForLanguage("zh")).toBe(16);
    expect(defaultMaxCharsForLanguage("en")).toBe(42);
  });
});
