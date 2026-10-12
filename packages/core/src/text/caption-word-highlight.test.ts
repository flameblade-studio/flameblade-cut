import { describe, expect, it } from "vitest";
import {
  activeCaptionWordRange,
  readCaptionWordHighlight,
  splitCaptionLineRuns,
} from "./caption-word-highlight";

const words = [
  { text: "hello", start: 0, end: 0.4 },
  { text: "world", start: 0.5, end: 0.9 },
  { text: "hello", start: 1.0, end: 1.4 },
];

describe("caption word highlight", () => {
  it("reads only complete, enabled metadata", () => {
    expect(readCaptionWordHighlight(undefined)).toBeNull();
    expect(readCaptionWordHighlight({ captionWords: words })).toBeNull();
    expect(readCaptionWordHighlight({ captionHighlightColor: "#ff0" })).toBeNull();
    expect(
      readCaptionWordHighlight({
        captionHighlightColor: "#ff0",
        captionWords: [{ text: "x", start: "0", end: 1 }],
      }),
    ).toBeNull();
    expect(
      readCaptionWordHighlight({ captionHighlightColor: "#ff0", captionWords: words }),
    ).toEqual({ color: "#ff0", words });
  });

  it("keeps the most recently started word active and maps repeats in order", () => {
    const text = "hello world hello";
    expect(activeCaptionWordRange(text, words, -0.1)).toBeNull();
    expect(activeCaptionWordRange(text, words, 0.1)).toEqual({ start: 0, end: 5 });
    // Gap between words keeps the previous word lit.
    expect(activeCaptionWordRange(text, words, 0.45)).toEqual({ start: 0, end: 5 });
    expect(activeCaptionWordRange(text, words, 0.6)).toEqual({ start: 6, end: 11 });
    expect(activeCaptionWordRange(text, words, 1.2)).toEqual({ start: 12, end: 17 });
  });

  it("highlights CJK characters and returns null for unknown words", () => {
    const cjk = [
      { text: "今天", start: 0, end: 0.5 },
      { text: "天氣", start: 0.5, end: 1 },
    ];
    expect(activeCaptionWordRange("今天天氣很好", cjk, 0.7)).toEqual({ start: 2, end: 4 });
    expect(activeCaptionWordRange("完全不同", cjk, 0.2)).toBeNull();
  });

  it("splits lines into runs and ignores the translation line", () => {
    const text = "你好世界\nHello world";
    expect(splitCaptionLineRuns(text, { start: 2, end: 4 })).toEqual([
      [
        { text: "你好", highlighted: false },
        { text: "世界", highlighted: true },
      ],
      [{ text: "Hello world", highlighted: false }],
    ]);
    expect(splitCaptionLineRuns("ab", null)).toEqual([[{ text: "ab", highlighted: false }]]);
  });
});
