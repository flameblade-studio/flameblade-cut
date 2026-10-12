/**
 * Runs LTX-2.5 generation jobs against a local ComfyUI, strictly one at a
 * time (a 16 GB GPU can only hold one LTX job), FIFO for the rest.
 *
 * All ComfyUI traffic and file IO go through the injected `ComfyTransport`.
 * The runner owns no records: it reads them through `getRecord` and reports
 * every change through `onRecordUpdate`, so the store stays the single
 * source of truth.
 *
 * Job lifecycle: queued → preparing (connect, upload images) → running
 * (queued in ComfyUI, progress from /ws, /history polled as a fallback)
 * → downloading → done. Any error → failed; cancel → canceled.
 */
import { buildComfyPrompt, samplerNodeIds, type BinderInputs } from "./workflow-binder";
import { parseHistory, parseWsMessage, type ComfyWsEvent } from "./history-parser";
import { parseQueuePromptResponse, parseQueueState } from "./queue-parser";
import { fileExtension, joinPath, localDateFolder } from "./library-paths";
import type { ReferenceSheetComposer, ReferenceSheetSource } from "./reference-sheet";
import {
  MAX_REFERENCE_IMAGES,
  MIN_REFERENCE_IMAGES,
  type ComfyConnection,
  type ComfyFileRef,
  type ComfyTransport,
  type GenerationRecord,
  type ImageInput,
  type LtxSettings,
} from "./types";

export interface GenerationRunnerDeps {
  transport: ComfyTransport;
  getSettings: () => LtxSettings;
  now: () => Date;
  newId: () => string;
  /** Returns the last frame of a finished video as PNG bytes (implemented with mediabunny). */
  extractLastFrame: (videoPath: string) => Promise<Uint8Array>;
  /** Packs `ref2v` reference images into one PNG sheet (browser: `composeReferenceSheetPng`). */
  composeReferenceSheet: ReferenceSheetComposer;
  getRecord: (id: string) => GenerationRecord | undefined;
  onRecordUpdate: (id: string, patch: Partial<GenerationRecord>) => void;
  onConnection: (state: ComfyConnection, detail: string | null) => void;
}

/** Interval between /system_stats probes while ComfyUI starts. */
export const LAUNCH_POLL_MS = 2_000;
/** First cold start of LTX can be slow (model loading, compile caches). */
export const LAUNCH_TIMEOUT_MS = 15 * 60_000;
/** /history fallback poll while a job runs (websocket messages can be missed). */
export const HISTORY_POLL_MS = 5_000;
/** Faster /history poll once the websocket says our prompt finished. */
export const HISTORY_FINISH_POLL_MS = 500;
export const RESUBSCRIBE_MS = 3_000;
/** Consecutive failed /history requests before the job is failed. */
export const MAX_HISTORY_FAILURES = 3;

export class JobCanceledError extends Error {
  constructor() {
    super("canceled");
    this.name = "JobCanceledError";
  }
}

/** `connectionDetail` value telling the UI to ask for the ComfyUI folder. */
export const COMFY_FOLDER_NOT_SET = "comfy-folder-not-set";

export class ComfyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComfyUnavailableError";
  }
}

type JobPhase = "preparing" | "running" | "downloading";

interface ActiveJob {
  recordId: string;
  phase: JobPhase;
  promptId: string | null;
  abort: AbortController;
  samplerIds: string[];
  samplerFractions: Map<string, number>;
  progress: number;
  /** The websocket reported that our prompt finished (success, error or interrupt). */
  terminalSeen: boolean;
  wake: (() => void) | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Rejects with `JobCanceledError` as soon as the job is canceled. */
function raceAbort<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(new JobCanceledError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new JobCanceledError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GenerationRunner {
  /** Stable websocket client id for this app session. */
  readonly clientId: string;

  private readonly deps: GenerationRunnerDeps;
  private readonly queue: string[] = [];
  private active: ActiveJob | null = null;
  private pumping = false;
  private disposed = false;
  private connection: ComfyConnection = "unknown";
  private readyPromise: Promise<void> | null = null;
  private unsubscribe: (() => Promise<void>) | null = null;
  private subscribing = false;
  private resubscribeTimer: ReturnType<typeof setTimeout> | null = null;
  private subscribeFailureLogged = false;

  constructor(deps: GenerationRunnerDeps) {
    this.deps = deps;
    this.clientId = `flameblade-cut-${deps.newId()}`;
  }

  /** Record ids waiting behind the active job, in run order. */
  queuedIds(): readonly string[] {
    return [...this.queue];
  }

  activeId(): string | null {
    return this.active?.recordId ?? null;
  }

  /** Adds a `queued` record to the FIFO and starts processing if idle. */
  enqueue(recordId: string): void {
    if (this.disposed) throw new Error("GenerationRunner is disposed");
    if (this.queue.includes(recordId) || this.active?.recordId === recordId) return;
    this.queue.push(recordId);
    void this.pump();
  }

  /**
   * Cancels a queued or active job. Returns false when the job is unknown or
   * already downloading (too late to cancel; the file is nearly done).
   */
  async cancel(recordId: string): Promise<boolean> {
    const index = this.queue.indexOf(recordId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.deps.onRecordUpdate(recordId, { status: "canceled", finishedAt: this.deps.now().toISOString() });
      return true;
    }
    const job = this.active;
    if (job === null || job.recordId !== recordId || job.phase === "downloading") return false;
    job.abort.abort();
    if (job.promptId !== null) {
      await this.cancelRemote(job.promptId);
    }
    return true;
  }

  /** Connects to ComfyUI, launching it when offline and `autoLaunch` is on. */
  ensureReady(): Promise<void> {
    this.readyPromise ??= this.connect().finally(() => {
      this.readyPromise = null;
    });
    return this.readyPromise;
  }

  /** Probes ComfyUI once and reports the connection state (no launch). */
  async refreshConnection(): Promise<boolean> {
    const up = await this.ping();
    if (up) {
      this.setConnection("ready", null);
      await this.ensureSubscribed();
    } else if (this.connection !== "starting") {
      this.setConnection("offline", null);
    }
    return up;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.resubscribeTimer !== null) clearTimeout(this.resubscribeTimer);
    this.resubscribeTimer = null;
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = null;
    if (unsubscribe !== null) await unsubscribe();
  }

  // ---- connection -------------------------------------------------------

  private setConnection(state: ComfyConnection, detail: string | null): void {
    if (state === this.connection && detail === null) return;
    this.connection = state;
    this.deps.onConnection(state, detail);
  }

  private async ping(): Promise<boolean> {
    try {
      const res = await this.deps.transport.request(this.deps.getSettings().baseUrl, "GET", "/system_stats");
      return res.status === 200;
    } catch {
      // A refused connection is the normal "ComfyUI is not running" answer.
      return false;
    }
  }

  private async connect(): Promise<void> {
    if (await this.ping()) {
      this.setConnection("ready", null);
      await this.ensureSubscribed();
      return;
    }
    const settings = this.deps.getSettings();
    if (!settings.autoLaunch) {
      this.setConnection("offline", null);
      throw new ComfyUnavailableError(`ComfyUI is not running at ${settings.baseUrl} and auto-launch is off`);
    }
    if (settings.comfyDir.trim() === "") {
      this.setConnection("offline", COMFY_FOLDER_NOT_SET);
      throw new ComfyUnavailableError("ComfyUI is not running and its folder is not set (AI engine settings)");
    }
    this.setConnection("starting", null);
    try {
      await this.deps.transport.launch({
        comfyDir: settings.comfyDir,
        args: launchArgsWithMain(settings.launchArgs),
        preLaunchScript: settings.preLaunchScript,
      });
    } catch (error) {
      const message = `Could not start ComfyUI: ${errorMessage(error)}`;
      this.setConnection("error", message);
      throw new ComfyUnavailableError(message);
    }
    const attempts = Math.ceil(LAUNCH_TIMEOUT_MS / LAUNCH_POLL_MS);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await delay(LAUNCH_POLL_MS);
      if (this.disposed) throw new ComfyUnavailableError("GenerationRunner was disposed while ComfyUI started");
      if (await this.ping()) {
        this.setConnection("ready", null);
        await this.ensureSubscribed();
        return;
      }
    }
    const message = `ComfyUI did not answer at ${settings.baseUrl} within ${LAUNCH_TIMEOUT_MS / 60_000} minutes`;
    this.setConnection("error", message);
    throw new ComfyUnavailableError(message);
  }

  private async ensureSubscribed(): Promise<void> {
    if (this.unsubscribe !== null || this.subscribing || this.disposed) return;
    this.subscribing = true;
    try {
      this.unsubscribe = await this.deps.transport.subscribe(this.deps.getSettings().baseUrl, this.clientId, (text) =>
        this.handleWsFrame(text),
      );
      this.subscribeFailureLogged = false;
    } catch (error) {
      if (!this.subscribeFailureLogged) {
        console.warn("[ltx] ComfyUI websocket unavailable; relying on /history polling:", errorMessage(error));
        this.subscribeFailureLogged = true;
      }
      this.scheduleResubscribe();
    } finally {
      this.subscribing = false;
    }
  }

  private scheduleResubscribe(): void {
    if (this.disposed || this.resubscribeTimer !== null) return;
    this.resubscribeTimer = setTimeout(() => {
      this.resubscribeTimer = null;
      void this.ensureSubscribed();
    }, RESUBSCRIBE_MS);
  }

  private handleWsFrame(text: string | null): void {
    if (text === null) {
      this.unsubscribe = null;
      this.scheduleResubscribe();
      return;
    }
    const event = parseWsMessage(text);
    if (event !== null) this.handleWsEvent(event);
  }

  private handleWsEvent(event: ComfyWsEvent): void {
    const job = this.active;
    if (job === null || job.promptId === null || !("promptId" in event) || event.promptId !== job.promptId) return;
    switch (event.type) {
      case "progress":
        this.applyProgress(job, event.node, event.value, event.max);
        return;
      case "executing":
        if (event.node === null) this.markTerminal(job);
        return;
      case "execution_success":
      case "execution_error":
      case "execution_interrupted":
        this.markTerminal(job);
        return;
      case "execution_start":
        return;
    }
  }

  private markTerminal(job: ActiveJob): void {
    job.terminalSeen = true;
    job.wake?.();
  }

  /** Overall progress = mean of the sampler nodes' fractions; monotonic, < 1 until done. */
  private applyProgress(job: ActiveJob, node: string | null, value: number, max: number): void {
    if (node === null || !job.samplerIds.includes(node) || max <= 0) return;
    const fraction = Math.min(1, Math.max(0, value / max));
    job.samplerFractions.set(node, Math.max(job.samplerFractions.get(node) ?? 0, fraction));
    let sum = 0;
    for (const value of job.samplerFractions.values()) sum += value;
    const overall = Math.min(0.99, sum / job.samplerIds.length);
    if (overall > job.progress) {
      job.progress = overall;
      this.deps.onRecordUpdate(job.recordId, { progress: overall });
    }
  }

  // ---- job processing ---------------------------------------------------

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const recordId = this.queue.shift() as string;
        await this.runJob(recordId);
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Never throws: every outcome ends as a record update. */
  private async runJob(recordId: string): Promise<void> {
    const job: ActiveJob = {
      recordId,
      phase: "preparing",
      promptId: null,
      abort: new AbortController(),
      samplerIds: [],
      samplerFractions: new Map(),
      progress: 0,
      terminalSeen: false,
      wake: null,
    };
    this.active = job;
    const update = (patch: Partial<GenerationRecord>) => this.deps.onRecordUpdate(recordId, patch);
    const signal = job.abort.signal;
    try {
      update({ status: "preparing", progress: 0, error: null, startedAt: this.deps.now().toISOString() });
      await raceAbort(signal, this.ensureReady());
      const record = this.deps.getRecord(recordId);
      if (record === undefined) throw new Error(`Generation record ${recordId} no longer exists`);
      const images = await raceAbort(signal, this.prepareImages(record));
      const prompt = buildComfyPrompt(record.request, { recordId, ...images });
      job.samplerIds = samplerNodeIds(prompt);
      if (signal.aborted) throw new JobCanceledError();

      const promptId = await this.queuePrompt(prompt);
      job.promptId = promptId;
      if (signal.aborted) {
        // Canceled while /prompt was in flight: remove it from ComfyUI's queue too.
        await this.cancelRemote(promptId);
        throw new JobCanceledError();
      }
      job.phase = "running";
      update({ status: "running", comfyPromptId: promptId });

      const video = await this.waitForVideo(job);
      job.phase = "downloading";
      update({ status: "downloading", progress: 1 });
      const outputPath = await this.downloadVideo(recordId, video);
      update({ status: "done", progress: 1, outputPath, finishedAt: this.deps.now().toISOString() });
    } catch (error) {
      const finishedAt = this.deps.now().toISOString();
      if (error instanceof JobCanceledError || signal.aborted) {
        update({ status: "canceled", finishedAt });
      } else {
        update({ status: "failed", error: errorMessage(error), finishedAt });
      }
    } finally {
      this.active = null;
    }
  }

  private async prepareImages(record: GenerationRecord): Promise<Omit<BinderInputs, "recordId">> {
    const { request, id } = record;
    switch (request.mode) {
      case "t2v":
        return { firstImage: null, lastImage: null };
      case "i2v":
        return { firstImage: await this.uploadLocalImage(id, "first", request.firstImage), lastImage: null };
      case "flf2v":
        return {
          firstImage: await this.uploadLocalImage(id, "first", request.firstImage),
          lastImage: await this.uploadLocalImage(id, "last", request.lastImage),
        };
      case "extend": {
        const parentId = request.extendFromRecordId;
        const parent = parentId === null ? undefined : this.deps.getRecord(parentId);
        if (parent === undefined || parent.status !== "done" || parent.outputPath === null) {
          throw new Error("Extend needs a finished video to continue from");
        }
        const png = await this.deps.extractLastFrame(parent.outputPath);
        const firstImage = await this.deps.transport.uploadImage(
          this.deps.getSettings().baseUrl,
          png,
          `${id}-first.png`,
        );
        return { firstImage, lastImage: null };
      }
      case "ref2v":
        return { firstImage: null, lastImage: null, referenceSheet: await this.uploadReferenceSheet(record) };
    }
  }

  /** Reads every reference image, composes the sheet and uploads it as `<recordId>-sheet.png`. */
  private async uploadReferenceSheet(record: GenerationRecord): Promise<ComfyFileRef> {
    const { referenceImages, aspect } = record.request;
    if (referenceImages.length < MIN_REFERENCE_IMAGES || referenceImages.length > MAX_REFERENCE_IMAGES) {
      throw new Error(
        `Reference-to-video needs ${MIN_REFERENCE_IMAGES}–${MAX_REFERENCE_IMAGES} reference images, got ${referenceImages.length}`,
      );
    }
    const sources: ReferenceSheetSource[] = [];
    for (const image of referenceImages) {
      sources.push({ image, bytes: await this.deps.transport.readFileBytes(image.path) });
    }
    const png = await this.deps.composeReferenceSheet(sources, aspect);
    return this.deps.transport.uploadImage(this.deps.getSettings().baseUrl, png, `${record.id}-sheet.png`);
  }

  private async uploadLocalImage(
    recordId: string,
    role: "first" | "last",
    image: ImageInput | null,
  ): Promise<ComfyFileRef> {
    if (image === null) {
      throw new Error(`This mode needs a ${role}-frame image`);
    }
    const bytes = await this.deps.transport.readFileBytes(image.path);
    const filename = `${recordId}-${role}${fileExtension(image.name || image.path, ".png")}`;
    return this.deps.transport.uploadImage(this.deps.getSettings().baseUrl, bytes, filename);
  }

  private async queuePrompt(prompt: unknown): Promise<string> {
    const res = await this.deps.transport.request(this.deps.getSettings().baseUrl, "POST", "/prompt", {
      prompt,
      client_id: this.clientId,
    });
    return parseQueuePromptResponse(res.status, res.body);
  }

  /** Waits on websocket wake-ups or the /history poll interval, whichever comes first. */
  private waitForWake(job: ActiveJob, ms: number): Promise<void> {
    const signal = job.abort.signal;
    if (signal.aborted) return Promise.reject(new JobCanceledError());
    return new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        job.wake = null;
      };
      const onWake = () => {
        finish();
        resolve();
      };
      const onAbort = () => {
        finish();
        reject(new JobCanceledError());
      };
      const timer = setTimeout(onWake, ms);
      job.wake = onWake;
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async waitForVideo(job: ActiveJob): Promise<ComfyFileRef> {
    const promptId = job.promptId as string;
    let failures = 0;
    for (;;) {
      await this.waitForWake(job, job.terminalSeen ? HISTORY_FINISH_POLL_MS : HISTORY_POLL_MS);
      let res;
      try {
        res = await this.deps.transport.request(this.deps.getSettings().baseUrl, "GET", `/history/${promptId}`);
      } catch (error) {
        failures += 1;
        if (failures >= MAX_HISTORY_FAILURES) {
          throw new Error(`Lost connection to ComfyUI while generating: ${errorMessage(error)}`);
        }
        continue;
      }
      if (res.status !== 200) {
        failures += 1;
        if (failures >= MAX_HISTORY_FAILURES) {
          throw new Error(`ComfyUI /history answered HTTP ${res.status}`);
        }
        continue;
      }
      failures = 0;
      const result = parseHistory(JSON.parse(res.body), promptId);
      switch (result.kind) {
        case "pending":
          continue;
        case "success":
          return result.video;
        case "error":
          throw new Error(result.message);
        case "interrupted":
          if (job.abort.signal.aborted) throw new JobCanceledError();
          throw new Error("The job was interrupted in ComfyUI");
      }
    }
  }

  private async downloadVideo(recordId: string, video: ComfyFileRef): Promise<string> {
    const libraryDir = this.deps.getSettings().outputDir ?? (await this.deps.transport.libraryDir());
    const dest = joinPath(
      libraryDir,
      localDateFolder(this.deps.now()),
      `${recordId}${fileExtension(video.filename, ".mp4")}`,
    );
    await this.deps.transport.download(this.deps.getSettings().baseUrl, video, dest);
    return dest;
  }

  /** Interrupts our prompt if ComfyUI is executing it, or deletes it from ComfyUI's queue. */
  private async cancelRemote(promptId: string): Promise<void> {
    const { transport, getSettings } = this.deps;
    const baseUrl = getSettings().baseUrl;
    const res = await transport.request(baseUrl, "GET", "/queue");
    if (res.status !== 200) throw new Error(`ComfyUI /queue answered HTTP ${res.status}`);
    const queue = parseQueueState(res.body);
    if (queue.running.includes(promptId)) {
      await transport.request(baseUrl, "POST", "/interrupt", { prompt_id: promptId });
    }
    if (queue.pending.includes(promptId)) {
      await transport.request(baseUrl, "POST", "/queue", { delete: [promptId] });
    }
  }
}

/**
 * Arguments for `ComfyTransport.launch`: the desktop bridge only accepts
 * argument lists that start with `main.py` (so the IPC cannot run arbitrary
 * Python), and `LtxSettings.launchArgs` normally already does.
 */
export function launchArgsWithMain(launchArgs: readonly string[]): string[] {
  return launchArgs[0]?.toLowerCase() === "main.py" ? [...launchArgs] : ["main.py", ...launchArgs];
}
