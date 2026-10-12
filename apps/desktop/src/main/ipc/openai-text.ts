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
 * Vision input, verified 2026-10-13:
 * - https://developers.openai.com/api/docs/guides/images-vision
 *   (Responses API: `input` is an array holding one `{ role: "user", content }`
 *   message; content items are `{ type: "input_text", text }` and
 *   `{ type: "input_image", image_url: "data:image/<type>;base64,...",
 *   detail }`; `detail` is optional, defaults to "auto" and accepts low |
 *   high | auto, plus "original" on some models only, so it is not exposed
 *   here; PNG, JPEG, WEBP and non-animated GIF are accepted, up to 1,500
 *   images and 512 MB per request — our 12-image / 24 MB caps are far
 *   stricter on purpose).
 * - https://developers.openai.com/api/docs/models/gpt-6.1-sol
 *   ("Input modalities: text, image").
 *
 * Image data is user content: it is never logged, never echoed in a zod
 * validation message (all image issues use fixed custom messages) and
 * stripped from HTTP error excerpts together with the key.
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

export const OPENAI_TEXT_MAX_IMAGES = 12;
/** Per-image cap, counted in base64 characters after the data-URL comma. */
export const OPENAI_TEXT_MAX_IMAGE_BASE64_CHARS = 8 * 1024 * 1024;
/** Cap for all images of one request together, in base64 characters. */
export const OPENAI_TEXT_MAX_TOTAL_IMAGE_BASE64_CHARS = 24 * 1024 * 1024;
const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const OPENAI_TEXT_IMAGE_DETAILS = ["low", "high", "auto"] as const;
export type OpenAiTextImageDetail = (typeof OPENAI_TEXT_IMAGE_DETAILS)[number];

/** Base64 characters of a data URL (everything after the first comma). */
function base64Length(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  return comma < 0 ? dataUrl.length : dataUrl.length - comma - 1;
}

function isImageDetail(value: unknown): value is OpenAiTextImageDetail {
  return typeof value === "string" && (OPENAI_TEXT_IMAGE_DETAILS as readonly string[]).includes(value);
}

// Custom issues only: built-in string/enum issues can carry the received
// value, which would copy image data into the IPC error message.
const imageInputSchema = z
  .object({
    dataUrl: z.string().superRefine((value, ctx) => {
      if (base64Length(value) > OPENAI_TEXT_MAX_IMAGE_BASE64_CHARS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Image exceeds 8 MB of base64 data." });
        return;
      }
      if (!IMAGE_DATA_URL_PATTERN.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Image must be a base64 data URL of type image/png, image/jpeg or image/webp.",
        });
      }
    }),
    detail: z
      .custom<OpenAiTextImageDetail>(isImageDetail, { message: 'Image detail must be "low", "high" or "auto".' })
      .optional(),
  })
  .strict();
export type OpenAiTextImageInput = z.infer<typeof imageInputSchema>;

const imagesSchema = z
  .array(imageInputSchema)
  .max(OPENAI_TEXT_MAX_IMAGES, { message: `At most ${OPENAI_TEXT_MAX_IMAGES} images per request.` })
  .superRefine((images, ctx) => {
    const total = images.reduce((sum, image) => sum + base64Length(image.dataUrl), 0);
    if (total > OPENAI_TEXT_MAX_TOTAL_IMAGE_BASE64_CHARS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Images exceed 24 MB of base64 data in total." });
    }
  });

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
    /** Optional vision input; an empty array behaves like no images. */
    images: imagesSchema.optional(),
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

/** Image data URLs echoed by the API (any image type, JSON-escaped slashes included). */
const ECHOED_IMAGE_DATA_PATTERN = /data:image\\?\/[^;,\s"]*;base64,[A-Za-z0-9+/=\\]*/g;
/** Bare base64 runs, e.g. an image fragment the API quoted without its prefix. */
const LONG_BASE64_RUN_PATTERN = /[A-Za-z0-9+/=\\]{100,}/g;

/**
 * Error excerpt safe for messages: the key and image data are removed from the
 * whole body before truncation, so a cut can never leave a partial secret.
 */
export function redactErrorExcerpt(raw: string, secret: string): string {
  return redact(raw, secret)
    .replace(ECHOED_IMAGE_DATA_PATTERN, "data:image/[redacted]")
    .replace(LONG_BASE64_RUN_PATTERN, "[redacted]")
    .slice(0, ERROR_EXCERPT_CHARS);
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

/**
 * Responses API `input`: the plain string without images (unchanged legacy
 * shape), otherwise one user message with the text followed by the images.
 */
function buildResponsesInput(args: OpenAiTextChatArgs): string | Record<string, unknown>[] {
  const images = args.images ?? [];
  if (images.length === 0) return args.input;
  return [
    {
      role: "user",
      content: [
        { type: "input_text", text: args.input },
        ...images.map((image) => ({ type: "input_image", image_url: image.dataUrl, detail: image.detail ?? "auto" })),
      ],
    },
  ];
}

export function buildResponsesPayload(args: OpenAiTextChatArgs): Record<string, unknown> {
  return {
    model: OPENAI_TEXT_MODEL,
    instructions: args.instructions,
    input: buildResponsesInput(args),
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
      const excerpt = redactErrorExcerpt(raw, key);
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
