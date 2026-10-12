import { describe, expect, it } from "vitest";
import type { TextClip } from "@openreel/core";
import {
  captionOriginalText,
  captionsToSrt,
  captionsToTranscript,
  withOriginalText,
  withTranslation,
  withoutTranslation,
} from "./caption-documents";

function clip(id: string, text: string, startTime: number, duration: number, metadata = {}): TextClip {
  return {
    id,
    trackId: "captions",
    startTime,
    duration,
    text,
    style: {
      fontFamily: "Inter",
      fontSize: 48,
      fontWeight: "bold",
      fontStyle: "normal",
      color: "#ffffff",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
    },
    transform: {
      position: { x: 0.5, y: 0.8 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    keyframes: [],
    metadata: { captionSource: "whisper", ...metadata },
  };
}

describe("caption documents", () => {
  it("adds, replaces and removes a translation line", () => {
    const base = clip("a", "大家好", 0, 1);
    const bilingual = withTranslation(base, "Hello everyone", "en");
    expect(bilingual.text).toBe("大家好\nHello everyone");
    const retranslated = withTranslation({ ...base, ...bilingual }, "皆さん、こんにちは", "ja");
    expect(retranslated.text).toBe("大家好\n皆さん、こんにちは");
    expect(captionOriginalText({ ...base, ...retranslated })).toBe("大家好");
    const converted = withOriginalText({ ...base, ...retranslated }, "大家好！");
    expect(converted.text).toBe("大家好！\n皆さん、こんにちは");
    const removed = withoutTranslation({ ...base, ...converted });
    expect(removed.text).toBe("大家好！");
    expect(removed.metadata).toEqual({ captionSource: "whisper" });
  });

  it("exports SRT with both lines of bilingual captions", () => {
    const first = clip("a", "", 1.5, 2);
    const srt = captionsToSrt([
      { ...first, ...withTranslation(clip("a", "大家好", 1.5, 2), "Hello everyone", "en") },
      clip("b", "今天來剪片", 3.5, 1.25),
      clip("c", "   ", 5, 1),
    ]);
    expect(srt).toBe(
      "1\n00:00:01,500 --> 00:00:03,500\n大家好\nHello everyone\n\n" +
        "2\n00:00:03,500 --> 00:00:04,750\n今天來剪片\n",
    );
  });

  it("builds a punctuated transcript from spoken text", () => {
    const transcript = captionsToTranscript([
      clip("a", "大家好", 0, 1, { captionSpokenText: "大家好，" }),
      clip("b", "歡迎回來\nWelcome back", 1, 1, {
        captionSpokenText: "歡迎回來。",
        captionOriginal: "歡迎回來",
      }),
      clip("c", "Next topic.", 6, 1),
      clip("d", "Thanks!", 7, 1),
    ]);
    expect(transcript).toBe("大家好，歡迎回來。\n\nNext topic. Thanks!\n");
    expect(captionsToTranscript([])).toBe("");
  });
});
