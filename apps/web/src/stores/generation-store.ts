/**
 * Generation store: the UI's single entry point to local LTX-2.5 video
 * generation (prompt box, history list, director-mode storyboard).
 *
 * Composition root: `init(transport, deps)` wires the injected
 * `ComfyTransport` into a `GenerationRunner`. Records, settings and the
 * storyboard persist to `<libraryDir>/flameblade-cut-history.json` through
 * the transport (debounced). Removing a record never deletes its video file.
 */
import { create } from "zustand";
import { GenerationRunner } from "../services/ltx/generation-runner";
import {
  emptyHistory,
  isInFlight,
  parseHistoryFile,
  serializeHistory,
} from "../services/ltx/history-file";
import { composeReferenceSheetPng, type ReferenceSheetComposer } from "../services/ltx/reference-sheet";
import { HISTORY_FILE_NAME, joinPath, newRecordId, randomSeed48, SEED_LIMIT } from "../services/ltx/library-paths";
import {
  MAX_GENERATION_SECONDS,
  MAX_REFERENCE_IMAGES,
  MIN_REFERENCE_IMAGES,
  type ComfyConnection,
  type ComfyTransport,
  type GenerationAspect,
  type GenerationQuality,
  type GenerationRecord,
  type GenerationRequest,
  type LtxSettings,
  type Storyboard,
  type StoryboardShot,
} from "../services/ltx/types";

export const PERSIST_DEBOUNCE_MS = 500;

export interface GenerationStoreDeps {
  now: () => Date;
  newId: () => string;
  /** Integer in [0, 2^48). */
  randomSeed: () => number;
  /** Last frame of a finished video as PNG bytes; required for `extend`. */
  extractLastFrame: (videoPath: string) => Promise<Uint8Array>;
  /** Packs `ref2v` reference images into one PNG sheet; defaults to the browser canvas renderer. */
  composeReferenceSheet: ReferenceSheetComposer;
}

/** A request from the UI; the store picks a random seed when none is given. */
export type GenerationSubmission = Omit<GenerationRequest, "seed"> & { seed?: number };

export type ShotDraft = Partial<Omit<StoryboardShot, "id" | "recordId">>;

/** A shot prompt already translated by the UI (`prompt` is sent, `promptOriginal` is shown). */
export interface PreparedPrompt {
  prompt: string;
  promptOriginal: string | null;
}

/** Shots `generateStoryboard` would submit: written, and without a finished or in-flight record. */
export function pendingStoryboardShots(storyboard: Storyboard, records: readonly GenerationRecord[]): StoryboardShot[] {
  return storyboard.shots.filter((shot) => {
    if (!shot.prompt.trim()) return false;
    const latest = shot.recordId === null ? undefined : records.find((r) => r.id === shot.recordId);
    return !(latest !== undefined && (latest.status === "done" || isInFlight(latest.status)));
  });
}

export class GenerationRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationRequestError";
  }
}

export interface GenerationStoreState {
  /** Newest first. */
  records: GenerationRecord[];
  connection: ComfyConnection;
  connectionDetail: string | null;
  settings: LtxSettings;
  storyboard: Storyboard;
  activeRecordId: string | null;
  initialized: boolean;

  init(transport: ComfyTransport, deps?: Partial<GenerationStoreDeps>): Promise<void>;
  submit(request: GenerationSubmission): string;
  cancel(id: string): Promise<boolean>;
  retry(id: string, options?: { keepSeed?: boolean }): string;
  remove(id: string): void;
  /** `promptOriginal` is the user's text when `prompt` is its translation. */
  extend(id: string, prompt: string, promptOriginal?: string | null): string;
  setActiveRecord(id: string | null): void;
  updateSettings(partial: Partial<LtxSettings>): void;
  /** Probes ComfyUI (never launches it) and updates `connection`. */
  refreshConnection(): Promise<void>;

  addShot(draft?: ShotDraft): string;
  updateShot(id: string, patch: ShotDraft): void;
  removeShot(id: string): void;
  moveShot(id: string, toIndex: number): void;
  setStoryboardFormat(format: { aspect?: GenerationAspect; quality?: GenerationQuality }): void;
  /**
   * Submits, in order, every shot without a finished or in-flight record
   * (`pendingStoryboardShots`). `prepared` holds translated prompts by shot
   * id; shots missing from it are sent as written. Returns the new record ids.
   */
  generateStoryboard(prepared?: Readonly<Record<string, PreparedPrompt>>): string[];

  /** Writes pending changes now (e.g. before the window closes). */
  flushPersistence(): Promise<void>;
  dispose(): Promise<void>;
}

function missingExtractLastFrame(): Promise<Uint8Array> {
  return Promise.reject(new Error("Extending a video needs last-frame extraction, which is not configured"));
}

const DEFAULT_DEPS: GenerationStoreDeps = {
  now: () => new Date(),
  newId: newRecordId,
  randomSeed: randomSeed48,
  extractLastFrame: missingExtractLastFrame,
  composeReferenceSheet: composeReferenceSheetPng,
};

function validateRequest(request: GenerationRequest): void {
  if (!request.prompt.trim()) throw new GenerationRequestError("Please describe the video (the prompt is empty)");
  if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed >= SEED_LIMIT) {
    throw new GenerationRequestError(`Seed must be an integer in [0, 2^48), got ${request.seed}`);
  }
  if (!Number.isInteger(request.durationSec) || request.durationSec < 1 || request.durationSec > MAX_GENERATION_SECONDS) {
    throw new GenerationRequestError(`Duration must be 1–${MAX_GENERATION_SECONDS} whole seconds, got ${request.durationSec}`);
  }
  if ((request.mode === "i2v" || request.mode === "flf2v") && request.firstImage === null) {
    throw new GenerationRequestError("Choose a first-frame image");
  }
  if (request.mode === "flf2v" && request.lastImage === null) {
    throw new GenerationRequestError("Choose a last-frame image");
  }
  if (request.mode === "extend" && request.extendFromRecordId === null) {
    throw new GenerationRequestError("Choose the video to extend");
  }
  if (request.mode === "ref2v") {
    const count = request.referenceImages.length;
    if (count < MIN_REFERENCE_IMAGES || count > MAX_REFERENCE_IMAGES) {
      throw new GenerationRequestError(
        `Choose ${MIN_REFERENCE_IMAGES}–${MAX_REFERENCE_IMAGES} reference images (got ${count})`,
      );
    }
    if (request.enhancePrompt) {
      throw new GenerationRequestError("Prompt enhance is not available for reference-to-video");
    }
  } else if (request.referenceImages.length > 0) {
    throw new GenerationRequestError("Reference images are only used by reference-to-video");
  }
}

export function createGenerationStore() {
  let transport: ComfyTransport | null = null;
  let runner: GenerationRunner | null = null;
  let deps: GenerationStoreDeps = DEFAULT_DEPS;
  let historyPath: string | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  return create<GenerationStoreState>()((set, get) => {
    const requireRunner = (): GenerationRunner => {
      if (runner === null) throw new Error("Generation store is not initialized; call init(transport) first");
      return runner;
    };

    const writeHistory = async (): Promise<void> => {
      if (transport === null || historyPath === null) return;
      const { records, settings, storyboard } = get();
      await transport.writeTextFile(historyPath, serializeHistory({ records, settings, storyboard }));
    };

    const schedulePersist = (): void => {
      if (transport === null) return;
      if (persistTimer !== null) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistTimer = null;
        writeHistory().catch((error: unknown) => {
          console.warn("[generation-store] could not save generation history:", error);
        });
      }, PERSIST_DEBOUNCE_MS);
    };

    const patchRecord = (id: string, patch: Partial<GenerationRecord>): void => {
      set((state) => ({
        records: state.records.map((record) => (record.id === id ? { ...record, ...patch } : record)),
      }));
      const progressOnly = Object.keys(patch).every((key) => key === "progress");
      if (!progressOnly) schedulePersist();
    };

    const addRecord = (request: GenerationRequest): string => {
      validateRequest(request);
      const active = requireRunner();
      const record: GenerationRecord = {
        id: deps.newId(),
        createdAt: deps.now().toISOString(),
        request,
        status: "queued",
        progress: 0,
        outputPath: null,
        posterPath: null,
        error: null,
        startedAt: null,
        finishedAt: null,
        comfyPromptId: null,
      };
      set((state) => ({ records: [record, ...state.records], activeRecordId: record.id }));
      schedulePersist();
      active.enqueue(record.id);
      return record.id;
    };

    const findRecord = (id: string): GenerationRecord => {
      const record = get().records.find((r) => r.id === id);
      if (record === undefined) throw new GenerationRequestError(`Unknown generation ${id}`);
      return record;
    };

    const setStoryboard = (update: (storyboard: Storyboard) => Storyboard): void => {
      set((state) => ({ storyboard: update(state.storyboard) }));
      schedulePersist();
    };

    return {
      records: [],
      connection: "unknown",
      connectionDetail: null,
      settings: emptyHistory().settings,
      storyboard: emptyHistory().storyboard,
      activeRecordId: null,
      initialized: false,

      async init(nextTransport, overrides = {}) {
        if (get().initialized) return;
        transport = nextTransport;
        deps = { ...DEFAULT_DEPS, ...overrides };
        historyPath = joinPath(await nextTransport.libraryDir(), HISTORY_FILE_NAME);

        let loaded = emptyHistory();
        const text = await nextTransport.readTextFile(historyPath);
        if (text !== null) {
          try {
            loaded = parseHistoryFile(text, deps.now().toISOString());
          } catch (error) {
            console.warn("[generation-store] generation history is unreadable; starting empty:", error);
          }
        }
        set({ ...loaded, initialized: true });

        runner = new GenerationRunner({
          transport: nextTransport,
          getSettings: () => get().settings,
          now: deps.now,
          newId: deps.newId,
          extractLastFrame: (path) => deps.extractLastFrame(path),
          composeReferenceSheet: (sources, aspect) => deps.composeReferenceSheet(sources, aspect),
          getRecord: (id) => get().records.find((r) => r.id === id),
          onRecordUpdate: patchRecord,
          onConnection: (connection, detail) => set({ connection, connectionDetail: detail }),
        });
        if (loaded.records.some((r) => r.error === "interrupted")) schedulePersist();
        void runner.refreshConnection();
      },

      submit(submission) {
        return addRecord({ ...submission, seed: submission.seed ?? deps.randomSeed() });
      },

      async cancel(id) {
        return requireRunner().cancel(id);
      },

      retry(id, options = {}) {
        const { request } = findRecord(id);
        return addRecord({ ...request, seed: options.keepSeed ? request.seed : deps.randomSeed() });
      },

      remove(id) {
        const record = get().records.find((r) => r.id === id);
        if (record === undefined) return;
        if (isInFlight(record.status) && runner !== null) {
          runner.cancel(id).catch((error: unknown) => {
            console.warn("[generation-store] could not cancel the removed generation in ComfyUI:", error);
          });
        }
        set((state) => ({
          records: state.records.filter((r) => r.id !== id),
          activeRecordId: state.activeRecordId === id ? null : state.activeRecordId,
        }));
        schedulePersist();
      },

      extend(id, prompt, promptOriginal = null) {
        const parent = findRecord(id);
        if (parent.status !== "done" || parent.outputPath === null) {
          throw new GenerationRequestError("Only a finished video can be extended");
        }
        return addRecord({
          ...parent.request,
          mode: "extend",
          prompt,
          promptOriginal,
          seed: deps.randomSeed(),
          firstImage: null,
          lastImage: null,
          referenceImages: [],
          extendFromRecordId: id,
        });
      },

      setActiveRecord(id) {
        set({ activeRecordId: id });
      },

      updateSettings(partial) {
        set((state) => ({ settings: { ...state.settings, ...partial } }));
        schedulePersist();
      },

      async refreshConnection() {
        await requireRunner().refreshConnection();
      },

      addShot(draft = {}) {
        const shot: StoryboardShot = {
          id: deps.newId(),
          prompt: draft.prompt ?? "",
          image: draft.image ?? null,
          durationSec: draft.durationSec ?? 5,
          recordId: null,
        };
        setStoryboard((sb) => ({ ...sb, shots: [...sb.shots, shot] }));
        return shot.id;
      },

      updateShot(id, patch) {
        setStoryboard((sb) => ({
          ...sb,
          shots: sb.shots.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)),
        }));
      },

      removeShot(id) {
        setStoryboard((sb) => ({ ...sb, shots: sb.shots.filter((shot) => shot.id !== id) }));
      },

      moveShot(id, toIndex) {
        setStoryboard((sb) => {
          const from = sb.shots.findIndex((shot) => shot.id === id);
          if (from < 0) return sb;
          const shots = [...sb.shots];
          const [shot] = shots.splice(from, 1);
          shots.splice(Math.max(0, Math.min(toIndex, shots.length)), 0, shot);
          return { ...sb, shots };
        });
      },

      setStoryboardFormat(format) {
        setStoryboard((sb) => ({ ...sb, ...format }));
      },

      generateStoryboard(prepared = {}) {
        const { storyboard, records } = get();
        const submitted: string[] = [];
        for (const shot of pendingStoryboardShots(storyboard, records)) {
          const text = prepared[shot.id] ?? { prompt: shot.prompt, promptOriginal: null };
          const recordId = get().submit({
            mode: shot.image === null ? "t2v" : "i2v",
            prompt: text.prompt,
            promptOriginal: text.promptOriginal,
            aspect: storyboard.aspect,
            quality: storyboard.quality,
            durationSec: shot.durationSec,
            firstImage: shot.image,
            lastImage: null,
            referenceImages: [],
            extendFromRecordId: null,
            enhancePrompt: false,
          });
          setStoryboard((sb) => ({
            ...sb,
            shots: sb.shots.map((s) => (s.id === shot.id ? { ...s, recordId } : s)),
          }));
          submitted.push(recordId);
        }
        return submitted;
      },

      async flushPersistence() {
        if (persistTimer !== null) {
          clearTimeout(persistTimer);
          persistTimer = null;
        }
        await writeHistory();
      },

      async dispose() {
        await get().flushPersistence();
        await runner?.dispose();
        runner = null;
        transport = null;
        historyPath = null;
        set({ initialized: false });
      },
    };
  });
}

export type GenerationStore = ReturnType<typeof createGenerationStore>;

export const useGenerationStore = createGenerationStore();
