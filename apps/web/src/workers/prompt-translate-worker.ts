/// <reference lib="webworker" />
/**
 * Local zh→en prompt translation (transformers.js, CPU/WASM only so it never
 * holds GPU memory while LTX-2.5 runs). One model is kept warm; the client
 * terminates this worker when idle to release its memory.
 *
 * Protocol: in `{ requestId, type: "translate", texts }` (already normalised
 * mainland Chinese sentences); out `progress` / `result { texts }` / `error`.
 */
import { env, pipeline } from "@huggingface/transformers";
import { LOCAL_TRANSLATION_MODEL } from "../services/prompt-translation/local-model";

// Official Hugging Face hub, browser cache (same pattern as whisper-worker.ts).
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.remoteHost = "https://huggingface.co/";
env.remotePathTemplate = "{model}/resolve/{revision}/";
env.useBrowserCache = true;

type Translator = (text: string, options: Record<string, unknown>) => Promise<Array<{ translation_text: string }>>;
const createPipeline = pipeline as unknown as (
  task: string,
  model: string,
  options: Record<string, unknown>,
) => Promise<Translator>;

let translatorPromise: Promise<Translator> | null = null;

function post(requestId: string, payload: Record<string, unknown>): void {
  self.postMessage({ requestId, ...payload });
}

function loadTranslator(requestId: string): Promise<Translator> {
  if (!translatorPromise) {
    translatorPromise = createPipeline("translation", LOCAL_TRANSLATION_MODEL.id, {
      device: "wasm",
      dtype: LOCAL_TRANSLATION_MODEL.dtype,
      progress_callback: (event: Record<string, unknown>) => {
        if (event.status !== "progress") return;
        post(requestId, { type: "progress", file: event.file, loaded: event.loaded, total: event.total });
      },
    });
    translatorPromise.catch(() => {
      translatorPromise = null;
    });
  }
  return translatorPromise;
}

self.onmessage = async (event: MessageEvent<{ requestId: string; type: "translate"; texts: string[] }>) => {
  const { requestId, texts } = event.data;
  try {
    const translator = await loadTranslator(requestId);
    const results: string[] = [];
    for (const text of texts) {
      const [output] = await translator(text, { max_new_tokens: 512 });
      results.push(output?.translation_text ?? "");
    }
    post(requestId, { type: "result", texts: results });
  } catch (error) {
    post(requestId, { type: "error", message: error instanceof Error ? error.message : "Local translation failed." });
  }
};

export {};
