import { describe, expect, it } from "vitest";
import { NoSpeechError, findHighlights, shouldConvertToTaiwan, transcribeVideo, type AnalysisDeps, type AnalysisStage } from "./analyze";
import { LENGTH_RANGES } from "./types";

/** 16 kHz mono 16-bit PCM WAV of `seconds` with a constant level. */
function pcmWav(seconds: number, level: number): Uint8Array {
  const frames = seconds * 16_000;
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, frames * 2, true);
  for (let frame = 0; frame < frames; frame += 1) view.setInt16(44 + frame * 2, level, true);
  return bytes;
}

function fakeDeps(chunkText: (pieceIndex: number) => string, seconds = 600): AnalysisDeps & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    loadWav: async () => pcmWav(seconds, 3000),
    transcribe: async (samples, _language, onEvent) => {
      calls.push(samples.length / 16_000);
      onEvent({ kind: "model-download", progress: 0.5 });
      const index = calls.length - 1;
      const pieceSeconds = samples.length / 16_000;
      const chunks = [];
      for (let start = 0; start + 4 <= pieceSeconds; start += 5) {
        chunks.push({ text: chunkText(index), timestamp: [start, start + 4] as const });
      }
      return chunks;
    },
    toTaiwan: (text) => text.replace("这个", "這個"),
  };
}

describe("analysis pipeline", () => {
  it("transcribes in pieces with progress, offsets timestamps and converts Chinese to Taiwan characters", async () => {
    const deps = fakeDeps(() => "这个重点很重要。");
    const stages: AnalysisStage[] = [];
    const result = await transcribeVideo("C:/v.mp4", "auto", deps, (stage) => stages.push(stage), new AbortController().signal);
    expect(deps.calls.length).toBe(2);
    expect(result.duration).toBe(600);
    expect(result.segments[0].text).toBe("這個重点很重要。");
    expect(result.segments.at(-1)!.start).toBeGreaterThan(500);
    expect(stages[0]).toEqual({ stage: "audio" });
    expect(stages).toContainEqual({ stage: "model", progress: 0.5 });
    expect(stages.at(-1)).toEqual({ stage: "transcribe", progress: 1 });
    const clips = await findHighlights(result, { engine: "local", length: LENGTH_RANGES.short, count: 3 }, null);
    expect(clips).toHaveLength(3);
  });

  it("stops between pieces when cancelled", async () => {
    const controller = new AbortController();
    const deps = fakeDeps(() => "hello.");
    const original = deps.transcribe;
    deps.transcribe = async (...args) => {
      const chunks = await original(...args);
      controller.abort();
      return chunks;
    };
    await expect(transcribeVideo("C:/v.mp4", "en", deps, () => undefined, controller.signal)).rejects.toThrow();
    expect(deps.calls.length).toBe(1);
  });

  it("reports silence as no speech", async () => {
    await expect(transcribeVideo("C:/v.mp4", "zh", fakeDeps(() => "  ", 30), () => undefined, new AbortController().signal)).rejects.toBeInstanceOf(
      NoSpeechError,
    );
  });

  it("refuses the OpenAI engine without a bridge", async () => {
    const result = await transcribeVideo("C:/v.mp4", "en", fakeDeps(() => "Hi.", 60), () => undefined, new AbortController().signal);
    await expect(findHighlights(result, { engine: "openai", length: LENGTH_RANGES.short, count: 3 }, null)).rejects.toThrow(/unavailable/);
  });

  it("converts only Chinese (no kana) text and never for en/ja hints", () => {
    expect(shouldConvertToTaiwan("这个", "auto")).toBe(true);
    expect(shouldConvertToTaiwan("実はこれ", "auto")).toBe(false);
    expect(shouldConvertToTaiwan("这个", "ja")).toBe(false);
    expect(shouldConvertToTaiwan("hello", "zh")).toBe(false);
  });
});
