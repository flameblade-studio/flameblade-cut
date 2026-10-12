import { describe, expect, it } from "vitest";
import { countCuePhrases, countExclamations, countQuestions, speechUnits } from "./cue-phrases";
import { syntheticRms, syntheticTalk } from "./fixtures";
import { findLocalHighlights, scoreWindows, selectTopWindows, type ScoredWindow } from "./scoring";
import { buildSentences } from "./transcript";
import { LENGTH_RANGES } from "./types";

describe("cue phrases", () => {
  it("finds Traditional, Simplified, English and Japanese cues", () => {
    expect(countCuePhrases("這是重點，你知道嗎")).toBe(2);
    expect(countCuePhrases("这是重点，关键在这里")).toBe(2);
    expect(countCuePhrases("Here is the most IMPORTANT tip.")).toBe(2);
    expect(countCuePhrases("実は、これが一番のポイントです")).toBe(2);
    expect(countCuePhrases("普通的一句話")).toBe(0);
  });

  it("counts the longest overlapping CJK phrase once and English only on word boundaries", () => {
    expect(countCuePhrases("最重要的事")).toBe(1);
    expect(countCuePhrases("keyboard tipping")).toBe(0);
  });

  it("counts questions (marks or sentence-final particles) and exclamations", () => {
    expect(countQuestions("真的嗎")).toBe(1);
    expect(countQuestions("Really? Why?")).toBe(2);
    expect(countQuestions("知っていますか")).toBe(1);
    expect(countExclamations("太好了！Wow!")).toBe(2);
  });

  it("counts CJK characters and Latin words as speech units", () => {
    expect(speechUnits("剪輯 is fun")).toBe(4);
  });
});

describe("local highlight scoring", () => {
  const sentences = buildSentences(syntheticTalk());
  const rms = syntheticRms();

  it("is deterministic", () => {
    const options = { length: LENGTH_RANGES.short, count: 5, duration: 600 };
    const first = findLocalHighlights(sentences, rms, options);
    const second = findLocalHighlights(sentences, rms, options);
    expect(second).toEqual(first);
  });

  it("only produces windows that start and end on sentence boundaries within the target length", () => {
    const starts = new Set(sentences.map((sentence) => sentence.start));
    const ends = new Set(sentences.map((sentence) => sentence.end));
    const windows = scoreWindows(sentences, rms, LENGTH_RANGES.short);
    expect(windows.length).toBeGreaterThan(100);
    for (const window of windows) {
      expect(starts.has(window.start)).toBe(true);
      expect(ends.has(window.end)).toBe(true);
      expect(window.end - window.start).toBeGreaterThanOrEqual(15);
      expect(window.end - window.start).toBeLessThanOrEqual(30);
      expect(window.score).toBeGreaterThanOrEqual(0);
      expect(window.score).toBeLessThanOrEqual(100);
    }
  });

  it("ranks the cue-rich, louder passages first", () => {
    const clips = findLocalHighlights(sentences, rms, { length: LENGTH_RANGES.short, count: 3, duration: 600 });
    expect(clips).toHaveLength(3);
    const contains = (time: number) => clips.some((clip) => clip.start <= time && clip.end >= time);
    expect(contains(63)).toBe(true);
    expect(contains(303)).toBe(true);
    expect(contains(483)).toBe(true);
    expect(clips[0].reasonCodes).toContain("cue");
    expect(clips[0].engine).toBe("local");
    expect(clips.map((clip) => clip.score)).toEqual([...clips.map((clip) => clip.score)].sort((a, b) => b - a));
  });

  it("returns non-overlapping clips separated by the minimum gap, never more than requested", () => {
    for (const count of [3, 5, 10]) {
      const clips = findLocalHighlights(sentences, rms, { length: LENGTH_RANGES.medium, count, duration: 600, minGapSeconds: 5 });
      expect(clips.length).toBeLessThanOrEqual(count);
      const sorted = [...clips].sort((a, b) => a.start - b.start);
      for (let index = 1; index < sorted.length; index += 1) {
        expect(sorted[index].start).toBeGreaterThanOrEqual(sorted[index - 1].end + 5 - 0.55);
      }
    }
  });

  it("selectTopWindows breaks score ties by earlier start", () => {
    const make = (start: number, score: number): ScoredWindow => ({ first: 0, last: 0, start, end: start + 20, score, reasonCodes: [] });
    const chosen = selectTopWindows([make(100, 50), make(10, 50), make(15, 90)], 2, 5);
    expect(chosen.map((window) => window.start)).toEqual([15, 100]);
  });

  it("clamps padded clips to the source duration and titles them from the cue sentence", () => {
    const clips = findLocalHighlights(sentences, rms, { length: LENGTH_RANGES.short, count: 10, duration: 600 });
    for (const clip of clips) {
      expect(clip.start).toBeGreaterThanOrEqual(0);
      expect(clip.end).toBeLessThanOrEqual(600);
    }
    const best = clips[0];
    expect(Array.from(best.title).length).toBeLessThanOrEqual(28);
    expect(countCuePhrases(best.title.replace("…", ""))).toBeGreaterThan(0);
  });

  it("works without a loudness profile and returns nothing for an empty transcript", () => {
    expect(findLocalHighlights(sentences, null, { length: LENGTH_RANGES.short, count: 3, duration: 600 })).toHaveLength(3);
    expect(findLocalHighlights([], rms, { length: LENGTH_RANGES.short, count: 3, duration: 600 })).toEqual([]);
  });
});
