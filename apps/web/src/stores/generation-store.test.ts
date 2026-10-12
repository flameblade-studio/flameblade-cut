import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGenerationStore, GenerationRequestError, pendingStoryboardShots, PERSIST_DEBOUNCE_MS, type GenerationSubmission } from "./generation-store";
import { FakeComfyTransport } from "../services/ltx/fake-comfy-transport";
import { HISTORY_POLL_MS } from "../services/ltx/generation-runner";
import { randomSeed48, SEED_LIMIT } from "../services/ltx/library-paths";
import type { GenerationRecord } from "../services/ltx/types";

const HISTORY_PATH = "C:\\Users\\owner\\Videos\\Flameblade Cut\\flameblade-cut-history.json";
const NOW = new Date(2026, 9, 12, 15, 0, 0);

async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

function submission(overrides: Partial<GenerationSubmission> = {}): GenerationSubmission {
  return {
    mode: "t2v",
    prompt: "A red paper lantern",
    promptOriginal: null,
    aspect: "16:9",
    quality: "480p",
    durationSec: 3,
    firstImage: null,
    lastImage: null,
    referenceImages: [],
    extendFromRecordId: null,
    enhancePrompt: false,
    ...overrides,
  };
}

async function setup(transport = new FakeComfyTransport()) {
  let id = 0;
  let seed = 100;
  const store = createGenerationStore();
  await store.getState().init(transport, {
    now: () => NOW,
    newId: () => `id-${++id}`,
    randomSeed: () => ++seed,
    extractLastFrame: async () => new Uint8Array([1]),
    composeReferenceSheet: async () => new Uint8Array([2]),
  });
  await flush();
  return { store, transport };
}

function persisted(transport: FakeComfyTransport) {
  return JSON.parse(transport.files.get(HISTORY_PATH) ?? "null");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("generation store", () => {
  it("submits newest first with a random seed and reports the connection", async () => {
    const { store } = await setup();
    expect(store.getState().connection).toBe("ready");
    const first = store.getState().submit(submission({ prompt: "one" }));
    const second = store.getState().submit(submission({ prompt: "two", seed: 5 }));
    const { records, activeRecordId } = store.getState();
    expect(records.map((r) => r.id)).toEqual([second, first]);
    expect(records[1].request.seed).toBe(101);
    expect(records[0].request.seed).toBe(5);
    expect(activeRecordId).toBe(second);
  });

  it("validates requests before queueing", async () => {
    const { store } = await setup();
    expect(() => store.getState().submit(submission({ prompt: "  " }))).toThrow(GenerationRequestError);
    expect(() => store.getState().submit(submission({ mode: "i2v" }))).toThrow("Choose a first-frame image");
    expect(() => store.getState().submit(submission({ seed: SEED_LIMIT }))).toThrow(/Seed must be/);
    expect(() => store.getState().submit(submission({ durationSec: 0 }))).toThrow(/Duration must be/);
    expect(() => store.getState().submit(submission({ durationSec: 21 }))).toThrow(/Duration must be/);
    expect(() => store.getState().submit(submission({ durationSec: 7.5 }))).toThrow(/Duration must be/);
    expect(store.getState().records).toEqual([]);
  });

  it("validates reference-to-video requests", async () => {
    const { store } = await setup();
    const refs = (count: number) => Array.from({ length: count }, (_, i) => ({ path: `D:/refs/${i}.png`, name: `${i}.png` }));
    expect(() => store.getState().submit(submission({ mode: "ref2v", referenceImages: [] }))).toThrow(
      "Choose 1–12 reference images (got 0)",
    );
    expect(() => store.getState().submit(submission({ mode: "ref2v", referenceImages: refs(13) }))).toThrow(
      "Choose 1–12 reference images (got 13)",
    );
    expect(() =>
      store.getState().submit(submission({ mode: "ref2v", referenceImages: refs(8), enhancePrompt: true })),
    ).toThrow(/Prompt enhance is not available/);
    expect(() => store.getState().submit(submission({ mode: "t2v", referenceImages: refs(1) }))).toThrow(
      "Reference images are only used by reference-to-video",
    );
    const id = store.getState().submit(submission({ mode: "ref2v", referenceImages: refs(12) }));
    expect(store.getState().records.find((r) => r.id === id)?.request.referenceImages).toHaveLength(12);
  });

  it("extends a finished ref2v video without carrying its reference images", async () => {
    const { store, transport } = await setup();
    transport.binaryFiles.set("D:/refs/0.png", new Uint8Array([1]));
    const parent = store.getState().submit(
      submission({ mode: "ref2v", referenceImages: [{ path: "D:/refs/0.png", name: "0.png" }] }),
    );
    await flush();
    transport.finishPrompt("prompt-1");
    await vi.advanceTimersByTimeAsync(HISTORY_POLL_MS);
    await flush();
    expect(store.getState().records.find((r) => r.id === parent)?.status).toBe("done");
    const child = store.getState().extend(parent, "she keeps walking");
    expect(store.getState().records.find((r) => r.id === child)?.request).toMatchObject({
      mode: "extend",
      referenceImages: [],
    });
  });

  it("refuses to submit before init", () => {
    const store = createGenerationStore();
    expect(() => store.getState().submit(submission())).toThrow(/not initialized/);
  });

  it("persists records, settings and storyboard (debounced) and loads them back", async () => {
    const { store, transport } = await setup();
    const recordId = store.getState().submit(submission());
    store.getState().updateSettings({ autoLaunch: false });
    const shotId = store.getState().addShot({ prompt: "opening shot", durationSec: 8 });
    store.getState().setStoryboardFormat({ aspect: "9:16" });
    expect(transport.files.has(HISTORY_PATH)).toBe(false);
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS);
    await flush();

    const saved = persisted(transport);
    expect(saved.version).toBe(1);
    expect(saved.records.map((r: GenerationRecord) => r.id)).toEqual([recordId]);
    expect(saved.settings.autoLaunch).toBe(false);
    expect(saved.storyboard).toMatchObject({ aspect: "9:16", shots: [{ id: shotId, prompt: "opening shot", durationSec: 8 }] });

    // Finish the job, then reload into a fresh store.
    transport.finishPrompt("prompt-1");
    await vi.advanceTimersByTimeAsync(HISTORY_POLL_MS);
    await flush();
    await store.getState().flushPersistence();
    const reloaded = createGenerationStore();
    await reloaded.getState().init(transport);
    const state = reloaded.getState();
    expect(state.records).toHaveLength(1);
    expect(state.records[0]).toMatchObject({ id: recordId, status: "done" });
    expect(state.settings.autoLaunch).toBe(false);
    expect(state.storyboard.shots[0].prompt).toBe("opening shot");
  });

  it("marks records that were in flight when the app closed as interrupted", async () => {
    const transport = new FakeComfyTransport();
    const base = {
      createdAt: NOW.toISOString(),
      request: { ...submission(), seed: 1 },
      progress: 0.5,
      outputPath: null,
      posterPath: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      comfyPromptId: null,
    };
    transport.files.set(
      HISTORY_PATH,
      JSON.stringify({
        version: 1,
        records: [
          { ...base, id: "running-1", status: "running" },
          { ...base, id: "queued-1", status: "queued" },
          { ...base, id: "done-1", status: "done", outputPath: "C:\\v.mp4" },
          { broken: true },
        ],
      }),
    );
    const { store } = await setup(transport);
    const byId = Object.fromEntries(store.getState().records.map((r) => [r.id, r]));
    expect(Object.keys(byId)).toEqual(["running-1", "queued-1", "done-1"]);
    expect(byId["running-1"]).toMatchObject({ status: "failed", error: "interrupted", finishedAt: NOW.toISOString() });
    expect(byId["queued-1"]).toMatchObject({ status: "failed", error: "interrupted" });
    expect(byId["done-1"]).toMatchObject({ status: "done", error: null });
  });

  it("starts empty and warns when the history file is corrupt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const transport = new FakeComfyTransport();
    transport.files.set(HISTORY_PATH, "{ not json");
    const { store } = await setup(transport);
    expect(store.getState().records).toEqual([]);
    expect(store.getState().initialized).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unreadable"), expect.anything());
  });

  it("retries with a new seed unless keepSeed is set", async () => {
    const { store } = await setup();
    const original = store.getState().submit(submission({ seed: 42 }));
    const fresh = store.getState().retry(original);
    const same = store.getState().retry(original, { keepSeed: true });
    const seeds = Object.fromEntries(store.getState().records.map((r) => [r.id, r.request.seed]));
    expect(seeds[original]).toBe(42);
    expect(seeds[fresh]).not.toBe(42);
    expect(seeds[same]).toBe(42);
  });

  it("extends only finished videos", async () => {
    const { store, transport } = await setup();
    const parent = store.getState().submit(submission());
    expect(() => store.getState().extend(parent, "continue")).toThrow(/Only a finished video/);
    transport.finishPrompt("prompt-1");
    await vi.advanceTimersByTimeAsync(HISTORY_POLL_MS);
    await flush();
    const child = store.getState().extend(parent, "the lantern drifts away");
    const record = store.getState().records.find((r) => r.id === child);
    expect(record?.request).toMatchObject({ mode: "extend", prompt: "the lantern drifts away", extendFromRecordId: parent });
  });

  it("removes a record without deleting files and cancels it if in flight", async () => {
    const { store, transport } = await setup();
    const id = store.getState().submit(submission());
    await flush();
    store.getState().remove(id);
    await flush();
    expect(store.getState().records).toEqual([]);
    expect(store.getState().activeRecordId).toBeNull();
    expect(transport.requestsTo("GET", "/queue")).toHaveLength(1);
    expect(transport.requestsTo("POST", "/queue").map((r) => r.body)).toEqual([{ delete: ["prompt-1"] }]);
  });

  it("edits the storyboard and generates only shots without a finished or in-flight record", async () => {
    const { store, transport } = await setup();
    const a = store.getState().addShot({ prompt: "shot A" });
    const b = store.getState().addShot({ prompt: "shot B", image: { path: "D:\\b.png", name: "b.png" } });
    const blank = store.getState().addShot();
    const c = store.getState().addShot({ prompt: "shot C" });
    store.getState().moveShot(c, 0);
    store.getState().removeShot(blank);
    expect(store.getState().storyboard.shots.map((s) => s.id)).toEqual([c, a, b]);
    store.getState().updateShot(a, { prompt: "shot A2" });

    transport.binaryFiles.set("D:\\b.png", new Uint8Array([9]));
    const firstRun = store.getState().generateStoryboard();
    expect(firstRun).toHaveLength(3);
    const records = store.getState().records;
    const shots = store.getState().storyboard.shots;
    expect(shots.map((s) => s.recordId)).toEqual(firstRun);
    const modes = firstRun.map((id) => records.find((r) => r.id === id)?.request);
    expect(modes.map((r) => [r?.mode, r?.prompt])).toEqual([
      ["t2v", "shot C"],
      ["t2v", "shot A2"],
      ["i2v", "shot B"],
    ]);

    // Everything is in flight: nothing new is submitted.
    expect(store.getState().generateStoryboard()).toEqual([]);

    // Cancel shot A2's queued job, then regenerate: only that shot is resubmitted.
    await store.getState().cancel(firstRun[1]);
    const secondRun = store.getState().generateStoryboard();
    expect(secondRun).toHaveLength(1);
    expect(store.getState().storyboard.shots[1].recordId).toBe(secondRun[0]);
  });
});

describe("prompt translation", () => {
  it("submits the English prompt and keeps the original for display", async () => {
    const { store } = await setup();
    const id = store.getState().submit(submission({ prompt: "A red scooter", promptOriginal: "一輛紅色機車" }));
    const record = store.getState().records.find((r) => r.id === id);
    expect(record?.request.prompt).toBe("A red scooter");
    expect(record?.request.promptOriginal).toBe("一輛紅色機車");
  });

  it("uses prepared (translated) prompts per storyboard shot and leaves others as written", async () => {
    const { store } = await setup();
    const zh = store.getState().addShot({ prompt: "三隻橘色的貓" });
    const en = store.getState().addShot({ prompt: "a lantern" });
    expect(pendingStoryboardShots(store.getState().storyboard, store.getState().records).map((s) => s.id)).toEqual([zh, en]);
    const ids = store.getState().generateStoryboard({ [zh]: { prompt: "Three orange cats", promptOriginal: "三隻橘色的貓" } });
    const requests = ids.map((id) => store.getState().records.find((r) => r.id === id)?.request);
    expect(requests.map((r) => [r?.prompt, r?.promptOriginal])).toEqual([
      ["Three orange cats", "三隻橘色的貓"],
      ["a lantern", null],
    ]);
    expect(pendingStoryboardShots(store.getState().storyboard, store.getState().records)).toEqual([]);
  });
});

describe("randomSeed48", () => {
  it("returns integers in [0, 2^48)", () => {
    for (let i = 0; i < 1000; i += 1) {
      const seed = randomSeed48();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(SEED_LIMIT);
    }
  });

  it("reaches the high bits", () => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      (array as unknown as Uint32Array).set([0xffffffff, 0xffffffff]);
      return array;
    });
    expect(randomSeed48()).toBe(SEED_LIMIT - 1);
  });
});
