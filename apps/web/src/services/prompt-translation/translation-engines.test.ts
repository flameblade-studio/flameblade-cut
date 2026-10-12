import { describe, expect, it, vi } from "vitest";
import { createLocalTranslator, type TranslationWorker, type WorkerReply } from "./local-engine";
import { createOpenAiTranslator, OPENAI_TRANSLATION_INSTRUCTIONS, type OpenAiTextBridge } from "./openai-engine";
import { createPromptTranslator } from "./translate-prompt";
import { PromptTranslationError, type TextTranslator } from "./types";

/** Worker fake: answers each request with `respond(texts)` on the next microtask. */
class FakeWorker implements TranslationWorker {
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly received: string[][] = [];
  terminated = false;

  constructor(private readonly respond: (texts: string[]) => string[] | Error) {}

  postMessage(message: { requestId: string; type: "translate"; texts: string[] }): void {
    this.received.push(message.texts);
    const answer = this.respond(message.texts);
    queueMicrotask(() => {
      this.onmessage?.({
        data: { requestId: message.requestId, type: "progress", file: "onnx/encoder_model_quantized.onnx", loaded: 5, total: 10 },
      } as MessageEvent<WorkerReply>);
      const data: WorkerReply =
        answer instanceof Error
          ? { requestId: message.requestId, type: "error", message: answer.message }
          : { requestId: message.requestId, type: "result", texts: answer };
      this.onmessage?.({ data } as MessageEvent<WorkerReply>);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

function localWith(respond: (texts: string[]) => string[] | Error) {
  const workers: FakeWorker[] = [];
  const timers: Array<() => void> = [];
  const translator = createLocalTranslator({
    createWorker: () => {
      const worker = new FakeWorker(respond);
      workers.push(worker);
      return worker;
    },
    // Stands in for OpenCC; the supplement has already turned 機車 into 摩托車.
    loadConverter: async () => (text: string) => text.replace("紅色摩托車", "红色摩托车"),
    idleMs: 1000,
    setTimer: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  return { translator, workers, timers };
}

describe("local engine", () => {
  it("sends normalised Chinese sentences to the worker and rebuilds a mixed prompt", async () => {
    const { translator, workers } = localWith((texts) => texts.map((t) => (t.includes("摩托车") ? "A red motorcycle." : "Rain falls.")));
    const progress = vi.fn();
    translator.onProgress(progress);
    await expect(translator.translate("cinematic, 紅色機車。下雨了, 35mm")).resolves.toBe("cinematic, A red motorcycle. Rain falls, 35mm");
    expect(workers[0]?.received).toEqual([["红色摩托车。", "下雨了"]]);
    expect(progress).toHaveBeenCalledWith({ file: "onnx/encoder_model_quantized.onnx", loaded: 5, total: 10 });
  });

  it("reports worker errors as PromptTranslationError and keeps one warm worker", async () => {
    const { translator, workers } = localWith(() => new Error("model download failed"));
    await expect(translator.translate("一隻貓")).rejects.toThrow(/Local translation failed: model download failed/);
    await expect(translator.translate("一隻狗")).rejects.toBeInstanceOf(PromptTranslationError);
    expect(workers).toHaveLength(1);
  });

  it("rejects an empty model output instead of sending an untranslated prompt", async () => {
    const { translator } = localWith((texts) => texts.map(() => " "));
    await expect(translator.translate("一隻貓")).rejects.toThrow(/empty/);
  });

  it("terminates the worker when idle and starts a new one on the next request", async () => {
    const { translator, workers, timers } = localWith((texts) => texts.map(() => "A cat."));
    await translator.translate("一隻貓");
    expect(timers).toHaveLength(1);
    timers[0]?.();
    expect(workers[0]?.terminated).toBe(true);
    await translator.translate("一隻狗");
    expect(workers).toHaveLength(2);
    translator.dispose();
    expect(workers[1]?.terminated).toBe(true);
  });
});

function fakeBridge(reply: string | Error): OpenAiTextBridge & { calls: Array<Parameters<OpenAiTextBridge["chat"]>[0]> } {
  const calls: Array<Parameters<OpenAiTextBridge["chat"]>[0]> = [];
  return {
    calls,
    async chat(args) {
      calls.push(args);
      if (reply instanceof Error) throw reply;
      return { text: reply, model: "gpt-test" };
    },
    async keyStatus() {
      return { configured: true };
    },
  };
}

describe("OpenAI engine", () => {
  it("sends the whole prompt with Taiwan-aware instructions and a JSON schema", async () => {
    const bridge = fakeBridge(JSON.stringify({ english: " A red scooter rides past. " }));
    const translator = createOpenAiTranslator(() => bridge);
    await expect(translator.translate("一輛紅色機車駛過")).resolves.toBe("A red scooter rides past.");
    expect(bridge.calls[0]?.input).toBe("一輛紅色機車駛過");
    expect(bridge.calls[0]?.jsonSchema.name).toBe("prompt_translation");
    for (const term of ["機車 = scooter", "捷運 = MRT", "騎樓 = arcade sidewalk", "夜市 = night market", "便利商店 = convenience store", "路邊攤 = street food stall", "add"]) {
      expect(OPENAI_TRANSLATION_INSTRUCTIONS).toContain(term);
    }
  });

  it("explains failures: no bridge, bridge error, malformed reply", async () => {
    await expect(createOpenAiTranslator(() => undefined).translate("貓")).rejects.toThrow(/desktop app/);
    await expect(createOpenAiTranslator(() => fakeBridge(new Error("401 invalid key"))).translate("貓")).rejects.toThrow(
      /OpenAI translation failed: 401 invalid key/,
    );
    await expect(createOpenAiTranslator(() => fakeBridge("not json")).translate("貓")).rejects.toThrow(/not JSON/);
    await expect(createOpenAiTranslator(() => fakeBridge('{"english":""}')).translate("貓")).rejects.toThrow(/empty/);
  });
});

describe("translatePrompt facade", () => {
  function engines() {
    const local: TextTranslator & { calls: number } = {
      calls: 0,
      async translate(text) {
        this.calls += 1;
        return `local:${text}`;
      },
    };
    const openai: TextTranslator = { translate: async (text) => `openai:${text}` };
    return { local, openai };
  }

  it("passes text without Chinese through unchanged and untranslated", async () => {
    const e = engines();
    const translator = createPromptTranslator(e);
    await expect(translator.translatePrompt("  A cat  ", { engine: "local" })).resolves.toEqual({ english: "A cat", original: "A cat", engine: null });
    expect(e.local.calls).toBe(0);
  });

  it("routes to the chosen engine and caches per engine and text", async () => {
    const e = engines();
    const translator = createPromptTranslator(e);
    const first = await translator.translatePrompt("一隻貓", { engine: "local" });
    const second = await translator.translatePrompt("一隻貓", { engine: "local" });
    expect(first).toEqual({ english: "local:一隻貓", original: "一隻貓", engine: "local" });
    expect(second).toEqual(first);
    expect(e.local.calls).toBe(1);
    await expect(translator.translatePrompt("一隻貓", { engine: "openai" })).resolves.toMatchObject({ english: "openai:一隻貓", engine: "openai" });
  });

  it("wraps unexpected engine errors and never caches failures", async () => {
    let fail = true;
    const translator = createPromptTranslator({
      local: {
        translate: async () => {
          if (fail) throw new Error("boom");
          return "A cat.";
        },
      },
      openai: { translate: async () => "" },
    });
    await expect(translator.translatePrompt("一隻貓", { engine: "local" })).rejects.toMatchObject({ name: "PromptTranslationError", engine: "local", message: "boom" });
    fail = false;
    await expect(translator.translatePrompt("一隻貓", { engine: "local" })).resolves.toMatchObject({ english: "A cat." });
    await expect(translator.translatePrompt("一隻貓", { engine: "openai" })).rejects.toThrow(/empty/);
  });
});
