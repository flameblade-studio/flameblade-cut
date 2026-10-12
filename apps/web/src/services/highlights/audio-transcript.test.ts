import { describe, expect, it } from "vitest";
import { ANALYSIS_SAMPLE_RATE, WavFormatError, computeRmsProfile, decodeWavToAnalysisMono, planTranscriptionPieces, rmsSlice } from "./audio";
import { buildSentences, chunksToSegments, formatTimestamp, joinText } from "./transcript";

function wavHeader(format: 1 | 3, channels: number, sampleRate: number, bits: number, dataBytes: number): Uint8Array {
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * channels * bits) / 8, true);
  view.setUint16(32, (channels * bits) / 8, true);
  view.setUint16(34, bits, true);
  write(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

/** 48 kHz stereo float WAV with `value(time)` on both channels. */
function floatWav(seconds: number, value: (time: number) => number): Uint8Array {
  const frames = Math.round(seconds * 48_000);
  const bytes = wavHeader(3, 2, 48_000, 32, frames * 8);
  const view = new DataView(bytes.buffer);
  for (let frame = 0; frame < frames; frame += 1) {
    const sample = value(frame / 48_000);
    view.setFloat32(44 + frame * 8, sample, true);
    view.setFloat32(48 + frame * 8, sample, true);
  }
  return bytes;
}

describe("WAV decoding", () => {
  it("downmixes 48 kHz stereo float to 16 kHz mono with the right duration", () => {
    const { samples, duration } = decodeWavToAnalysisMono(floatWav(2, () => 0.5));
    expect(duration).toBeCloseTo(2, 6);
    expect(samples.length).toBe(2 * ANALYSIS_SAMPLE_RATE);
    expect(samples[0]).toBeCloseTo(0.5, 6);
    expect(samples[samples.length - 1]).toBeCloseTo(0.5, 6);
  });

  it("decodes 16-bit PCM and averages opposite channels to silence", () => {
    const bytes = wavHeader(1, 2, 16_000, 16, 16_000 * 4);
    const view = new DataView(bytes.buffer);
    for (let frame = 0; frame < 16_000; frame += 1) {
      view.setInt16(44 + frame * 4, 16_384, true);
      view.setInt16(46 + frame * 4, -16_384, true);
    }
    const { samples } = decodeWavToAnalysisMono(bytes);
    expect(samples.length).toBe(16_000);
    expect(Math.max(...samples.subarray(0, 100).map(Math.abs))).toBe(0);
  });

  it("decodes from an unaligned view", () => {
    const wav = floatWav(0.1, () => 0.25);
    const shifted = new Uint8Array(wav.length + 1);
    shifted.set(wav, 1);
    const { samples } = decodeWavToAnalysisMono(shifted.subarray(1));
    expect(samples[10]).toBeCloseTo(0.25, 6);
  });

  it("rejects non-WAV and unsupported encodings", () => {
    expect(() => decodeWavToAnalysisMono(new TextEncoder().encode("not a wav file at all"))).toThrow(WavFormatError);
    expect(() => decodeWavToAnalysisMono(wavHeader(1, 1, 8000, 8, 10))).toThrow(/unsupported/);
  });
});

describe("loudness profile", () => {
  it("measures RMS per frame", () => {
    const samples = new Float32Array(16_000 * 2);
    samples.fill(0.5, 0, 8000);
    const profile = computeRmsProfile(samples, 16_000, 0.5);
    expect(profile.values.length).toBe(4);
    expect(profile.values[0]).toBeCloseTo(0.5, 6);
    expect(profile.values[1]).toBe(0);
    expect(rmsSlice(profile, 0.4, 1.1).length).toBe(3);
  });

  it("plans transcription pieces that cut at the quietest point near each boundary", () => {
    const values = new Float32Array(1200).fill(0.3); // 600 s at 0.5 s frames
    values[608] = 0.01; // 304.0-304.5 s is the quiet spot near the 300 s boundary
    const pieces = planTranscriptionPieces({ frameSeconds: 0.5, values }, 600, 300, 10);
    expect(pieces).toEqual([
      [0, 304.25],
      [304.25, 600],
    ]);
    expect(planTranscriptionPieces({ frameSeconds: 0.5, values }, 200)).toEqual([[0, 200]]);
  });
});

describe("transcript shaping", () => {
  it("offsets chunks, fills missing timestamps and drops empty text", () => {
    const segments = chunksToSegments(
      [
        { text: " 你好 ", timestamp: [0, 2] },
        { text: "  ", timestamp: [2, 3] },
        { text: "世界", timestamp: [null, null] },
      ],
      100,
      10,
    );
    expect(segments).toEqual([
      { start: 100, end: 102, text: "你好" },
      { start: 103, end: 110, text: "世界" },
    ]);
  });

  it("builds sentences from punctuation, pauses and the length cap", () => {
    const sentences = buildSentences([
      { start: 0, end: 1, text: "今天" },
      { start: 1, end: 2, text: "很開心。" },
      { start: 2, end: 3, text: "Hello" },
      { start: 3, end: 4, text: "world" },
      { start: 5, end: 6, text: "after a pause" },
    ]);
    expect(sentences.map((sentence) => sentence.text)).toEqual(["今天很開心。", "Hello world", "after a pause"]);
    const long = buildSentences(Array.from({ length: 10 }, (_, index) => ({ start: index * 2, end: index * 2 + 2, text: "字" })));
    expect(long.map((sentence) => sentence.end - sentence.start)).toEqual([12, 8]);
  });

  it("joins Latin words with spaces and CJK without", () => {
    expect(joinText("你好", "世界")).toBe("你好世界");
    expect(joinText("hello", "world")).toBe("hello world");
  });

  it("formats timestamps", () => {
    expect(formatTimestamp(65.25)).toBe("01:05.3");
    expect(formatTimestamp(59.96)).toBe("01:00.0");
    expect(formatTimestamp(3725)).toBe("1:02:05.0");
  });
});
