/**
 * Parsers for ComfyUI's `POST /prompt` response and `GET /queue` state.
 */

export class ComfyPromptRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComfyPromptRejectedError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Non-JSON bodies (e.g. an HTML 500 page) are reported verbatim by the caller.
    return null;
  }
}

/** `"UNETLoader: Value not in list: unet_name: 'x' not in [...]"` for each node error. */
function describeNodeErrors(nodeErrors: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [nodeId, value] of Object.entries(nodeErrors)) {
    if (!isRecord(value)) continue;
    const classType = typeof value.class_type === "string" ? value.class_type : `node ${nodeId}`;
    const errors = Array.isArray(value.errors) ? value.errors : [];
    for (const error of errors) {
      if (!isRecord(error)) continue;
      const message = typeof error.message === "string" ? error.message : "invalid input";
      const details = typeof error.details === "string" && error.details ? `: ${error.details}` : "";
      lines.push(`${classType}: ${message}${details}`);
    }
  }
  return lines;
}

/**
 * Returns the queued prompt id, or throws `ComfyPromptRejectedError` with a
 * readable message (HTTP error, validation `error`, or `node_errors`).
 */
export function parseQueuePromptResponse(status: number, bodyText: string): string {
  const body = parseJsonOrNull(bodyText);
  const nodeErrors = isRecord(body) && isRecord(body.node_errors) ? describeNodeErrors(body.node_errors) : [];
  const topError =
    isRecord(body) && isRecord(body.error) && typeof body.error.message === "string" ? body.error.message : null;
  const promptId = isRecord(body) && typeof body.prompt_id === "string" ? body.prompt_id : null;

  if (status === 200 && promptId !== null && nodeErrors.length === 0) return promptId;

  const parts = [topError ?? `ComfyUI rejected the job (HTTP ${status})`, ...nodeErrors];
  if (topError === null && nodeErrors.length === 0 && body === null && bodyText.trim()) {
    parts.push(bodyText.trim().slice(0, 300));
  }
  throw new ComfyPromptRejectedError(parts.join("\n"));
}

export interface ComfyQueueState {
  running: string[];
  pending: string[];
}

/** Prompt ids in `GET /queue` (`queue_running` / `queue_pending` items are `[number, promptId, ...]`). */
export function parseQueueState(bodyText: string): ComfyQueueState {
  const body = parseJsonOrNull(bodyText);
  if (!isRecord(body)) {
    throw new Error("ComfyUI /queue response is not a JSON object");
  }
  const ids = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.flatMap((item) => (Array.isArray(item) && typeof item[1] === "string" ? [item[1]] : []))
      : [];
  return { running: ids(body.queue_running), pending: ids(body.queue_pending) };
}
