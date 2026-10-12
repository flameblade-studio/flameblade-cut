import { describe, expect, it } from "vitest";
import { emptyHistory, parseHistoryFile, serializeHistory } from "./history-file";
import type { GenerationRecord } from "./types";

const FINISHED_AT = "2026-10-12T07:00:00.000Z";

/** A record as written before `ref2v` existed: its request has no `referenceImages`. */
function legacyRecord(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    createdAt: "2026-10-11T07:00:00.000Z",
    request: {
      mode: "t2v",
      prompt: "A red paper lantern",
      aspect: "16:9",
      quality: "720p",
      durationSec: 5,
      seed: 7,
      firstImage: null,
      lastImage: null,
      extendFromRecordId: null,
      enhancePrompt: false,
      ...extra,
    },
    status: "done",
    progress: 1,
    outputPath: "C:\\Videos\\a.mp4",
    posterPath: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    comfyPromptId: "p-1",
  };
}

describe("output folder setting", () => {
  it("defaults to the library folder when an older file has no outputDir", () => {
    const text = JSON.stringify({ version: 1, records: [], settings: { baseUrl: "http://127.0.0.1:8188" } });
    expect(parseHistoryFile(text, FINISHED_AT).settings.outputDir).toBeNull();
  });

  it("round-trips a chosen folder", () => {
    const data = emptyHistory();
    data.settings = { ...data.settings, outputDir: String.raw`D:\My Videos\AI` };
    const parsed = parseHistoryFile(serializeHistory(data), FINISHED_AT);
    expect(parsed.settings.outputDir).toBe(String.raw`D:\My Videos\AI`);
  });
});

describe("parseHistoryFile", () => {
  it("loads records written before prompt translation with promptOriginal null", () => {
    const text = JSON.stringify({ version: 1, records: [legacyRecord("old")] });
    expect(parseHistoryFile(text, FINISHED_AT).records[0]?.request.promptOriginal).toBeNull();
  });

  it("round-trips the original Chinese prompt next to the English one", () => {
    const text = JSON.stringify({
      version: 1,
      records: [legacyRecord("zh", { prompt: "A red scooter", promptOriginal: "一輛紅色機車" }), legacyRecord("bad", { promptOriginal: 42 })],
    });
    const [zh, bad] = parseHistoryFile(text, FINISHED_AT).records;
    expect(zh?.request.prompt).toBe("A red scooter");
    expect(zh?.request.promptOriginal).toBe("一輛紅色機車");
    expect(bad?.request.promptOriginal).toBeNull();
    const again = parseHistoryFile(serializeHistory({ ...emptyHistory(), records: zh ? [zh] : [] }), FINISHED_AT);
    expect(again.records[0]?.request.promptOriginal).toBe("一輛紅色機車");
  });

  it("loads records written before reference images existed with an empty list", () => {
    const text = JSON.stringify({ version: 1, records: [legacyRecord("old")] });
    const [record] = parseHistoryFile(text, FINISHED_AT).records;
    expect(record?.request.referenceImages).toEqual([]);
    expect(record?.request.prompt).toBe("A red paper lantern");
  });

  it("keeps valid reference images and drops malformed entries", () => {
    const text = JSON.stringify({
      version: 1,
      records: [
        legacyRecord("ref", {
          mode: "ref2v",
          referenceImages: [{ path: "D:/a.png", name: "a.png" }, { path: 3 }, null, { path: "D:/b.png", name: "b.png" }],
        }),
        legacyRecord("bad", { referenceImages: "D:/a.png" }),
      ],
    });
    const records = parseHistoryFile(text, FINISHED_AT).records;
    expect(records.map((r) => r.request.referenceImages)).toEqual([
      [
        { path: "D:/a.png", name: "a.png" },
        { path: "D:/b.png", name: "b.png" },
      ],
      [],
    ]);
  });

  it("round-trips reference images through serializeHistory", () => {
    const [legacy] = parseHistoryFile(JSON.stringify({ records: [legacyRecord("r")] }), FINISHED_AT).records;
    const record: GenerationRecord = {
      ...(legacy as GenerationRecord),
      request: { ...(legacy as GenerationRecord).request, mode: "ref2v", referenceImages: [{ path: "D:/x.png", name: "x.png" }] },
    };
    const text = serializeHistory({ ...emptyHistory(), records: [record] });
    expect(parseHistoryFile(text, FINISHED_AT).records).toEqual([record]);
  });
});
