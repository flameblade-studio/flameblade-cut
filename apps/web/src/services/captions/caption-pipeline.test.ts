import { describe, expect, it } from "vitest";
import { activeCaptionWordRange, readCaptionWordHighlight } from "@openreel/core";
import { loadChineseConverter } from "./chinese-script";
import {
  buildCaptionCues,
  convertCue,
  cueClipMetadata,
  reconcileWords,
  withWordHighlight,
} from "./caption-pipeline";

/** Whisper-like output (segment chunks, Simplified Chinese, as small/turbo models often emit). */
const CHINESE_CHUNKS = [
  { text: "大家好，欢迎来到我的频道，今天我们要聊一聊怎么用本地AI软件剪辑视频。", startTime: 0, endTime: 6.2 },
  { text: "首先打开软件，用鼠标把视频拖进时间轴，然后点击自动字幕。", startTime: 6.4, endTime: 11.8 },
  { text: "嗯。", startTime: 12.0, endTime: 12.2 },
  { text: "字幕的质量真的很好，记得点赞订阅！", startTime: 12.3, endTime: 15.0 },
];

const ENGLISH_WORDS = [
  [" Welcome", 0.0, 0.42], [" back", 0.42, 0.7], [" to", 0.7, 0.82], [" the", 0.82, 0.95],
  [" channel.", 0.95, 1.5], [" Today", 2.6, 2.95], [" we're", 2.95, 3.2], [" editing", 3.2, 3.6],
  [" a", 3.6, 3.66], [" short", 3.66, 3.95], [" film", 3.95, 4.2], [" entirely", 4.2, 4.7],
  [" on", 4.7, 4.82], [" this", 4.82, 5.0], [" laptop,", 5.0, 5.5], [" with", 5.55, 5.7],
  [" local", 5.7, 6.0], [" speech", 6.0, 6.3], [" recognition", 6.3, 6.95], [" and", 6.95, 7.1],
  [" no", 7.1, 7.25], [" cloud", 7.25, 7.6], [" uploads.", 7.6, 8.2],
].map(([text, start, end]) => ({ text: text as string, start: start as number, end: end as number }));

describe("caption pipeline (realistic Whisper-like fixtures)", () => {
  it("breaks and converts Chinese chunks into Taiwan Traditional single lines", async () => {
    const convert = await loadChineseConverter("traditional");
    const cues = buildCaptionCues(CHINESE_CHUNKS, { convert, stripTrailingPunctuation: true });
    expect(cues.map((cue) => cue.text)).toEqual([
      "大家好，歡迎來到我的頻道",
      "今天我們要聊一聊怎麼",
      "用本地AI軟體剪輯影片",
      "首先開啟軟體",
      "用滑鼠把影片拖進時間軸",
      "然後點選自動字幕",
      "嗯",
      "字幕的品質真的很好",
      "記得按讚訂閱！",
    ]);
    expect(cues[0].spokenText).toBe("大家好，歡迎來到我的頻道，");
    for (const cue of cues) {
      expect(cue.endTime - cue.startTime).toBeGreaterThanOrEqual(0.2 - 1e-9);
      // Every word stays locatable in the converted text (highlight works).
      let cursor = 0;
      for (const word of cue.words) {
        const at = cue.text.indexOf(word.text, cursor);
        expect(at).toBeGreaterThanOrEqual(0);
        cursor = at + word.text.length;
      }
    }
  });

  it("breaks English word timestamps on sentences, commas and the 42-char limit", () => {
    const cues = buildCaptionCues(
      [{ text: ENGLISH_WORDS.map((w) => w.text).join(""), startTime: 0, endTime: 8.2, words: ENGLISH_WORDS }],
      {},
    );
    expect(cues.map((cue) => [cue.text, cue.startTime, cue.endTime])).toEqual([
      ["Welcome back to the channel.", 0, 1.5],
      ["Today we're editing a short film entirely", 2.6, 4.7],
      ["on this laptop,", 4.7, 5.5],
      ["with local speech recognition", 5.55, 6.95],
      ["and no cloud uploads.", 6.95, 8.2],
    ]);
  });

  it("keeps word timing exact across same-length conversion and re-estimates otherwise", async () => {
    const convert = await loadChineseConverter("traditional");
    const [cue] = buildCaptionCues([{ text: "视频软件", startTime: 1, endTime: 2 }], {});
    const converted = convertCue(cue, convert);
    expect(converted.text).toBe("影片軟體");
    expect(converted.words.map((word) => word.text)).toEqual(["影", "片", "軟", "體"]);
    expect(converted.words.map((word) => word.start)).toEqual(cue.words.map((word) => word.start));
    const [memory] = buildCaptionCues([{ text: "内存不足", startTime: 0, endTime: 1 }], {});
    const longer = convertCue(memory, convert);
    expect(longer.text).toBe("記憶體不足");
    expect(longer.words.map((word) => word.text).join("")).toBe("記憶體不足");
  });

  it("produces metadata the core highlight renderer can read", () => {
    const [cue] = buildCaptionCues([{ text: "今天天氣很好", startTime: 10, endTime: 11.2 }], {});
    const metadata = cueClipMetadata(cue, "#FFD54A");
    const highlight = readCaptionWordHighlight(metadata);
    expect(highlight?.color).toBe("#FFD54A");
    expect(highlight?.words[0].start).toBe(0);
    expect(activeCaptionWordRange(cue.text, highlight!.words, 0.65)).toEqual({ start: 3, end: 4 });
    expect(readCaptionWordHighlight(cueClipMetadata(cue, null))).toBeNull();
  });

  it("toggles highlight on imported captions and reconciles edited words", () => {
    const enabled = withWordHighlight({ text: "Hello world", duration: 2, metadata: { captionSource: "srt" } }, "#f00", "Hello world");
    expect(readCaptionWordHighlight(enabled)?.words.map((word) => word.text)).toEqual(["Hello", "world"]);
    const disabled = withWordHighlight({ text: "Hello world", duration: 2, metadata: enabled }, null, "Hello world");
    expect(readCaptionWordHighlight(disabled)).toBeNull();
    const words = [{ text: "视", start: 0, end: 0.5 }, { text: "频", start: 0.5, end: 1 }];
    expect(reconcileWords("視頻", words, 1, (text) => ({ 视: "視", 频: "頻" })[text] ?? text)).toEqual([
      { text: "視", start: 0, end: 0.5 },
      { text: "頻", start: 0.5, end: 1 },
    ]);
    expect(reconcileWords("完全不同", words, 1).map((word) => word.text)).toEqual(["完", "全", "不", "同"]);
  });
});
