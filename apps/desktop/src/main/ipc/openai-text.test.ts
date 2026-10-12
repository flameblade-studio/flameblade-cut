import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  OPENAI_TEXT_KEY_ID,
  OPENAI_TEXT_MODEL,
  OpenAiTextError,
  buildResponsesPayload,
  createOpenAiTextService,
  openAiTextChatArgsSchema,
  readResponsesOutput,
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
