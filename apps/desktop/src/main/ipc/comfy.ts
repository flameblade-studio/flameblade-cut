/**
 * Main-process bridge to a LOCAL ComfyUI server.
 *
 * The renderer cannot call ComfyUI itself: ComfyUI's `origin_only_middleware`
 * answers 403 to browser requests (`Sec-Fetch-Site: cross-site`, or Host and
 * Origin differ). Every request is therefore made here with `node:http` / `ws`,
 * which send no Origin header. Only loopback base URLs are accepted.
 *
 * Composition: the pure functions and `ComfyProcess` take their dependencies
 * explicitly (testable without Electron); `registerComfyIpc()` wires them to
 * IPC with Electron paths, and `stopLaunchedComfy()` is called at app quit.
 */
import { app, ipcMain, type WebContents } from "electron";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, openSync, closeSync, writeSync, promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import WebSocket from "ws";
import { z } from "zod";
import { handle } from "./index";
import {
  CHANNELS,
  comfyDownloadArgsSchema,
  comfyLaunchConfigSchema,
  comfyPathArgsSchema,
  comfyRequestArgsSchema,
  comfySubscribeArgsSchema,
  comfyUnsubscribeArgsSchema,
  comfyUploadImageArgsSchema,
  comfyWriteTextFileArgsSchema,
} from "../../shared/ipc-contract";
import type { ComfyFileRef, ComfyLaunchConfig, ComfyWsEvent } from "../../shared/ipc-contract";

export interface ComfyHttpResponse {
  status: number;
  body: string;
}

export const COMFY_UPLOAD_SUBFOLDER = "flameblade-cut";
const HTTP_IDLE_TIMEOUT_MS = 30_000;
const PRE_LAUNCH_TIMEOUT_MS = 60_000;
const STOP_WAIT_MS = 5_000;
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

/** Parses `baseUrl` and refuses anything that is not plain HTTP on loopback. */
export function parseLocalBaseUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:") {
    throw new Error(`ComfyUI base URL must use http:, got ${url.protocol}`);
  }
  if (!LOOPBACK_HOSTNAMES.has(url.hostname)) {
    throw new Error(
      `Only a local ComfyUI is supported (127.0.0.1, localhost or ::1); refused host "${url.hostname}"`,
    );
  }
  return url;
}

/** Resolves `requestPath` against the base and refuses anything that leaves its origin. */
function resolveLocalUrl(baseUrl: string, requestPath: string): URL {
  const base = parseLocalBaseUrl(baseUrl);
  if (!requestPath.startsWith("/") || requestPath.startsWith("//")) {
    throw new Error(`ComfyUI request path must start with a single "/": ${requestPath}`);
  }
  const url = new URL(requestPath, base);
  if (url.origin !== base.origin) {
    throw new Error(`ComfyUI request path escapes ${base.origin}: ${requestPath}`);
  }
  return url;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function sendHttp(
  url: URL,
  method: "GET" | "POST",
  headers: Record<string, string>,
  body: Buffer | null,
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, resolve);
    req.setTimeout(HTTP_IDLE_TIMEOUT_MS, () => {
      req.destroy(new Error(`ComfyUI ${method} ${url.pathname} timed out after ${HTTP_IDLE_TIMEOUT_MS} ms`));
    });
    req.on("error", reject);
    req.end(body ?? undefined);
  });
}

async function readBody(res: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of res) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function comfyRequest(
  baseUrl: string,
  method: "GET" | "POST",
  requestPath: string,
  jsonBody?: unknown,
): Promise<ComfyHttpResponse> {
  const url = resolveLocalUrl(baseUrl, requestPath);
  const body = jsonBody === undefined ? null : Buffer.from(JSON.stringify(jsonBody), "utf8");
  const headers: Record<string, string> = body
    ? { "content-type": "application/json", "content-length": String(body.byteLength) }
    : {};
  const res = await sendHttp(url, method, headers, body);
  return { status: res.statusCode ?? 0, body: await readBody(res) };
}

/** Keeps only a plain file name and escapes it for a multipart header. */
function multipartFileName(filename: string): string {
  const base = path.basename(filename.replace(/\\/g, "/"));
  if (!base || base === "." || base === "..") {
    throw new Error(`invalid upload filename: ${filename}`);
  }
  return base.replace(/["\r\n]/g, "_");
}

export function buildMultipartBody(
  boundary: string,
  fields: Record<string, string>,
  file: { field: string; filename: string; bytes: Uint8Array },
): Buffer {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, "utf8"),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${multipartFileName(file.filename)}"\r\n` +
        "Content-Type: application/octet-stream\r\n\r\n",
      "utf8",
    ),
    Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength),
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  );
  return Buffer.concat(parts);
}

export async function comfyUploadImage(
  baseUrl: string,
  bytes: Uint8Array,
  filename: string,
): Promise<ComfyFileRef> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`upload of ${bytes.byteLength} bytes exceeds the ${MAX_UPLOAD_BYTES} byte limit`);
  }
  const url = resolveLocalUrl(baseUrl, "/upload/image");
  const boundary = `----flameblade-${randomUUID()}`;
  const body = buildMultipartBody(
    boundary,
    { subfolder: COMFY_UPLOAD_SUBFOLDER, type: "input", overwrite: "true" },
    { field: "image", filename, bytes },
  );
  const res = await sendHttp(
    url,
    "POST",
    { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(body.byteLength) },
    body,
  );
  const text = await readBody(res);
  if (res.statusCode !== 200) {
    throw new Error(`ComfyUI /upload/image returned ${res.statusCode}: ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(text) as { name?: unknown; subfolder?: unknown; type?: unknown };
  if (typeof parsed.name !== "string" || typeof parsed.type !== "string") {
    throw new Error(`ComfyUI /upload/image returned an unexpected body: ${text.slice(0, 300)}`);
  }
  return {
    filename: parsed.name,
    subfolder: typeof parsed.subfolder === "string" ? parsed.subfolder : "",
    type: parsed.type,
  };
}

/** Streams `/view` into `destPath + ".part"`, then renames it; the `.part` is removed on failure. */
export async function comfyDownload(baseUrl: string, file: ComfyFileRef, destPath: string): Promise<void> {
  const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
  const url = resolveLocalUrl(baseUrl, `/view?${query.toString()}`);
  const partPath = `${destPath}.part`;
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  try {
    const res = await sendHttp(url, "GET", {}, null);
    if (res.statusCode !== 200) {
      const text = await readBody(res);
      throw new Error(`ComfyUI /view returned ${res.statusCode} for ${file.filename}: ${text.slice(0, 300)}`);
    }
    await pipeline(res, createWriteStream(partPath));
    await fs.rename(partPath, destPath);
  } catch (error) {
    await fs.rm(partPath, { force: true });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

/**
 * Opens `/ws?clientId=` and resolves once connected (rejects if it cannot
 * connect). Text frames go to `onMessage`; binary frames (latent previews) are
 * ignored. `null` is delivered once when the server side closes or errors. An
 * explicit `close()` by the caller does not deliver `null`.
 */
export async function openComfySocket(
  baseUrl: string,
  clientId: string,
  onMessage: (text: string | null) => void,
): Promise<() => Promise<void>> {
  const base = parseLocalBaseUrl(baseUrl);
  const wsUrl = new URL(`/ws?clientId=${encodeURIComponent(clientId)}`, base);
  wsUrl.protocol = "ws:";
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.binaryType = "nodebuffer";
    let opened = false;
    let closedByCaller = false;
    let ended = false;
    const end = (): void => {
      if (ended) return;
      ended = true;
      if (!closedByCaller) onMessage(null);
    };
    const close = (): Promise<void> => {
      closedByCaller = true;
      if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
      return new Promise<void>((done) => {
        const timer = setTimeout(() => {
          socket.terminate();
          done();
        }, STOP_WAIT_MS);
        socket.once("close", () => {
          clearTimeout(timer);
          done();
        });
        socket.close();
      });
    };
    socket.on("open", () => {
      opened = true;
      resolve(close);
    });
    socket.on("message", (data, isBinary) => {
      if (isBinary || ended || closedByCaller) return;
      // binaryType is "nodebuffer", so a text frame always arrives as one Buffer.
      onMessage((data as Buffer).toString("utf8"));
    });
    socket.on("error", (error) => {
      if (!opened) {
        reject(new Error(`cannot connect to ComfyUI websocket ${wsUrl.origin}: ${error.message}`));
        return;
      }
      console.warn(`[comfy] websocket error (${wsUrl.origin}):`, error.message);
    });
    socket.on("close", () => {
      if (opened) end();
    });
  });
}

// ---------------------------------------------------------------------------
// Process management
// ---------------------------------------------------------------------------

export interface ComfyProcessDeps {
  /** Where ComfyUI and pre-launch output are appended. */
  logPath(): string;
  platform: NodeJS.Platform;
}

/**
 * Python interpreters ComfyUI is commonly installed with, in lookup order:
 * a git checkout with `.venv` or `venv`, and the Windows portable build whose
 * `python_embeded` folder sits next to the `ComfyUI` folder.
 */
export function comfyPythonCandidates(comfyDir: string, platform: NodeJS.Platform): string[] {
  if (platform === "win32") {
    return [
      path.join(comfyDir, ".venv", "Scripts", "python.exe"),
      path.join(comfyDir, "venv", "Scripts", "python.exe"),
      path.join(comfyDir, "..", "python_embeded", "python.exe"),
    ];
  }
  return [path.join(comfyDir, ".venv", "bin", "python"), path.join(comfyDir, "venv", "bin", "python")];
}

/** First existing interpreter from `comfyPythonCandidates`, or null. */
export function comfyPythonPath(
  comfyDir: string,
  platform: NodeJS.Platform,
  exists: (candidate: string) => boolean = existsSync,
): string | null {
  return comfyPythonCandidates(comfyDir, platform).find((candidate) => exists(candidate)) ?? null;
}

function appendLog(logPath: string, line: string): void {
  const fd = openSync(logPath, "a");
  try {
    writeSync(fd, `[${new Date().toISOString()}] ${line}\n`);
  } finally {
    closeSync(fd);
  }
}

/** Spawns `command`, appends its output to the log, resolves with its exit code (null on timeout). */
function runToCompletion(command: string, args: string[], logPath: string, timeoutMs: number): Promise<number | null> {
  const fd = openSync(logPath, "a");
  return new Promise<number | null>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", fd, fd], windowsHide: true });
    const timer = setTimeout(() => {
      console.warn(`[comfy] ${command} exceeded ${timeoutMs} ms; killing it`);
      child.kill();
      resolve(null);
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`failed to run ${command}: ${error.message}`));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  }).finally(() => closeSync(fd));
}

export class ComfyProcess {
  private child: ChildProcess | null = null;

  constructor(private readonly deps: ComfyProcessDeps) {}

  isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null;
  }

  /** Spawns ComfyUI hidden. Resolves once the process has spawned, not when it is ready. */
  async launch(config: ComfyLaunchConfig): Promise<void> {
    if (this.isRunning()) {
      console.info(`[comfy] launch skipped: ComfyUI already started by this app (pid ${this.child?.pid})`);
      return;
    }
    const mainPy = path.join(config.comfyDir, "main.py");
    if (!existsSync(mainPy)) throw new Error(`ComfyUI main.py not found: ${mainPy}`);
    const python = comfyPythonPath(config.comfyDir, this.deps.platform);
    if (python === null) {
      throw new Error(
        `ComfyUI Python not found; looked for ${comfyPythonCandidates(config.comfyDir, this.deps.platform).join(", ")}`,
      );
    }

    const logPath = this.deps.logPath();
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await this.runPreLaunchScript(config.preLaunchScript, logPath);

    appendLog(logPath, `starting ${python} ${config.args.join(" ")} (cwd ${config.comfyDir})`);
    const fd = openSync(logPath, "a");
    try {
      const child = spawn(python, config.args, {
        cwd: config.comfyDir,
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
        stdio: ["ignore", fd, fd],
        windowsHide: true,
        detached: false,
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", (error) => reject(new Error(`failed to start ComfyUI: ${error.message}`)));
      });
      this.child = child;
      child.once("exit", (code, signal) => {
        console.info(`[comfy] ComfyUI exited (code ${code}, signal ${signal})`);
        if (this.child === child) this.child = null;
      });
    } finally {
      closeSync(fd);
    }
  }

  private async runPreLaunchScript(script: string | null, logPath: string): Promise<void> {
    if (script === null) return;
    if (!existsSync(script)) {
      console.info(`[comfy] pre-launch script not found, skipped: ${script}`);
      return;
    }
    appendLog(logPath, `running pre-launch script ${script}`);
    const code = await runToCompletion(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
      logPath,
      PRE_LAUNCH_TIMEOUT_MS,
    );
    // The exit code is informational only: a failed clean-up must not block launching.
    console.info(`[comfy] pre-launch script finished with exit code ${code}`);
    appendLog(logPath, `pre-launch script exit code ${code}`);
  }

  /** Kills the launched ComfyUI and its process tree; no-op when none is running. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child || !this.isRunning() || child.pid === undefined) return;
    const exited = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, STOP_WAIT_MS);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (this.deps.platform === "win32") {
      // spawn() creates the process synchronously, so this also works during app quit.
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.once("error", (error) => console.error("[comfy] taskkill failed:", error.message));
    } else {
      child.kill("SIGTERM");
    }
    await exited;
    this.child = null;
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export async function ensureLibraryDir(videosDir: string): Promise<string> {
  const dir = path.join(videosDir, "Flameblade Cut");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function readFileBytes(filePath: string): Promise<Uint8Array> {
  const buf = await fs.readFile(filePath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Atomic write: temp file in the same folder, then rename over the target. */
export async function writeTextFileAtomic(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, contents, "utf8");
    await fs.rename(tmp, filePath);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

/** Returns null when the file does not exist; every other error propagates. */
export async function readTextFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// IPC wiring
// ---------------------------------------------------------------------------

const comfyProcess = new ComfyProcess({
  logPath: () => path.join(app.getPath("userData"), "comfyui.log"),
  platform: process.platform,
});

/** Open sockets per renderer: webContents id -> subscription id -> close(). */
const subscriptions = new Map<number, Map<string, () => Promise<void>>>();

function sendWsEvent(wc: WebContents, event: ComfyWsEvent): void {
  if (!wc.isDestroyed()) wc.send(CHANNELS.comfyWsEvent, event);
}

async function subscribeFor(
  wc: WebContents,
  args: { subscriptionId: string; baseUrl: string; clientId: string },
): Promise<void> {
  let owned = subscriptions.get(wc.id);
  if (owned?.has(args.subscriptionId)) {
    throw new Error(`comfy subscription ${args.subscriptionId} already exists`);
  }
  const close = await openComfySocket(args.baseUrl, args.clientId, (text) => {
    if (text === null) subscriptions.get(wc.id)?.delete(args.subscriptionId);
    sendWsEvent(wc, { subscriptionId: args.subscriptionId, text });
  });
  if (!owned) {
    owned = new Map();
    subscriptions.set(wc.id, owned);
    wc.once("destroyed", () => {
      const active = subscriptions.get(wc.id);
      subscriptions.delete(wc.id);
      for (const closeSocket of active?.values() ?? []) {
        void closeSocket().catch((error) => console.error("[comfy] closing websocket failed:", error));
      }
    });
  }
  owned.set(args.subscriptionId, close);
}

async function unsubscribeFor(wc: WebContents, subscriptionId: string): Promise<void> {
  const owned = subscriptions.get(wc.id);
  const close = owned?.get(subscriptionId);
  if (!close) return;
  owned?.delete(subscriptionId);
  await close();
}

export function registerComfyIpc(): void {
  handle(CHANNELS.comfyRequest, comfyRequestArgsSchema, (args) =>
    comfyRequest(args.baseUrl, args.method, args.path, args.jsonBody),
  );
  handle(CHANNELS.comfyUploadImage, comfyUploadImageArgsSchema, (args) =>
    comfyUploadImage(
      args.baseUrl,
      args.bytes instanceof Uint8Array ? args.bytes : new Uint8Array(args.bytes),
      args.filename,
    ),
  );
  handle(CHANNELS.comfyDownload, comfyDownloadArgsSchema, (args) =>
    comfyDownload(args.baseUrl, args.file, args.destPath),
  );
  ipcMain.handle(CHANNELS.comfySubscribe, (event, raw) =>
    subscribeFor(event.sender, comfySubscribeArgsSchema.parse(raw)),
  );
  ipcMain.handle(CHANNELS.comfyUnsubscribe, (event, raw) =>
    unsubscribeFor(event.sender, comfyUnsubscribeArgsSchema.parse(raw).subscriptionId),
  );
  handle(CHANNELS.comfyLaunch, comfyLaunchConfigSchema, (config) => comfyProcess.launch(config));
  handle(CHANNELS.comfyStopLaunched, z.undefined(), () => comfyProcess.stop());
  handle(CHANNELS.comfyLibraryDir, z.undefined(), () => ensureLibraryDir(app.getPath("videos")));
  handle(CHANNELS.comfyReadFileBytes, comfyPathArgsSchema, (args) => readFileBytes(args.path));
  handle(CHANNELS.comfyWriteTextFile, comfyWriteTextFileArgsSchema, (args) =>
    writeTextFileAtomic(args.path, args.contents),
  );
  handle(CHANNELS.comfyReadTextFile, comfyPathArgsSchema, (args) => readTextFileOrNull(args.path));
}

/** Called at app quit so a ComfyUI started by this app does not outlive it. */
export function stopLaunchedComfy(): Promise<void> {
  return comfyProcess.stop();
}
