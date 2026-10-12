/**
 * In-memory `ComfyTransport` for unit tests. It simulates the parts of
 * ComfyUI the runner uses: /system_stats, /object_info/UNETLoader, /prompt,
 * /queue, /interrupt, /history, uploads, downloads, the websocket and the
 * library files.
 * Test-only; never imported by production code.
 */
import { LTX_TRANSFORMER_FILES } from "./model-choice";
import type { ComfyFileRef, ComfyHttpResponse, ComfyLaunchConfig, ComfyTransport } from "./types";

export interface RecordedRequest {
  method: "GET" | "POST";
  path: string;
  body: unknown;
}

export class FakeComfyTransport implements ComfyTransport {
  online = true;
  /** When set, `/system_stats` starts answering after this many failed pings following `launch`. */
  pingsUntilOnlineAfterLaunch: number | null = null;
  readonly requests: RecordedRequest[] = [];
  readonly uploads: Array<{ filename: string; bytes: Uint8Array }> = [];
  readonly downloads: Array<{ file: ComfyFileRef; destPath: string }> = [];
  readonly launches: ComfyLaunchConfig[] = [];
  readonly files = new Map<string, string>();
  readonly binaryFiles = new Map<string, Uint8Array<ArrayBuffer>>();
  /** Prompt ids in ComfyUI's queue. */
  running: string[] = [];
  pending: string[] = [];
  /** `/history/<id>` bodies by prompt id; missing → `{}` (pending). */
  readonly history = new Map<string, unknown>();
  /** Override the next `/prompt` response. */
  nextPromptResponse: ComfyHttpResponse | null = null;
  historyFailures = 0;
  /** Diffusion model files ComfyUI reports as loadable. */
  unetNames: string[] = [LTX_TRANSFORMER_FILES.nvfp4];
  /** GPU name in `/system_stats`; null reports no devices. */
  gpuName: string | null = "cuda:0 NVIDIA GeForce RTX 5060 Ti : cudaMallocAsync";
  subscribeCount = 0;
  private listener: ((text: string | null) => void) | null = null;
  private promptCounter = 0;
  private launched = false;

  async request(_baseUrl: string, method: "GET" | "POST", path: string, jsonBody?: unknown): Promise<ComfyHttpResponse> {
    this.requests.push({ method, path, body: jsonBody });
    if (path === "/system_stats") return this.systemStats();
    if (!this.online) throw new Error("connect ECONNREFUSED 127.0.0.1:8188");
    if (method === "POST" && path === "/prompt") return this.queuePrompt();
    if (method === "GET" && path === "/object_info/UNETLoader") {
      return json({ UNETLoader: { input: { required: { unet_name: [this.unetNames, {}] } } } });
    }
    if (method === "GET" && path === "/queue") {
      return json({
        queue_running: this.running.map((id, i) => [i, id, {}, {}, []]),
        queue_pending: this.pending.map((id, i) => [i + 1, id, {}, {}, []]),
      });
    }
    if (method === "POST" && path === "/interrupt") return json({});
    if (method === "POST" && path === "/queue") {
      const ids = (jsonBody as { delete: string[] }).delete;
      this.pending = this.pending.filter((id) => !ids.includes(id));
      return json({});
    }
    if (method === "GET" && path.startsWith("/history/")) {
      if (this.historyFailures > 0) {
        this.historyFailures -= 1;
        throw new Error("socket hang up");
      }
      const id = path.slice("/history/".length);
      return json(this.history.has(id) ? { [id]: this.history.get(id) } : {});
    }
    return { status: 404, body: "Not Found" };
  }

  async uploadImage(_baseUrl: string, bytes: Uint8Array, filename: string): Promise<ComfyFileRef> {
    this.uploads.push({ filename, bytes });
    return { filename, subfolder: "flameblade-cut", type: "input" };
  }

  async download(_baseUrl: string, file: ComfyFileRef, destPath: string): Promise<void> {
    this.downloads.push({ file, destPath });
  }

  async subscribe(_baseUrl: string, _clientId: string, onMessage: (text: string | null) => void) {
    this.subscribeCount += 1;
    this.listener = onMessage;
    return async () => {
      this.listener = null;
    };
  }

  async launch(config: ComfyLaunchConfig): Promise<void> {
    this.launches.push(config);
    this.launched = true;
  }

  async stopLaunched(): Promise<void> {}

  async libraryDir(): Promise<string> {
    return "C:\\Users\\owner\\Videos\\Flameblade Cut";
  }

  async readFileBytes(path: string): Promise<Uint8Array<ArrayBuffer>> {
    const bytes = this.binaryFiles.get(path);
    if (bytes === undefined) throw new Error(`ENOENT: ${path}`);
    return bytes;
  }

  async writeTextFile(path: string, contents: string): Promise<void> {
    this.files.set(path, contents);
  }

  async readTextFile(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  // ---- test controls ----------------------------------------------------

  emit(message: unknown): void {
    this.listener?.(JSON.stringify(message));
  }

  closeSocket(): void {
    const listener = this.listener;
    this.listener = null;
    listener?.(null);
  }

  /** Moves a queued prompt to "running" in ComfyUI's queue. */
  startPrompt(promptId: string): void {
    this.pending = this.pending.filter((id) => id !== promptId);
    this.running.push(promptId);
  }

  /** Finishes a prompt successfully with the real SaveVideo history shape. */
  finishPrompt(promptId: string, filename = `${promptId}_00001_.mp4`): void {
    this.running = this.running.filter((id) => id !== promptId);
    this.history.set(promptId, successHistoryEntry(promptId, filename));
  }

  requestsTo(method: "GET" | "POST", path: string): RecordedRequest[] {
    return this.requests.filter((r) => r.method === method && r.path === path);
  }

  private systemStats(): ComfyHttpResponse {
    if (!this.online && this.launched && this.pingsUntilOnlineAfterLaunch !== null) {
      if (this.pingsUntilOnlineAfterLaunch <= 0) {
        this.online = true;
      } else {
        this.pingsUntilOnlineAfterLaunch -= 1;
      }
    }
    if (!this.online) throw new Error("connect ECONNREFUSED 127.0.0.1:8188");
    return json({ system: { comfyui_version: "0.38.0" }, devices: this.gpuName === null ? [] : [{ name: this.gpuName }] });
  }

  private queuePrompt(): ComfyHttpResponse {
    if (this.nextPromptResponse !== null) {
      const response = this.nextPromptResponse;
      this.nextPromptResponse = null;
      return response;
    }
    this.promptCounter += 1;
    const promptId = `prompt-${this.promptCounter}`;
    this.pending.push(promptId);
    return json({ prompt_id: promptId, number: this.promptCounter - 1, node_errors: {} });
  }
}

function json(body: unknown): ComfyHttpResponse {
  return { status: 200, body: JSON.stringify(body) };
}

/** `/history/<id>` entry as returned by ComfyUI 0.38 for the LTX t2v workflow (captured 2026-10-12). */
export function successHistoryEntry(promptId: string, filename: string): unknown {
  return {
    prompt: [0, promptId, {}, {}, ["75"]],
    outputs: {
      "75": {
        images: [{ filename, subfolder: "flameblade-cut", type: "output" }],
        animated: [true],
      },
      "405:381": { text: ["A red paper lantern swaying gently in the evening breeze, soft bokeh lights"] },
    },
    status: {
      status_str: "success",
      completed: true,
      messages: [
        ["execution_start", { prompt_id: promptId, timestamp: 1791789015638 }],
        ["execution_cached", { nodes: [], prompt_id: promptId, timestamp: 1791789015662 }],
        ["execution_success", { prompt_id: promptId, timestamp: 1791789079492 }],
      ],
    },
    meta: { "75": { node_id: "75", display_node: "75", parent_node: null, real_node_id: "75" } },
  };
}
