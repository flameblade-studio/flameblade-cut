/**
 * Parsers for ComfyUI's `/history/<promptId>` JSON and `/ws` text frames.
 *
 * Both inputs come from another process, so every field is checked before
 * use. Unknown websocket message types parse to `null` (ignored); malformed
 * history is an explicit `HistoryParseError`.
 */
import type { ComfyFileRef } from "./types";

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov"];
/** SaveVideo outputs appear under different keys depending on the ComfyUI version. */
const OUTPUT_FILE_KEYS = ["images", "videos", "gifs"];

export class HistoryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoryParseError";
  }
}

export type HistoryResult =
  /** Not in history yet (queued or still running). */
  | { kind: "pending" }
  | { kind: "success"; video: ComfyFileRef }
  | { kind: "error"; message: string }
  | { kind: "interrupted" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFileRef(value: unknown): ComfyFileRef | null {
  if (!isRecord(value) || typeof value.filename !== "string") return null;
  return {
    filename: value.filename,
    subfolder: typeof value.subfolder === "string" ? value.subfolder : "",
    type: typeof value.type === "string" ? value.type : "output",
  };
}

function isVideoFile(file: ComfyFileRef): boolean {
  const lower = file.filename.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** First video file in a history entry's `outputs`, in node order. */
export function findVideoOutput(outputs: unknown): ComfyFileRef | null {
  if (!isRecord(outputs)) return null;
  for (const nodeOutput of Object.values(outputs)) {
    if (!isRecord(nodeOutput)) continue;
    for (const key of OUTPUT_FILE_KEYS) {
      const files = nodeOutput[key];
      if (!Array.isArray(files)) continue;
      for (const item of files) {
        const file = asFileRef(item);
        if (file !== null && isVideoFile(file)) return file;
      }
    }
  }
  return null;
}

/** Readable error text from `status.messages` (`[type, data]` pairs). */
function statusMessages(status: Record<string, unknown>): Array<[string, Record<string, unknown>]> {
  const messages = status.messages;
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((entry): Array<[string, Record<string, unknown>]> => {
    if (Array.isArray(entry) && typeof entry[0] === "string" && isRecord(entry[1])) {
      return [[entry[0], entry[1]]];
    }
    return [];
  });
}

export function formatComfyError(data: Record<string, unknown>): string {
  const exception = typeof data.exception_message === "string" ? data.exception_message.trim() : "";
  const nodeType = typeof data.node_type === "string" ? data.node_type : "";
  const text = exception || "ComfyUI reported an execution error";
  return nodeType ? `${nodeType}: ${text}` : text;
}

/**
 * Parses the body of `GET /history/<promptId>`.
 * `{}` (prompt unknown to history) means it is still queued or running.
 */
export function parseHistory(body: unknown, promptId: string): HistoryResult {
  if (!isRecord(body)) {
    throw new HistoryParseError("ComfyUI /history response is not a JSON object");
  }
  const entry = body[promptId];
  if (entry === undefined) return { kind: "pending" };
  if (!isRecord(entry)) {
    throw new HistoryParseError(`ComfyUI /history entry for ${promptId} is not an object`);
  }
  const status = isRecord(entry.status) ? entry.status : {};
  const messages = statusMessages(status);
  const error = messages.find(([type]) => type === "execution_error");
  if (error !== undefined) return { kind: "error", message: formatComfyError(error[1]) };
  if (messages.some(([type]) => type === "execution_interrupted")) return { kind: "interrupted" };
  if (status.status_str === "error") return { kind: "error", message: "ComfyUI reported an execution error" };

  const completed = status.completed === true || status.status_str === "success";
  if (!completed) return { kind: "pending" };
  const video = findVideoOutput(entry.outputs);
  if (video === null) {
    return { kind: "error", message: "ComfyUI finished but produced no video file (.mp4/.webm/.mov)" };
  }
  return { kind: "success", video };
}

export type ComfyWsEvent =
  | { type: "status"; queueRemaining: number }
  | { type: "execution_start"; promptId: string }
  | { type: "executing"; promptId: string | null; node: string | null }
  | { type: "progress"; promptId: string | null; node: string | null; value: number; max: number }
  | { type: "execution_success"; promptId: string }
  | { type: "execution_error"; promptId: string; message: string; nodeType: string | null }
  | { type: "execution_interrupted"; promptId: string };

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Parses one `/ws` text frame. Unknown or malformed messages return `null`. */
export function parseWsMessage(text: string): ComfyWsEvent | null {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    // Not JSON: ComfyUI only sends JSON text frames, so this is noise we skip by design.
    return null;
  }
  if (!isRecord(message) || typeof message.type !== "string" || !isRecord(message.data)) return null;
  const data = message.data;
  const promptId = stringOrNull(data.prompt_id);

  switch (message.type) {
    case "status": {
      const info = isRecord(data.status) && isRecord(data.status.exec_info) ? data.status.exec_info : null;
      const remaining = info !== null && typeof info.queue_remaining === "number" ? info.queue_remaining : null;
      return remaining === null ? null : { type: "status", queueRemaining: remaining };
    }
    case "execution_start":
      return promptId === null ? null : { type: "execution_start", promptId };
    case "executing":
      return { type: "executing", promptId, node: stringOrNull(data.node) };
    case "progress":
      if (typeof data.value !== "number" || typeof data.max !== "number") return null;
      return { type: "progress", promptId, node: stringOrNull(data.node), value: data.value, max: data.max };
    case "execution_success":
      return promptId === null ? null : { type: "execution_success", promptId };
    case "execution_error":
      return promptId === null
        ? null
        : { type: "execution_error", promptId, message: formatComfyError(data), nodeType: stringOrNull(data.node_type) };
    case "execution_interrupted":
      return promptId === null ? null : { type: "execution_interrupted", promptId };
    default:
      return null;
  }
}
