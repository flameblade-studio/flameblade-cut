import { describe, expect, it, vi } from "vitest";
import type { ActionResult, Project, TextClip, Track } from "@openreel/core";
import { chooseVoice, decodeVoiceError, groupVoices, maxTextChars, type VoiceInfo } from "./voiceover-client";
import {
  findFreeAudioTrack,
  placeVoiceover,
  voiceoverFileName,
  VoiceoverPlacementError,
  type VoiceoverProjectStore,
} from "./place-voiceover";
import { CAPTION_ORIGINAL_KEY, CAPTION_TRANSLATION_KEY } from "../captions/caption-documents";
import { collectSubtitleLines, voiceSubtitleLines, type SubtitleLine } from "./subtitle-voiceover";

function track(partial: Partial<Track> & { id: string }): Track {
  return {
    type: "audio",
    name: partial.id,
    clips: [],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    ...partial,
  } as Track;
}

function clip(start: number, duration: number) {
  return { id: `c${start}`, mediaId: "m", trackId: "t", startTime: start, duration } as Track["clips"][number];
}

function project(tracks: Track[], subtitles: Project["timeline"]["subtitles"] = []): Project {
  return {
    timeline: { tracks, subtitles },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

const v = (id: string, language: string, name = id): VoiceInfo => ({ engine: "windows", id, name, language });

describe("voiceover client helpers", () => {
  it("decodes the main-process error convention through Electron's wrapper", () => {
    const wrapped = new Error("Error invoking remote method 'openreel:voice:synthesize': Error: [voice:missing-key] OpenAI key is not configured.");
    expect(decodeVoiceError(wrapped)).toEqual({ code: "missing-key", detail: "OpenAI key is not configured." });
    expect(decodeVoiceError(new Error("Error invoking remote method 'x': Error: boom"))).toEqual({ code: "unknown", detail: "boom" });
    expect(decodeVoiceError(new Error("[voice:not-a-code] x")).code).toBe("unknown");
  });

  it("groups zh-TW first, then the UI language, then other Chinese, then the rest", () => {
    const groups = groupVoices(
      [v("David", "en-US"), v("Huihui", "zh-CN"), v("Zhiwei", "zh-TW"), v("Yating", "zh-TW"), v("Haruka", "ja-JP")],
      "ja",
    );
    expect(groups.map((group) => group.language)).toEqual(["zh-TW", "zh-CN", "ja-JP", "en-US"]);
    expect(groups[0].voices.map((voice) => voice.id)).toEqual(["Yating", "Zhiwei"]);
  });

  it("defaults to Yating on Windows, keeps a still-valid choice, falls back to zh-TW", () => {
    const list = [v("Microsoft Hanhan", "zh-TW"), v("Microsoft Yating", "zh-TW"), v("Microsoft David", "en-US")];
    expect(chooseVoice("windows", list)).toBe("Microsoft Yating");
    expect(chooseVoice("windows", list, "Microsoft David")).toBe("Microsoft David");
    expect(chooseVoice("windows", list, "Gone")).toBe("Microsoft Yating");
    expect(chooseVoice("windows", [v("Microsoft David", "en-US"), v("Microsoft Zhiwei", "zh-TW")])).toBe("Microsoft Zhiwei");
    expect(chooseVoice("openai", [v("alloy", "multilingual"), v("marin", "multilingual")])).toBe("marin");
    expect(chooseVoice("azure", [])).toBeNull();
  });

  it("applies the OpenAI input limit", () => {
    expect(maxTextChars("openai")).toBe(4096);
    expect(maxTextChars("windows")).toBe(5000);
  });
});

describe("placement", () => {
  it("finds a free unlocked audio track, preferring dialogue", () => {
    const p = project([
      track({ id: "video", type: "video" }),
      track({ id: "music", role: "music", clips: [clip(0, 10)] }),
      track({ id: "locked", locked: true }),
      track({ id: "dialogue", role: "dialogue", clips: [clip(20, 5)] }),
    ]);
    expect(findFreeAudioTrack(p, 5, 3)).toBe("dialogue");
    // Dialogue is busy at 20, so the free music track is used.
    expect(findFreeAudioTrack(p, 19, 3)).toBe("music");
    // Both unlocked audio tracks busy.
    expect(findFreeAudioTrack(project([track({ id: "m", clips: [clip(0, 30)] })]), 19, 3)).toBeNull();
  });

  it("treats touching clips as free and overlapping clips as busy", () => {
    const p = project([track({ id: "a", clips: [clip(0, 2)] })]);
    expect(findFreeAudioTrack(p, 2, 1)).toBe("a");
    expect(findFreeAudioTrack(p, 1.5, 1)).toBeNull();
  });

  it("makes safe media names", () => {
    expect(voiceoverFileName('歡迎\n使用：炎劍/剪輯 "測試"', "配音")).toBe("配音 - 歡迎 使用：炎劍 剪輯 測試.wav");
    expect(voiceoverFileName("   ", "配音")).toBe("配音.wav");
  });

  function fakeStore(tracks: Track[]) {
    let state = project(tracks);
    const ok: ActionResult = { success: true };
    const calls: string[] = [];
    const store: VoiceoverProjectStore = {
      getState: () => ({
        project: state,
        hasOpenProject: true,
        importMedia: vi.fn(async (file: File) => {
          calls.push(`import:${file.name}:${file.type}`);
          state = { ...state, mediaLibrary: { items: [{ id: "media-1" }] } } as unknown as Project;
          return ok;
        }),
        addTrack: vi.fn(async (type, _position, options) => {
          calls.push(`addTrack:${type}:${options?.role}:${options?.name}`);
          state = project([...state.timeline.tracks, track({ id: options!.trackId!, role: options?.role })]);
          return ok;
        }),
        placeMediaClip: vi.fn(async (mediaId, trackId, start) => {
          calls.push(`place:${mediaId}:${trackId}:${start}`);
          return ok;
        }),
      }),
    };
    return { store, calls };
  }

  it("imports the WAV, finds the new media id and places it on a free audio track", async () => {
    const { store, calls } = fakeStore([track({ id: "a1" })]);
    const placed = await placeVoiceover(
      { bytes: new Uint8Array([1, 2, 3]), name: "配音 - x", startSeconds: 4, durationSec: 2 },
      { trackName: "配音", store },
    );
    expect(placed).toEqual({ mediaId: "media-1", trackId: "a1", startSeconds: 4 });
    expect(calls).toEqual(["import:配音 - x.wav:audio/wav", "place:media-1:a1:4"]);
  });

  it("creates a dialogue audio track when none is free", async () => {
    const { store, calls } = fakeStore([track({ id: "a1", clips: [clip(0, 10)] })]);
    const placed = await placeVoiceover(
      { bytes: new Uint8Array([1]), name: "n.wav", startSeconds: 3, durationSec: 2 },
      { trackName: "配音", store },
    );
    expect(placed.trackId).toMatch(/^track-/);
    expect(calls[1]).toBe("addTrack:audio:dialogue:配音");
    expect(calls[2]).toBe(`place:media-1:${placed.trackId}:3`);
  });

  it("refuses without an open project", async () => {
    const { store } = fakeStore([]);
    const closed: VoiceoverProjectStore = { getState: () => ({ ...store.getState(), hasOpenProject: false }) };
    await expect(
      placeVoiceover({ bytes: new Uint8Array([1]), name: "n", startSeconds: 0, durationSec: 1 }, { trackName: "t", store: closed }),
    ).rejects.toBeInstanceOf(VoiceoverPlacementError);
  });
});

describe("subtitles → voiceover", () => {
  const textClip = (id: string, trackId: string, start: number, text: string, metadata?: Record<string, unknown>) =>
    ({ id, trackId, startTime: start, duration: 1.5, text, metadata }) as unknown as TextClip;

  it("collects caption clips like exportSRT, sorted, skipping blank lines", () => {
    const p = project([track({ id: "cap", type: "video", role: "captions" }), track({ id: "titles", type: "video" })]);
    const lines = collectSubtitleLines(p, [
      textClip("b", "cap", 3, "第二句"),
      textClip("a", "cap", 1, " 第一句 "),
      textClip("title", "titles", 0, "片頭標題"),
      textClip("tagged", "titles", 5, "第三句", { captionSource: "auto" }),
      textClip("blank", "cap", 6, "   "),
    ]);
    expect(lines.map((line) => [line.id, line.text, line.startTime])).toEqual([
      ["a", "第一句", 1],
      ["b", "第二句", 3],
      ["tagged", "第三句", 5],
    ]);
  });

  it("voices only the original line of bilingual captions", () => {
    const p = project([track({ id: "cap", type: "video", role: "captions" })]);
    const bilingual = textClip("bi", "cap", 1, ["大家好", "Hello everyone"].join("\n"), {
      [CAPTION_ORIGINAL_KEY]: "大家好",
      [CAPTION_TRANSLATION_KEY]: "Hello everyone",
    });
    expect(collectSubtitleLines(p, [bilingual]).map((line) => line.text)).toEqual(["大家好"]);
  });

  it("falls back to legacy timeline.subtitles", () => {
    const p = project([], [{ id: "s1", text: "舊字幕", startTime: 2, endTime: 3 }]);
    expect(collectSubtitleLines(p, [])).toEqual([{ id: "s1", text: "舊字幕", startTime: 2, endTime: 3 }]);
  });

  const lines: SubtitleLine[] = [1, 2, 3].map((n) => ({ id: `l${n}`, text: `line ${n}`, startTime: n, endTime: n + 1 }));

  it("voices lines strictly one at a time and reports progress", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const progress: number[] = [];
    const outcome = await voiceSubtitleLines(lines, {
      voiceLine: async (line) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        order.push(line.id);
        active -= 1;
      },
      onProgress: (p) => progress.push(p.done),
    });
    expect(outcome).toEqual({ placed: 3, total: 3, cancelled: false, failure: null });
    expect(maxActive).toBe(1);
    expect(order).toEqual(["l1", "l2", "l3"]);
    expect(progress).toEqual([0, 1, 2, 3]);
  });

  it("stops at the first failure and on cancel", async () => {
    const failing = await voiceSubtitleLines(lines, {
      voiceLine: async (line) => {
        if (line.id === "l2") throw new Error("boom");
      },
    });
    expect(failing.placed).toBe(1);
    expect(failing.failure?.line.id).toBe("l2");

    const controller = new AbortController();
    const cancelled = await voiceSubtitleLines(lines, {
      voiceLine: async () => controller.abort(),
      signal: controller.signal,
    });
    expect(cancelled).toEqual({ placed: 1, total: 3, cancelled: true, failure: null });
  });
});
