/**
 * The generation history file `<libraryDir>/flameblade-cut-history.json`:
 * records, LTX settings and the storyboard, versioned for future migrations.
 */
import { LTX_MODEL_CHOICES } from "./model-choice";
import {
  DEFAULT_LTX_SETTINGS,
  GENERATION_ASPECTS,
  GENERATION_QUALITIES,
  type GenerationRecord,
  type GenerationRequest,
  type GenerationStatus,
  type ImageInput,
  type LtxSettings,
  type Storyboard,
  type StoryboardShot,
} from "./types";

export const HISTORY_FILE_VERSION = 1;

export interface HistoryFileData {
  records: GenerationRecord[];
  settings: LtxSettings;
  storyboard: Storyboard;
}

export const IN_FLIGHT_STATUSES: readonly GenerationStatus[] = ["queued", "preparing", "running", "downloading"];

export function isInFlight(status: GenerationStatus): boolean {
  return IN_FLIGHT_STATUSES.includes(status);
}

export function defaultStoryboard(): Storyboard {
  return { aspect: "16:9", quality: "720p", shots: [] };
}

export function defaultSettings(): LtxSettings {
  return { ...DEFAULT_LTX_SETTINGS, launchArgs: [...DEFAULT_LTX_SETTINGS.launchArgs] };
}

export function emptyHistory(): HistoryFileData {
  return { records: [], settings: defaultSettings(), storyboard: defaultStoryboard() };
}

export function serializeHistory(data: HistoryFileData): string {
  return JSON.stringify({ version: HISTORY_FILE_VERSION, ...data }, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGenerationRecord(value: unknown): value is GenerationRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    typeof value.createdAt === "string" &&
    isRecord(value.request) &&
    typeof value.request.prompt === "string" &&
    typeof value.request.mode === "string"
  );
}

function isImageInput(value: unknown): value is ImageInput {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.name === "string" &&
    (value.description === undefined || typeof value.description === "string")
  );
}

/**
 * Fills request fields added after a record was written: `referenceImages`
 * (added with `ref2v`) is `[]` when missing, invalid entries are dropped;
 * `promptOriginal` (added with prompt translation) is null unless a string;
 * `autoPlan` (added with shot planning) is null unless a known engine.
 */
function normalizeRequest(request: GenerationRecord["request"]): GenerationRequest {
  const raw = (request as { referenceImages?: unknown }).referenceImages;
  const referenceImages = Array.isArray(raw) ? raw.filter(isImageInput) : [];
  const original = (request as { promptOriginal?: unknown }).promptOriginal;
  const promptOriginal = typeof original === "string" && original.trim() !== "" ? original : null;
  const plan = (request as { autoPlan?: unknown }).autoPlan;
  const autoPlan = plan === "openai" || plan === "local" ? plan : null;
  return { ...request, referenceImages, promptOriginal, autoPlan };
}

/** `sentPrompt` was added with shot planning; older records have none. */
function normalizeRecord(record: GenerationRecord): GenerationRecord {
  const sent = (record as { sentPrompt?: unknown }).sentPrompt;
  return { ...record, request: normalizeRequest(record.request), sentPrompt: typeof sent === "string" ? sent : null };
}

function isShot(value: unknown): value is StoryboardShot {
  return isRecord(value) && typeof value.id === "string" && typeof value.prompt === "string";
}

function parseSettings(value: unknown): LtxSettings {
  const defaults = defaultSettings();
  if (!isRecord(value)) return defaults;
  return {
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : defaults.baseUrl,
    comfyDir: typeof value.comfyDir === "string" ? value.comfyDir : defaults.comfyDir,
    autoLaunch: typeof value.autoLaunch === "boolean" ? value.autoLaunch : defaults.autoLaunch,
    launchArgs:
      Array.isArray(value.launchArgs) && value.launchArgs.every((arg) => typeof arg === "string")
        ? (value.launchArgs as string[])
        : defaults.launchArgs,
    preLaunchScript:
      typeof value.preLaunchScript === "string" || value.preLaunchScript === null
        ? (value.preLaunchScript as string | null)
        : defaults.preLaunchScript,
    // Absent in history files written before 0.1.0 previews had this setting.
    outputDir: typeof value.outputDir === "string" && value.outputDir.trim() !== "" ? value.outputDir : null,
    // Absent in history files written before the model choice existed.
    model: LTX_MODEL_CHOICES.find((choice) => choice === value.model) ?? defaults.model,
  };
}

function parseStoryboard(value: unknown): Storyboard {
  const defaults = defaultStoryboard();
  if (!isRecord(value)) return defaults;
  const aspect = GENERATION_ASPECTS.find((a) => a === value.aspect) ?? defaults.aspect;
  const quality = GENERATION_QUALITIES.find((q) => q === value.quality) ?? defaults.quality;
  const shots = Array.isArray(value.shots) ? value.shots.filter(isShot) : [];
  return { aspect, quality, shots };
}

/**
 * Parses the history file. Records that were in flight when the app closed
 * become `failed` with the message "interrupted". Invalid entries are dropped;
 * unparseable JSON throws (the caller logs it and starts empty).
 */
export function parseHistoryFile(text: string, finishedAt: string): HistoryFileData {
  const json: unknown = JSON.parse(text);
  if (!isRecord(json)) throw new Error("history file is not a JSON object");
  const records = (Array.isArray(json.records) ? json.records : [])
    .filter(isGenerationRecord)
    .map(normalizeRecord)
    .map((record) =>
      isInFlight(record.status)
        ? { ...record, status: "failed" as const, error: "interrupted", finishedAt: record.finishedAt ?? finishedAt }
        : record,
    );
  return { records, settings: parseSettings(json.settings), storyboard: parseStoryboard(json.storyboard) };
}
