/**
 * Main-process OpenAI text generation with Structured Outputs (JSON schema).
 *
 * Used by the AI Highlights page to rank transcript moments. The renderer
 * sends instructions, the transcript and a JSON schema; this module adds the
 * key, calls the Responses API and returns the model's JSON text unparsed (the
 * renderer validates it against its own domain rules).
 *
 * Secrets: the OpenAI key is read here from the encrypted KeyStore under
 * `OPENAI_TEXT_KEY_ID` and never leaves the main process. It is never logged,
 * never copied into an error message (response excerpts are redacted) and
 * never written to disk.
 *
 * API reference, verified 2026-10-12:
 * - https://developers.openai.com/api/docs/guides/structured-outputs
 *   (`POST /v1/responses`, `text.format = { type: "json_schema", name, schema,
 *   strict: true }`; read `output[].content[]` items of type `output_text`
 *   (`text`) or `refusal` (`refusal`); `status: "incomplete"` with
 *   `incomplete_details.reason` means the JSON may be cut off).
 * - https://developers.openai.com/api/docs/models and
 *   https://developers.openai.com/api/docs/models/gpt-6.1-sol
 *   (`gpt-6.1-sol`: "Near-Astra performance for complex work at a lower
 *   cost", supports Structured Outputs and the Responses API, 1,050,000-token
 *   context; `reasoning.effort` accepts low | medium | high | xhigh | max).
 *
 * Composition: `createOpenAiTextService(deps)` is pure and testable (fetch,
 * key lookup and base URL are injected); `registerOpenAiTextIpc(channels)`
 * wires it to Electron.
 */
import { z } from "zod";
import { handle } from "./index";
import { getKeyStore } from "./keychain";

/** KeyStore id of the OpenAI key (shared with the voiceover engine). */
export const OPENAI_TEXT_KEY_ID = "flameblade.openai-key";
/** Balanced quality/cost model; see the citation in the module header. */
export const OPENAI_TEXT_MODEL = "gpt-6.1-sol";
export const OPENAI_TEXT_TIMEOUT_MS = 180_000;
const ERROR_EXCERPT_CHARS = 300;
const USER_AGENT = "FlamebladeCut-Highlights/1.0";

export const OPENAI_TEXT_MAX_INPUT_CHARS = 600_000;

export const openAiTextChatArgsSchema = z
  .object({
    instructions: z.string().trim().min(1).max(20_000),
    input: z.string().trim().min(1).max(OPENAI_TEXT_MAX_INPUT_CHARS),
    jsonSchema: z
      .object({
        name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        schema: z.record(z.unknown()),
      })
      .strict(),
    maxOutputTokens: z.number().int().min(256).max(32_000).optional(),
    reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();
export type OpenAiTextChatArgs = z.infer<typeof openAiTextChatArgsSchema>;

export interface OpenAiTextChatResult {
  /** The model's JSON text (conforming to `jsonSchema` when strict mode held). */
  readonly text: string;
  /** Model id reported by the API. */
  readonly model: string;
}

export interface OpenAiTextKeyStatus {
  readonly configured: boolean;
}

export type OpenAiTextErrorCode = "missing-key" | "http" | "timeout" | "refusal" | "incomplete" | "bad-response";

export class OpenAiTextError extends Error {
  constructor(
    readonly code: OpenAiTextErrorCode,
    message: string,
  ) {
    super(`openai-text:${code}: ${message}`);
    this.name = "OpenAiTextError";
  }
}

export interface OpenAiTextServiceDeps {
  /** Reads a secret from the encrypted KeyStore. */
  getKey(id: string): Promise<string | null>;
  fetch: typeof globalThis.fetch;
  /** Test seam only; production uses https://api.openai.com. */
  baseUrl?: string;
  timeoutMs?: number;
}

export interface OpenAiTextService {
  chat(args: OpenAiTextChatArgs): Promise<OpenAiTextChatResult>;
  keyStatus(): Promise<OpenAiTextKeyStatus>;
}

function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("***") : text;
}

interface ResponsesContentItem {
  type?: unknown;
  text?: unknown;
  refusal?: unknown;
}

interface ResponsesOutputItem {
  type?: unknown;
  content?: unknown;
}

interface ResponsesBody {
  status?: unknown;
  model?: unknown;
  output?: unknown;
  incomplete_details?: { reason?: unknown } | null;
}

/** Extracts the JSON text from a Responses API body, or throws a typed error. */
export function readResponsesOutput(body: unknown): OpenAiTextChatResult {
  if (typeof body !== "object" || body === null) {
    throw new OpenAiTextError("bad-response", "Response is not a JSON object.");
  }
  const data = body as ResponsesBody;
  if (data.status === "incomplete") {
    const reason = typeof data.incomplete_details?.reason === "string" ? data.incomplete_details.reason : "unknown";
    throw new OpenAiTextError("incomplete", `Response is incomplete (${reason}).`);
  }
  if (!Array.isArray(data.output)) {
    throw new OpenAiTextError("bad-response", "Response has no output array.");
  }
  const texts: string[] = [];
  for (const item of data.output as ResponsesOutputItem[]) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content as ResponsesContentItem[]) {
      if (content?.type === "refusal") {
        throw new OpenAiTextError("refusal", typeof content.refusal === "string" ? content.refusal : "The model refused.");
      }
      if (content?.type === "output_text" && typeof content.text === "string") texts.push(content.text);
    }
  }
  const text = texts.join("");
  if (!text.trim()) throw new OpenAiTextError("bad-response", "Response has no output text.");
  return { text, model: typeof data.model === "string" ? data.model : OPENAI_TEXT_MODEL };
}

export function buildResponsesPayload(args: OpenAiTextChatArgs): Record<string, unknown> {
  return {
    model: OPENAI_TEXT_MODEL,
    instructions: args.instructions,
    input: args.input,
    reasoning: { effort: args.reasoningEffort ?? "low" },
    max_output_tokens: args.maxOutputTokens ?? 8_000,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: args.jsonSchema.name,
        schema: args.jsonSchema.schema,
        strict: true,
      },
    },
  };
}

export function createOpenAiTextService(deps: OpenAiTextServiceDeps): OpenAiTextService {
  const baseUrl = (deps.baseUrl ?? "https://api.openai.com").replace(/\/+$/, "");
  const timeoutMs = deps.timeoutMs ?? OPENAI_TEXT_TIMEOUT_MS;

  async function requireKey(): Promise<string> {
    const key = (await deps.getKey(OPENAI_TEXT_KEY_ID))?.trim();
    if (!key) throw new OpenAiTextError("missing-key", "OpenAI key is not configured.");
    return key;
  }

  async function chat(args: OpenAiTextChatArgs): Promise<OpenAiTextChatResult> {
    const key = await requireKey();
    let response: Response;
    try {
      response = await deps.fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify(buildResponsesPayload(args)),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new OpenAiTextError(
        timedOut ? "timeout" : "http",
        timedOut ? `Request timed out after ${Math.round(timeoutMs / 1000)} s.` : "Network request failed.",
      );
    }
    const raw = await response.text();
    if (!response.ok) {
      const excerpt = redact(raw.slice(0, ERROR_EXCERPT_CHARS), key);
      throw new OpenAiTextError("http", `HTTP ${response.status}${excerpt ? `: ${excerpt}` : ""}`);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new OpenAiTextError("bad-response", "Response body is not valid JSON.");
    }
    return readResponsesOutput(body);
  }

  return {
    chat,
    keyStatus: async () => ({ configured: Boolean((await deps.getKey(OPENAI_TEXT_KEY_ID))?.trim()) }),
  };
}

export interface OpenAiTextChannels {
  readonly chat: string;
  readonly keyStatus: string;
}

/** Registers the handlers; channel names come from `CHANNELS` at the call site. */
export function registerOpenAiTextIpc(channels: OpenAiTextChannels): void {
  const service = createOpenAiTextService({
    getKey: (id) => getKeyStore().get(id),
    fetch: globalThis.fetch,
  });
  handle(channels.chat, openAiTextChatArgsSchema, (args) => service.chat(args));
  handle(channels.keyStatus, z.undefined(), () => service.keyStatus());
}
