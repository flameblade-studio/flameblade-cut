import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GenerationRunner,
  HISTORY_POLL_MS,
  LAUNCH_POLL_MS,
  LAUNCH_TIMEOUT_MS,
  RESUBSCRIBE_MS,
  launchArgsWithMain,
} from "./generation-runner";
import { FakeComfyTransport } from "./fake-comfy-transport";
import { LTX_TRANSFORMER_FILES, modelErrorKind } from "./model-choice";
import type { ComfyApiPrompt } from "./workflow-binder";
import type { ReferenceSheetComposer } from "./reference-sheet";
import {
  DEFAULT_LTX_SETTINGS,
  type ComfyConnection,
  type GenerationRecord,
  type GenerationRequest,
  type LtxSettings,
} from "./types";

const NOW = new Date(2026, 9, 12, 15, 0, 0);
const LIBRARY = "C:\\Users\\owner\\Videos\\Flameblade Cut";

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    mode: "t2v",
    prompt: "A red paper lantern",
    promptOriginal: null,
    aspect: "16:9",
    quality: "480p",
    durationSec: 3,
    seed: 7,
    firstImage: null,
    lastImage: null,
    referenceImages: [],
    extendFromRecordId: null,
    enhancePrompt: false,
    ...overrides,
  };
}

function record(id: string, req: GenerationRequest, extra: Partial<GenerationRecord> = {}): GenerationRecord {
  return {
    id,
    createdAt: NOW.toISOString(),
    request: req,
    status: "queued",
    progress: 0,
    outputPath: null,
    posterPath: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    comfyPromptId: null,
    ...extra,
  };
}

/** Lets chained promises settle without advancing fake time. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

interface Harness {
  transport: FakeComfyTransport;
  runner: GenerationRunner;
  records: Map<string, GenerationRecord>;
  connections: ComfyConnection[];
  settings: LtxSettings;
  extractLastFrame: ReturnType<typeof vi.fn<[string], Promise<Uint8Array>>>;
  composeReferenceSheet: ReturnType<typeof vi.fn<Parameters<ReferenceSheetComposer>, ReturnType<ReferenceSheetComposer>>>;
  add(r: GenerationRecord): void;
  postedPrompt(index?: number): ComfyApiPrompt;
}

function harness(settingsOverride: Partial<LtxSettings> = {}): Harness {
  const transport = new FakeComfyTransport();
  const records = new Map<string, GenerationRecord>();
  const connections: ComfyConnection[] = [];
  const settings = { ...DEFAULT_LTX_SETTINGS, ...settingsOverride };
  const extractLastFrame = vi.fn<[string], Promise<Uint8Array>>(async () => new Uint8Array([137, 80, 78, 71]));
  const composeReferenceSheet = vi.fn<Parameters<ReferenceSheetComposer>, ReturnType<ReferenceSheetComposer>>(
    async (sources) => ({
      png: new Uint8Array([137, 80, 78, 71, 9]),
      positions: sources.map((_, i) => `Panel ${i + 1}`),
    }),
  );
  const runner = new GenerationRunner({
    transport,
    getSettings: () => settings,
    now: () => NOW,
    newId: () => "session-1",
    extractLastFrame,
    composeReferenceSheet,
    getRecord: (id) => records.get(id),
    onRecordUpdate: (id, patch) => {
      const current = records.get(id);
      if (current) records.set(id, { ...current, ...patch });
    },
    onConnection: (state) => connections.push(state),
  });
  return {
    transport,
    runner,
    records,
    connections,
    settings,
    extractLastFrame,
    composeReferenceSheet,
    add: (r) => records.set(r.id, r),
    postedPrompt: (index = 0) =>
      (transport.requestsTo("POST", "/prompt")[index].body as { prompt: ComfyApiPrompt }).prompt,
  };
}

function nodeByTitle(prompt: ComfyApiPrompt, classType: string, title: string) {
  return Object.values(prompt).find((n) => n.class_type === classType && n._meta?.title === title);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GenerationRunner", () => {
  it("runs a t2v job end to end with websocket progress", async () => {
    const h = harness();
    h.add(record("rec-1", request()));
    h.runner.enqueue("rec-1");
    await flush();

    const post = h.transport.requestsTo("POST", "/prompt")[0];
    expect((post.body as { client_id: string }).client_id).toBe("flameblade-cut-session-1");
    expect(nodeByTitle(h.postedPrompt(), "PrimitiveStringMultiline", "Prompt")?.inputs.value).toBe("A red paper lantern");
    expect(h.records.get("rec-1")).toMatchObject({ status: "running", comfyPromptId: "prompt-1", startedAt: NOW.toISOString() });
    expect(h.connections).toEqual(["ready"]);

    h.transport.startPrompt("prompt-1");
    h.transport.emit({ type: "progress", data: { value: 4, max: 8, prompt_id: "prompt-1", node: "405:344" } });
    expect(h.records.get("rec-1")?.progress).toBeCloseTo(0.25);
    h.transport.emit({ type: "progress", data: { value: 8, max: 8, prompt_id: "prompt-1", node: "405:344" } });
    h.transport.emit({ type: "progress", data: { value: 3, max: 3, prompt_id: "prompt-1", node: "405:368" } });
    expect(h.records.get("rec-1")?.progress).toBe(0.99);
    // Other prompts' progress and non-sampler nodes are ignored.
    h.transport.emit({ type: "progress", data: { value: 0, max: 8, prompt_id: "someone-else", node: "405:344" } });
    expect(h.records.get("rec-1")?.progress).toBe(0.99);

    h.transport.finishPrompt("prompt-1", "rec-1_00001_.mp4");
    h.transport.emit({ type: "execution_success", data: { prompt_id: "prompt-1", timestamp: 1 } });
    await vi.advanceTimersByTimeAsync(500);
    await flush();

    expect(h.transport.downloads).toEqual([
      {
        file: { filename: "rec-1_00001_.mp4", subfolder: "flameblade-cut", type: "output" },
        destPath: `${LIBRARY}\\2026-10-12\\rec-1.mp4`,
      },
    ]);
    expect(h.records.get("rec-1")).toMatchObject({
      status: "done",
      progress: 1,
      outputPath: `${LIBRARY}\\2026-10-12\\rec-1.mp4`,
      finishedAt: NOW.toISOString(),
      error: null,
    });
  });

  it("loads the INT8 model automatically on an RTX 40 card", async () => {
    const h = harness();
    h.transport.unetNames = [LTX_TRANSFORMER_FILES.nvfp4, LTX_TRANSFORMER_FILES.int8];
    h.transport.gpuName = "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync";
    h.add(record("rec-1", request()));
    h.runner.enqueue("rec-1");
    await flush();

    const loaders = Object.values(h.postedPrompt()).filter((node) => node.class_type === "UNETLoader");
    expect(loaders.map((node) => node.inputs.unet_name)).toEqual([LTX_TRANSFORMER_FILES.int8]);
  });

  it("fails with a model error before queueing when no LTX model is installed", async () => {
    const h = harness({ model: "int8" });
    h.add(record("rec-1", request()));
    h.runner.enqueue("rec-1");
    await flush();

    expect(h.transport.requestsTo("POST", "/prompt")).toEqual([]);
    expect(h.records.get("rec-1")?.status).toBe("failed");
    expect(modelErrorKind(h.records.get("rec-1")?.error ?? null)).toBe("missing");
  });

  it("falls back to /history polling when websocket messages are missed", async () => {
    const h = harness();
    h.add(record("rec-1", request()));
    h.runner.enqueue("rec-1");
    await flush();
    h.transport.finishPrompt("prompt-1");
    await vi.advanceTimersByTimeAsync(HISTORY_POLL_MS - 1);
    expect(h.records.get("rec-1")?.status).toBe("running");
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(h.records.get("rec-1")?.status).toBe("done");
  });

  it("uploads the first-frame image for i2v and binds its ComfyUI name", async () => {
    const h = harness();
    h.transport.binaryFiles.set("D:\\pics\\hero.JPG", new Uint8Array([1, 2, 3]));
    h.add(record("rec-1", request({ mode: "i2v", firstImage: { path: "D:\\pics\\hero.JPG", name: "hero.JPG" } })));
    h.runner.enqueue("rec-1");
    await flush();
    expect(h.transport.uploads).toEqual([{ filename: "rec-1-first.jpg", bytes: new Uint8Array([1, 2, 3]) }]);
    expect(nodeByTitle(h.postedPrompt(), "LoadImage", "Load First Frame")?.inputs.image).toBe(
      "flameblade-cut/rec-1-first.jpg",
    );
  });

  it("extends from the parent's last frame", async () => {
    const h = harness();
    h.add(record("parent", request(), { status: "done", outputPath: `${LIBRARY}\\2026-10-11\\parent.mp4` }));
    h.add(record("child", request({ mode: "extend", extendFromRecordId: "parent" })));
    h.runner.enqueue("child");
    await flush();
    expect(h.extractLastFrame).toHaveBeenCalledWith(`${LIBRARY}\\2026-10-11\\parent.mp4`);
    expect(h.transport.uploads.map((u) => u.filename)).toEqual(["child-first.png"]);
    expect(nodeByTitle(h.postedPrompt(), "LoadImage", "Load First Frame")?.inputs.image).toBe(
      "flameblade-cut/child-first.png",
    );
  });

  it("composes the ref2v reference sheet from every image, uploads it once and binds it", async () => {
    const h = harness();
    const images = Array.from({ length: 8 }, (_, i) => ({ path: `D:/refs/ref-${i}.png`, name: `ref-${i}.png` }));
    images.forEach((image, i) => h.transport.binaryFiles.set(image.path, new Uint8Array([i])));
    h.add(record("rec-1", request({ mode: "ref2v", aspect: "9:16", durationSec: 5, referenceImages: images })));
    h.runner.enqueue("rec-1");
    await flush();

    expect(h.composeReferenceSheet).toHaveBeenCalledTimes(1);
    const [sources, aspect] = h.composeReferenceSheet.mock.calls[0];
    expect(aspect).toBe("9:16");
    expect(sources.map((s) => s.image)).toEqual(images);
    expect(sources.map((s) => Array.from(s.bytes))).toEqual(images.map((_, i) => [i]));
    expect(h.transport.uploads).toEqual([{ filename: "rec-1-sheet.png", bytes: new Uint8Array([137, 80, 78, 71, 9]) }]);

    const prompt = h.postedPrompt();
    const loaders = Object.values(prompt).filter((n) => n.class_type === "LoadImage");
    expect(loaders.map((n) => n.inputs.image)).toEqual(["flameblade-cut/rec-1-sheet.png"]);
    // The Ingredients prompt names each panel by its sheet position, then the shot.
    const sent = String(nodeByTitle(prompt, "PrimitiveStringMultiline", "Prompt")?.inputs.value);
    expect(sent.startsWith("### Reference Sheet Description\n**Panel 1:** ")).toBe(true);
    expect(sent).toContain("**Panel 8:** ");
    expect(sent.endsWith("### Target Description\nA red paper lantern")).toBe(true);
    expect(h.records.get("rec-1")?.request.prompt).toBe("A red paper lantern");
    expect(nodeByTitle(prompt, "PrimitiveFloat", "Duration")?.inputs.value).toBe(5);
    expect(h.records.get("rec-1")?.status).toBe("running");
  });

  it.each([0, 13])("fails a ref2v job with %i reference images before touching ComfyUI", async (count) => {
    const h = harness();
    const images = Array.from({ length: count }, (_, i) => ({ path: `D:/refs/${i}.png`, name: `${i}.png` }));
    h.add(record("rec-1", request({ mode: "ref2v", referenceImages: images })));
    h.runner.enqueue("rec-1");
    await flush();
    expect(h.records.get("rec-1")).toMatchObject({
      status: "failed",
      error: `Reference-to-video needs 1–12 reference images, got ${count}`,
    });
    expect(h.composeReferenceSheet).not.toHaveBeenCalled();
    expect(h.transport.uploads).toEqual([]);
    expect(h.transport.requestsTo("POST", "/prompt")).toHaveLength(0);
  });

  it("fails a ref2v job when a reference image cannot be read", async () => {
    const h = harness();
    h.add(record("rec-1", request({ mode: "ref2v", referenceImages: [{ path: "D:/gone.png", name: "gone.png" }] })));
    h.runner.enqueue("rec-1");
    await flush();
    expect(h.records.get("rec-1")).toMatchObject({ status: "failed", error: "ENOENT: D:/gone.png" });
    expect(h.transport.requestsTo("POST", "/prompt")).toHaveLength(0);
  });

  it("fails an extend whose parent is not finished", async () => {
    const h = harness();
    h.add(record("parent", request(), { status: "failed" }));
    h.add(record("child", request({ mode: "extend", extendFromRecordId: "parent" })));
    h.runner.enqueue("child");
    await flush();
    expect(h.records.get("child")).toMatchObject({ status: "failed", error: "Extend needs a finished video to continue from" });
  });

  it("runs one job at a time, FIFO", async () => {
    const h = harness();
    for (const id of ["a", "b", "c"]) h.add(record(id, request({ prompt: `shot ${id}` })));
    h.runner.enqueue("a");
    h.runner.enqueue("b");
    h.runner.enqueue("c");
    await flush();
    expect(h.transport.requestsTo("POST", "/prompt")).toHaveLength(1);
    expect(h.runner.queuedIds()).toEqual(["b", "c"]);
    expect(h.records.get("b")?.status).toBe("queued");

    h.transport.finishPrompt("prompt-1");
    await vi.advanceTimersByTimeAsync(HISTORY_POLL_MS);
    await flush();
    expect(h.records.get("a")?.status).toBe("done");
    expect(h.transport.requestsTo("POST", "/prompt")).toHaveLength(2);
    expect(nodeByTitle(h.postedPrompt(1), "PrimitiveStringMultiline", "Prompt")?.inputs.value).toBe("shot b");
    expect(h.runner.activeId()).toBe("b");
  });

  it("cancels a job still waiting in the local queue without touching ComfyUI", async () => {
    const h = harness();
    h.add(record("a", request()));
    h.add(record("b", request()));
    h.runner.enqueue("a");
    h.runner.enqueue("b");
    await flush();
    await expect(h.runner.cancel("b")).resolves.toBe(true);
    expect(h.records.get("b")?.status).toBe("canceled");
    expect(h.transport.requestsTo("POST", "/interrupt")).toHaveLength(0);
    expect(h.runner.queuedIds()).toEqual([]);
  });

  it("interrupts our prompt when ComfyUI is executing it", async () => {
    const h = harness();
    h.add(record("a", request()));
    h.runner.enqueue("a");
    await flush();
    h.transport.startPrompt("prompt-1");
    await expect(h.runner.cancel("a")).resolves.toBe(true);
    await flush();
    expect(h.transport.requestsTo("POST", "/interrupt").map((r) => r.body)).toEqual([{ prompt_id: "prompt-1" }]);
    expect(h.transport.requestsTo("POST", "/queue")).toHaveLength(0);
    expect(h.records.get("a")?.status).toBe("canceled");
  });

  it("deletes our prompt from ComfyUI's queue when another prompt is executing", async () => {
    const h = harness();
    h.transport.running = ["someone-else"];
    h.add(record("a", request()));
    h.runner.enqueue("a");
    await flush();
    await h.runner.cancel("a");
    await flush();
    expect(h.transport.requestsTo("POST", "/interrupt")).toHaveLength(0);
    expect(h.transport.requestsTo("POST", "/queue").map((r) => r.body)).toEqual([{ delete: ["prompt-1"] }]);
    expect(h.records.get("a")?.status).toBe("canceled");
  });

  it("surfaces ComfyUI node_errors as a readable failure and moves on", async () => {
    const h = harness();
    h.transport.nextPromptResponse = {
      status: 400,
      body: JSON.stringify({
        error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" },
        node_errors: {
          "405:385": {
            errors: [{ type: "value_not_in_list", message: "Value not in list", details: "vae_name: 'x' not in []" }],
            class_type: "VAELoader",
          },
        },
      }),
    };
    h.add(record("a", request()));
    h.add(record("b", request()));
    h.runner.enqueue("a");
    h.runner.enqueue("b");
    await flush();
    expect(h.records.get("a")).toMatchObject({
      status: "failed",
      error: "Prompt outputs failed validation\nVAELoader: Value not in list: vae_name: 'x' not in []",
    });
    expect(h.records.get("b")?.status).toBe("running");
  });

  it("fails with the ComfyUI execution error from history", async () => {
    const h = harness();
    h.add(record("a", request()));
    h.runner.enqueue("a");
    await flush();
    h.transport.history.set("prompt-1", {
      outputs: {},
      status: {
        status_str: "error",
        completed: false,
        messages: [["execution_error", { prompt_id: "prompt-1", node_type: "VAEDecodeTiled", exception_message: "CUDA out of memory" }]],
      },
    });
    h.transport.emit({ type: "execution_error", data: { prompt_id: "prompt-1", node_type: "VAEDecodeTiled", exception_message: "CUDA out of memory" } });
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    expect(h.records.get("a")).toMatchObject({ status: "failed", error: "VAEDecodeTiled: CUDA out of memory" });
  });

  it("fails after repeated /history connection errors", async () => {
    const h = harness();
    h.add(record("a", request()));
    h.runner.enqueue("a");
    await flush();
    h.transport.historyFailures = 3;
    await vi.advanceTimersByTimeAsync(HISTORY_POLL_MS * 3);
    await flush();
    expect(h.records.get("a")).toMatchObject({ status: "failed", error: "Lost connection to ComfyUI while generating: socket hang up" });
  });

  it("does not try to launch when the ComfyUI folder is not set", async () => {
    const h = harness();
    expect(DEFAULT_LTX_SETTINGS.comfyDir).toBe("");
    h.transport.online = false;
    h.add(record("a", request()));
    h.runner.enqueue("a");
    await flush();
    expect(h.transport.launches).toEqual([]);
    expect(h.records.get("a")?.status).toBe("failed");
    expect(h.records.get("a")?.error).toMatch(/folder is not set/);
  });

  it("launches ComfyUI when offline and polls until it answers", async () => {
    const h = harness({ comfyDir: String.raw`D:\ComfyUI`, preLaunchScript: String.raw`D:\tools\free-gpu.ps1` });
    h.transport.online = false;
    h.transport.pingsUntilOnlineAfterLaunch = 3;
    h.add(record("a", request()));
    h.runner.enqueue("a");
    await flush();
    expect(h.connections).toEqual(["starting"]);
    expect(h.transport.launches).toEqual([
      {
        comfyDir: String.raw`D:\ComfyUI`,
        args: ["main.py", "--listen", "127.0.0.1", "--port", "8188"],
        preLaunchScript: String.raw`D:\tools\free-gpu.ps1`,
      },
    ]);
    expect(h.records.get("a")?.status).toBe("preparing");
    await vi.advanceTimersByTimeAsync(LAUNCH_POLL_MS * 3);
    await flush();
    expect(h.records.get("a")?.status).toBe("preparing");
    await vi.advanceTimersByTimeAsync(LAUNCH_POLL_MS);
    await flush();
    expect(h.connections).toEqual(["starting", "ready"]);
    expect(h.records.get("a")?.status).toBe("running");
  });

  it("gives up after the launch timeout", async () => {
    const h = harness({ comfyDir: "D:/ComfyUI" });
    h.transport.online = false;
    h.add(record("a", request()));
    h.runner.enqueue("a");
    await flush();
    await vi.advanceTimersByTimeAsync(LAUNCH_TIMEOUT_MS);
    await flush();
    expect(h.connections).toEqual(["starting", "error"]);
    expect(h.records.get("a")).toMatchObject({ status: "failed" });
    expect(h.records.get("a")?.error).toMatch(/did not answer .* within 15 minutes/);
  });

  it("does not launch when auto-launch is off", async () => {
    const h = harness({ autoLaunch: false });
    h.transport.online = false;
    h.add(record("a", request()));
    h.runner.enqueue("a");
    await flush();
    expect(h.transport.launches).toHaveLength(0);
    expect(h.connections).toEqual(["offline"]);
    expect(h.records.get("a")?.error).toMatch(/auto-launch is off/);
  });

  it("can cancel while waiting for ComfyUI to start", async () => {
    const h = harness({ comfyDir: "D:/ComfyUI" });
    h.transport.online = false;
    h.add(record("a", request()));
    h.runner.enqueue("a");
    await flush();
    await h.runner.cancel("a");
    await flush();
    expect(h.records.get("a")?.status).toBe("canceled");
    expect(h.transport.requestsTo("POST", "/prompt")).toHaveLength(0);
  });

  it("resubscribes when the websocket closes", async () => {
    const h = harness();
    await h.runner.ensureReady();
    expect(h.transport.subscribeCount).toBe(1);
    h.transport.closeSocket();
    await vi.advanceTimersByTimeAsync(RESUBSCRIBE_MS);
    await flush();
    expect(h.transport.subscribeCount).toBe(2);
    await h.runner.dispose();
  });
});

describe("launchArgsWithMain", () => {
  it("guarantees a single leading main.py", () => {
    expect(launchArgsWithMain(["main.py", "--port", "8188"])).toEqual(["main.py", "--port", "8188"]);
    expect(launchArgsWithMain(["--port", "8188"])).toEqual(["main.py", "--port", "8188"]);
  });
});
