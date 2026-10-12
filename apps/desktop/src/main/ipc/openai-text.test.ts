import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  OPENAI_TEXT_KEY_ID,
  OPENAI_TEXT_MAX_IMAGE_BASE64_CHARS,
  OPENAI_TEXT_MAX_IMAGES,
  OPENAI_TEXT_MODEL,
  OpenAiTextError,
  buildResponsesPayload,
  createOpenAiTextService,
  openAiTextChatArgsSchema,
  readResponsesOutput,
  redactErrorExcerpt,
  type OpenAiTextChatArgs,
  type OpenAiTextServiceDeps,
} from "./openai-text";

const SECRET = "sk-test-SECRET-0123456789";

interface Recorded {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server;
let baseUrl = "";
let recorded: Recorded[] = [];
let responder: (req: Recorded, res: http.ServerResponse) => void = () => undefined;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const entry = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      recorded.push(entry);
      responder(entry, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  recorded = [];
});

function makeService(overrides: Partial<OpenAiTextServiceDeps> = {}) {
  const keys: Record<string, string> = { [OPENAI_TEXT_KEY_ID]: SECRET };
  return createOpenAiTextService({
    getKey: async (id) => keys[id] ?? null,
    fetch: globalThis.fetch,
    baseUrl,
    ...overrides,
  });
}

const ARGS: OpenAiTextChatArgs = {
  instructions: "Pick highlights.",
  input: "[00:01.0-00:05.0] 這是重點",
  jsonSchema: { name: "highlights", schema: { type: "object", properties: {}, additionalProperties: false } },
};

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function messageBody(text: string): unknown {
  return {
    status: "completed",
    model: "gpt-6.1-sol-2026-09-01",
    output: [
      { type: "reasoning", summary: [] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
    ],
  };
}

describe("openAiTextChatArgsSchema", () => {
  it("accepts a well-formed request and rejects unknown fields, bad names and blank input", () => {
    expect(openAiTextChatArgsSchema.safeParse(ARGS).success).toBe(true);
    expect(openAiTextChatArgsSchema.safeParse({ ...ARGS, apiKey: "x" }).success).toBe(false);
    expect(openAiTextChatArgsSchema.safeParse({ ...ARGS, input: "   " }).success).toBe(false);
    expect(openAiTextChatArgsSchema.safeParse({ ...ARGS, jsonSchema: { name: "bad name", schema: {} } }).success).toBe(false);
    expect(openAiTextChatArgsSchema.safeParse({ ...ARGS, maxOutputTokens: 10 }).success).toBe(false);
  });
});

// 1x1 PNG; the marker base64 below is long enough to be recognisable in leaks.
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_URL = `data:image/png;base64,${PNG_BASE64}`;
const LEAK_MARKER = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo";

/** A syntactically valid data URL whose base64 part has exactly `chars` characters. */
function dataUrlOfSize(chars: number, mime = "image/jpeg"): string {
  return `data:${mime};base64,${LEAK_MARKER}${"A".repeat(chars - LEAK_MARKER.length)}`;
}

function issueText(value: unknown): string {
  const parsed = openAiTextChatArgsSchema.safeParse(value);
  expect(parsed.success).toBe(false);
  return parsed.success ? "" : parsed.error.message;
}

describe("openAiTextChatArgsSchema images", () => {
  it("accepts png/jpeg/webp data URLs with optional detail, and an empty list", () => {
    const images = [
      { dataUrl: PNG_URL },
      { dataUrl: `data:image/jpeg;base64,${PNG_BASE64}`, detail: "low" },
      { dataUrl: `data:image/webp;base64,${PNG_BASE64}`, detail: "high" },
      { dataUrl: PNG_URL, detail: "auto" },
    ];
    expect(openAiTextChatArgsSchema.safeParse({ ...ARGS, images }).success).toBe(true);
    expect(openAiTextChatArgsSchema.safeParse({ ...ARGS, images: [] }).success).toBe(true);
  });

  it("caps the image count at 12", () => {
    const at = Array.from({ length: OPENAI_TEXT_MAX_IMAGES }, () => ({ dataUrl: PNG_URL }));
    expect(OPENAI_TEXT_MAX_IMAGES).toBe(12);
    expect(openAiTextChatArgsSchema.safeParse({ ...ARGS, images: at }).success).toBe(true);
    const message = issueText({ ...ARGS, images: [...at, { dataUrl: PNG_URL }] });
    expect(message).toContain("At most 12 images");
    expect(message).not.toContain(PNG_BASE64);
  });

  it("rejects other mime types, non-base64 data, remote URLs, unknown fields and bad detail without echoing data", () => {
    const bad = [
      { dataUrl: `data:image/gif;base64,${PNG_BASE64}` },
      { dataUrl: `data:image/svg+xml;base64,${PNG_BASE64}` },
      { dataUrl: `data:text/plain;base64,${PNG_BASE64}` },
      { dataUrl: `data:image/png,${PNG_BASE64}` },
      { dataUrl: `data:image/png;base64,${PNG_BASE64}!` },
      { dataUrl: `data:image/png;base64,` },
      { dataUrl: "https://example.com/a.png" },
      { dataUrl: PNG_URL, detail: "original" },
      { dataUrl: PNG_URL, detail: PNG_BASE64 },
      { dataUrl: PNG_URL, url: "x" },
    ];
    for (const image of bad) {
      const message = issueText({ ...ARGS, images: [image] });
      expect(message).not.toContain(PNG_BASE64);
    }
    expect(issueText({ ...ARGS, images: [{ dataUrl: `data:image/gif;base64,${PNG_BASE64}` }] })).toContain(
      "image/png, image/jpeg or image/webp",
    );
    expect(issueText({ ...ARGS, images: [{ dataUrl: PNG_URL, detail: PNG_BASE64 }] })).toContain("Image detail must be");
    expect(issueText({ ...ARGS, images: PNG_URL })).not.toContain(PNG_BASE64);
  });

  it("caps each image at 8 MB and all images at 24 MB of base64, without echoing data", () => {
    const max = OPENAI_TEXT_MAX_IMAGE_BASE64_CHARS;
    expect(max).toBe(8 * 1024 * 1024);
    expect(openAiTextChatArgsSchema.safeParse({ ...ARGS, images: [{ dataUrl: dataUrlOfSize(max) }] }).success).toBe(true);

    const tooBig = issueText({ ...ARGS, images: [{ dataUrl: dataUrlOfSize(max + 1) }] });
    expect(tooBig).toContain("exceeds 8 MB");
    expect(tooBig).not.toContain(LEAK_MARKER);

    const exactlyTotal = [max, max, max].map((size) => ({ dataUrl: dataUrlOfSize(size) }));
    expect(openAiTextChatArgsSchema.safeParse({ ...ARGS, images: exactlyTotal }).success).toBe(true);
    const overTotal = issueText({ ...ARGS, images: [...exactlyTotal, { dataUrl: PNG_URL }] });
    expect(overTotal).toContain("exceed 24 MB");
    expect(overTotal).not.toContain(LEAK_MARKER);
  });
});

describe("buildResponsesPayload", () => {
  it("uses the pinned model, strict json_schema format, low effort and no storage by default", () => {
    const payload = buildResponsesPayload(ARGS);
    expect(payload).toMatchObject({
      model: OPENAI_TEXT_MODEL,
      instructions: ARGS.instructions,
      input: ARGS.input,
      reasoning: { effort: "low" },
      store: false,
      text: { format: { type: "json_schema", name: "highlights", strict: true, schema: ARGS.jsonSchema.schema } },
    });
  });

  it("keeps the plain string input when there are no images", () => {
    expect(buildResponsesPayload(ARGS).input).toBe(ARGS.input);
    expect(buildResponsesPayload({ ...ARGS, images: [] }).input).toBe(ARGS.input);
  });

  it("sends one user message with input_text then input_image items (detail defaults to auto)", () => {
    const webp = `data:image/webp;base64,${PNG_BASE64}`;
    const payload = buildResponsesPayload({ ...ARGS, images: [{ dataUrl: PNG_URL }, { dataUrl: webp, detail: "high" }] });
    expect(payload.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: ARGS.input },
          { type: "input_image", image_url: PNG_URL, detail: "auto" },
          { type: "input_image", image_url: webp, detail: "high" },
        ],
      },
    ]);
    expect(payload).toMatchObject({ instructions: ARGS.instructions, text: { format: { type: "json_schema", strict: true } } });
  });
});

describe("redactErrorExcerpt", () => {
  it("removes the key and image data before truncating", () => {
    const echoed = `{"error":{"message":"Invalid image '${PNG_URL}' for key ${SECRET}"}}`;
    const out = redactErrorExcerpt(echoed, SECRET);
    expect(out).not.toContain(PNG_BASE64);
    expect(out).not.toContain(SECRET);
    expect(out).toContain("data:image/[redacted]");

    const escaped = redactErrorExcerpt(`"image_url":"data:image\\/png;base64,${PNG_BASE64}"`, SECRET);
    expect(escaped).not.toContain(PNG_BASE64.slice(0, 40));

    const bare = redactErrorExcerpt(`fragment ${"QUJD".repeat(60)} end`, SECRET);
    expect(bare).toBe("fragment [redacted] end");

    // A key straddling the 300-char cut must not leave a prefix behind.
    const straddle = redactErrorExcerpt(`${"x ".repeat(148)}${SECRET}`, SECRET);
    expect(straddle).not.toContain("sk-");
  });
});

describe("readResponsesOutput", () => {
  it("joins output_text items of message outputs", () => {
    expect(readResponsesOutput(messageBody('{"clips":[]}'))).toEqual({ text: '{"clips":[]}', model: "gpt-6.1-sol-2026-09-01" });
  });

  it("raises typed errors for refusal, incomplete, missing output and non-objects", () => {
    const refusal = { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] };
    expect(() => readResponsesOutput(refusal)).toThrow(/openai-text:refusal: no/);
    expect(() => readResponsesOutput({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })).toThrow(
      /openai-text:incomplete.*max_output_tokens/,
    );
    expect(() => readResponsesOutput({ status: "completed", output: [] })).toThrow(/bad-response/);
    expect(() => readResponsesOutput("nope")).toThrow(/bad-response/);
  });
});

describe("createOpenAiTextService (fake HTTP server)", () => {
  it("posts to /v1/responses with the bearer key and returns the JSON text", async () => {
    responder = (_req, res) => json(res, 200, messageBody('{"clips":[{"start":1}]}'));
    const result = await makeService().chat(ARGS);
    expect(result.text).toBe('{"clips":[{"start":1}]}');
    expect(recorded).toHaveLength(1);
    expect(recorded[0].method).toBe("POST");
    expect(recorded[0].url).toBe("/v1/responses");
    expect(recorded[0].headers.authorization).toBe(`Bearer ${SECRET}`);
    const sent = JSON.parse(recorded[0].body) as Record<string, unknown>;
    expect(sent.model).toBe(OPENAI_TEXT_MODEL);
    expect(JSON.stringify(sent)).not.toContain(SECRET);
  });

  it("fails with missing-key without any network call", async () => {
    const service = makeService({ getKey: async () => "  " });
    await expect(service.chat(ARGS)).rejects.toThrow(/openai-text:missing-key/);
    expect(recorded).toHaveLength(0);
    await expect(service.keyStatus()).resolves.toEqual({ configured: false });
    await expect(makeService().keyStatus()).resolves.toEqual({ configured: true });
  });

  it("redacts the key from HTTP error excerpts", async () => {
    responder = (_req, res) => json(res, 401, { error: { message: `Incorrect API key provided: ${SECRET}` } });
    const failure = await makeService()
      .chat(ARGS)
      .then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(OpenAiTextError);
    expect((failure as OpenAiTextError).code).toBe("http");
    expect((failure as Error).message).toContain("HTTP 401");
    expect((failure as Error).message).not.toContain(SECRET);
  });

  it("sends images in the request body but never echoes them in HTTP errors", async () => {
    responder = (_req, res) => json(res, 400, { error: { message: `Invalid image_url: ${PNG_URL}` } });
    const failure = await makeService()
      .chat({ ...ARGS, images: [{ dataUrl: PNG_URL }] })
      .then(() => null, (error: unknown) => error);
    expect((failure as OpenAiTextError).code).toBe("http");
    expect((failure as Error).message).toContain("HTTP 400");
    expect((failure as Error).message).not.toContain(PNG_BASE64);
    const sent = JSON.parse(recorded[0].body) as { input: { content: { type: string; image_url?: string }[] }[] };
    expect(sent.input[0].content[1]).toEqual({ type: "input_image", image_url: PNG_URL, detail: "auto" });
  });

  it("rejects a non-JSON body", async () => {
    responder = (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("<html>gateway</html>");
    };
    await expect(makeService().chat(ARGS)).rejects.toThrow(/openai-text:bad-response/);
  });

  it("times out with a typed error", async () => {
    responder = () => undefined; // never answers
    await expect(makeService({ timeoutMs: 150 }).chat(ARGS)).rejects.toThrow(/openai-text:timeout/);
  });
});
