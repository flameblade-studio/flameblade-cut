import { describe, expect, it } from "vitest";
import { convertChineseScript, isChineseLanguage } from "./chinese-script";

describe("chinese script conversion", () => {
  it("converts Simplified to Traditional with Taiwan wording", async () => {
    expect(await convertChineseScript("视频", "traditional")).toBe("影片");
    expect(await convertChineseScript("软件", "traditional")).toBe("軟體");
    expect(await convertChineseScript("鼠标", "traditional")).toBe("滑鼠");
    expect(await convertChineseScript("质量", "traditional")).toBe("品質");
    expect(await convertChineseScript("这个视频的画质很好，记得点赞和订阅", "traditional")).toBe(
      "這個影片的畫質很好，記得按讚和訂閱",
    );
  });

  it("leaves already-Traditional text unchanged", async () => {
    const samples = [
      "這是繁體中文，影片很好看。",
      "請記得按讚、訂閱，開啟小鈴鐺！",
      "今天我們用 AI 剪輯 4K 影片",
      "質量守恆定律",
    ];
    for (const sample of samples) {
      expect(await convertChineseScript(sample, "traditional")).toBe(sample);
    }
  });

  it("converts Traditional back to Simplified", async () => {
    expect(await convertChineseScript("影片軟體滑鼠", "simplified")).toBe("视频软件鼠标");
    expect(await convertChineseScript("Hello 世界", "simplified")).toBe("Hello 世界");
  });

  it("recognises Chinese Whisper language codes", () => {
    expect(isChineseLanguage("zh")).toBe(true);
    expect(isChineseLanguage("yue")).toBe(true);
    expect(isChineseLanguage("ja")).toBe(false);
  });
});
