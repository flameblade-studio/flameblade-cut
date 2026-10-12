import { ABSOLUTE_PATH_PATTERN } from "../../shared/ipc-contract";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  ComfyProcess,
  comfyPythonCandidates,
  comfyPythonPath,
  comfyDownload,
  comfyRequest,
  comfyUploadImage,
  ensureLibraryDir,
  openComfySocket,
  parseLocalBaseUrl,
  readFileBytes,
  readTextFileOrNull,
  writeTextFileAtomic,
} from "./comfy";

interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** Minimal multipart parser for asserting what the client actually sent. */
function parseMultipart(body: Buffer, contentType: string): Map<string, { filename?: string; data: Buffer }> {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  if (!boundary) throw new Error(`no boundary in ${contentType}`);
  const parts = new Map<string, { filename?: string; data: Buffer }>();
  const text = body.toString("latin1");
  for (const raw of text.split(`--${boundary}`)) {
    if (!raw.startsWith("\r\n") || raw.startsWith("--")) continue;
    const headerEnd = raw.indexOf("\r\n\r\n");
    const headers = raw.slice(2, headerEnd);
    const data = Buffer.from(raw.slice(headerEnd + 4, raw.length - 2), "latin1");
    const name = /name="([^"]+)"/.exec(headers)?.[1];
    if (!name) throw new Error(`part without name: ${headers}`);
    parts.set(name, { filename: /filename="([^"]+)"/.exec(headers)?.[1], data });
  }
  return parts;
}

const VIDEO_BYTES = Buffer.alloc(256 * 1024, 7);

let server: http.Server;
let wss: WebSocketServer;
let baseUrl: string;
let workDir: string;
const requests: RecordedRequest[] = [];
const sockets: WebSocket[] = [];
const wsClientIds: string[] = [];
const wsOrigins: Array<string | undefined> = [];

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "flameblade-comfy-test-"));
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/system_stats") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ system: { os: "test" } }));
      } else if (url.pathname === "/prompt" && req.method === "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ echo: JSON.parse(body.toString("utf8")) }));
      } else if (url.pathname === "/upload/image" && req.method === "POST") {
        const parts = parseMultipart(body, req.headers["content-type"] ?? "");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            name: parts.get("image")?.filename,
            subfolder: parts.get("subfolder")?.data.toString(),
            type: parts.get("type")?.data.toString(),
          }),
        );
      } else if (url.pathname === "/view" && url.searchParams.get("filename") === "ok.mp4") {
        res.writeHead(200, { "content-type": "video/mp4", "content-length": String(VIDEO_BYTES.length) });
        res.end(VIDEO_BYTES);
      } else if (url.pathname === "/view" && url.searchParams.get("filename") === "truncated.mp4") {
        // Promise more bytes than are sent, then drop the connection mid-stream.
        res.writeHead(200, { "content-type": "video/mp4", "content-length": String(VIDEO_BYTES.length * 2) });
        res.write(VIDEO_BYTES, () => res.destroy());
      } else {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
      }
    });
  });
  wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wsClientIds.push(url.searchParams.get("clientId") ?? "");
      wsOrigins.push(req.headers.origin);
      sockets.push(ws);
      wss.emit("connection", ws, req);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  requests.length = 0;
});

afterAll(async () => {
  for (const ws of sockets) ws.terminate();
  wss.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(workDir, { recursive: true, force: true });
});

function nextMessage(received: Array<string | null>, count: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = (): void => {
      if (received.length >= count) return resolve();
      if (Date.now() - started > 3000) return reject(new Error(`timed out waiting for ${count} messages`));
      setTimeout(poll, 10);
    };
    poll();
  });
}

describe("parseLocalBaseUrl", () => {
  it("accepts loopback hosts only", () => {
    expect(parseLocalBaseUrl("http://127.0.0.1:8188").port).toBe("8188");
    expect(parseLocalBaseUrl("http://localhost:8188").hostname).toBe("localhost");
    expect(parseLocalBaseUrl("http://[::1]:8188").hostname).toBe("[::1]");
    expect(() => parseLocalBaseUrl("http://192.168.1.10:8188")).toThrow(/Only a local ComfyUI/);
    expect(() => parseLocalBaseUrl("http://example.com")).toThrow(/Only a local ComfyUI/);
    expect(() => parseLocalBaseUrl("https://127.0.0.1:8188")).toThrow(/http:/);
  });

  it("refuses remote hosts before any network call", async () => {
    await expect(comfyRequest("http://10.0.0.5:8188", "GET", "/system_stats")).rejects.toThrow(/Only a local/);
    await expect(comfyUploadImage("http://10.0.0.5:8188", new Uint8Array([1]), "a.png")).rejects.toThrow(
      /Only a local/,
    );
    await expect(openComfySocket("http://10.0.0.5:8188", "c", () => undefined)).rejects.toThrow(/Only a local/);
    expect(requests).toHaveLength(0);
  });
});

describe("comfyRequest", () => {
  it("GETs and returns status plus UTF-8 body without an Origin header", async () => {
    const res = await comfyRequest(baseUrl, "GET", "/system_stats");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ system: { os: "test" } });
    expect(requests[0].headers.origin).toBeUndefined();
  });

  it("POSTs JSON with content-type application/json", async () => {
    const res = await comfyRequest(baseUrl, "POST", "/prompt", { prompt: { "1": { text: "墨寒" } } });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ echo: { prompt: { "1": { text: "墨寒" } } } });
    expect(requests[0].headers["content-type"]).toBe("application/json");
  });

  it("returns non-2xx responses instead of throwing", async () => {
    await expect(comfyRequest(baseUrl, "GET", "/missing")).resolves.toEqual({ status: 404, body: "not found" });
  });

  it("refuses paths that would leave the base origin", async () => {
    await expect(comfyRequest(baseUrl, "GET", "//evil.example/x")).rejects.toThrow(/single "\/"/);
    await expect(comfyRequest(baseUrl, "GET", "system_stats")).rejects.toThrow(/single "\/"/);
  });
});

describe("comfyUploadImage", () => {
  it("sends a multipart form ComfyUI can parse", async () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 13, 10, 45, 45]);
    const ref = await comfyUploadImage(baseUrl, bytes, "C:\\pics\\first frame.png");
    expect(ref).toEqual({ filename: "first frame.png", subfolder: "flameblade-cut", type: "input" });

    const sent = requests[0];
    expect(sent.url).toBe("/upload/image");
    const parts = parseMultipart(sent.body, sent.headers["content-type"] ?? "");
    expect(parts.get("image")?.filename).toBe("first frame.png");
    expect([...(parts.get("image")?.data ?? [])]).toEqual([...bytes]);
    expect(parts.get("subfolder")?.data.toString()).toBe("flameblade-cut");
    expect(parts.get("type")?.data.toString()).toBe("input");
    expect(parts.get("overwrite")?.data.toString()).toBe("true");
  });
});

describe("comfyDownload", () => {
  it("streams /view to disk via a .part file and renames it", async () => {
    const dest = path.join(workDir, "nested", "dir", "ok.mp4");
    await comfyDownload(baseUrl, { filename: "ok.mp4", subfolder: "sub", type: "output" }, dest);
    expect((await readFile(dest)).equals(VIDEO_BYTES)).toBe(true);
    expect(await readdir(path.dirname(dest))).toEqual(["ok.mp4"]);
    const query = new URL(requests[0].url, "http://x").searchParams;
    expect(Object.fromEntries(query)).toEqual({ filename: "ok.mp4", subfolder: "sub", type: "output" });
  });

  it("removes the .part file when the server errors", async () => {
    const dir = path.join(workDir, "fail-404");
    const dest = path.join(dir, "missing.mp4");
    await expect(
      comfyDownload(baseUrl, { filename: "missing.mp4", subfolder: "", type: "output" }, dest),
    ).rejects.toThrow(/returned 404/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("removes the .part file when the stream breaks mid-transfer", async () => {
    const dir = path.join(workDir, "fail-truncated");
    const dest = path.join(dir, "truncated.mp4");
    await expect(
      comfyDownload(baseUrl, { filename: "truncated.mp4", subfolder: "", type: "output" }, dest),
    ).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("openComfySocket", () => {
  it("forwards text frames, ignores binary frames, and delivers null when the server closes", async () => {
    const received: Array<string | null> = [];
    const before = sockets.length;
    await openComfySocket(baseUrl, "client-a", (text) => received.push(text));
    const serverSide = sockets[before];
    expect(wsClientIds[before]).toBe("client-a");
    expect(wsOrigins[before]).toBeUndefined();

    serverSide.send(Buffer.from([1, 2, 3, 4]), { binary: true });
    serverSide.send(JSON.stringify({ type: "progress", data: { value: 1, max: 4 } }));
    await nextMessage(received, 1);
    serverSide.close();
    await nextMessage(received, 2);

    expect(received).toEqual(['{"type":"progress","data":{"value":1,"max":4}}', null]);
  });

  it("keeps concurrent subscriptions independent and closes on unsubscribe without null", async () => {
    const a: Array<string | null> = [];
    const b: Array<string | null> = [];
    const before = sockets.length;
    const closeA = await openComfySocket(baseUrl, "client-1", (text) => a.push(text));
    const closeB = await openComfySocket(baseUrl, "client-2", (text) => b.push(text));
    sockets[before + 1].send("only-b");
    sockets[before].send("only-a");
    await nextMessage(a, 1);
    await nextMessage(b, 1);

    await closeA();
    await closeB();

    expect(a).toEqual(["only-a"]);
    expect(b).toEqual(["only-b"]);
  });

  it("rejects when nothing is listening", async () => {
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    await expect(openComfySocket(`http://127.0.0.1:${port}`, "c", () => undefined)).rejects.toThrow(
      /cannot connect/,
    );
  });
});

describe("ComfyProcess.launch", () => {
  const deps = () => ({ logPath: () => path.join(workDir, "logs", "comfyui.log"), platform: process.platform });

  it("refuses when main.py is missing", async () => {
    const dir = path.join(workDir, "no-main");
    await mkdir(dir, { recursive: true });
    await expect(
      new ComfyProcess(deps()).launch({ comfyDir: dir, args: ["main.py"], preLaunchScript: null }),
    ).rejects.toThrow(/main\.py not found/);
  });

  it("refuses when the venv python is missing", async () => {
    const dir = path.join(workDir, "no-venv");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "main.py"), "print('never run')\n");
    const proc = new ComfyProcess(deps());
    await expect(proc.launch({ comfyDir: dir, args: ["main.py"], preLaunchScript: null })).rejects.toThrow(
      /Python not found/,
    );
    expect(proc.isRunning()).toBe(false);
    await expect(proc.stop()).resolves.toBeUndefined();
  });
});

describe("comfyPythonPath", () => {
  const dir = String.raw`D:\ComfyUI_windows_portable\ComfyUI`;

  it("prefers a .venv, then venv, then the portable build's python_embeded", () => {
    const all = comfyPythonCandidates(dir, "win32");
    expect(all).toEqual([
      path.join(dir, ".venv", "Scripts", "python.exe"),
      path.join(dir, "venv", "Scripts", "python.exe"),
      path.join(dir, "..", "python_embeded", "python.exe"),
    ]);
    expect(comfyPythonPath(dir, "win32", (candidate) => candidate === all[2])).toBe(all[2]);
    expect(comfyPythonPath(dir, "win32", (candidate) => candidate === all[1] || candidate === all[2])).toBe(all[1]);
  });

  it("returns null when no interpreter exists", () => {
    expect(comfyPythonPath(dir, "win32", () => false)).toBeNull();
  });
});

describe("file helpers", () => {
  it("writes text atomically, creating parent folders, and reads it back", async () => {
    const file = path.join(workDir, "state", "deep", "jobs.json");
    await writeTextFileAtomic(file, '{"v":1}');
    await writeTextFileAtomic(file, '{"v":2}');
    expect(await readTextFileOrNull(file)).toBe('{"v":2}');
    expect(await readdir(path.dirname(file))).toEqual(["jobs.json"]);
  });

  it("returns null for a missing text file", async () => {
    expect(await readTextFileOrNull(path.join(workDir, "nope.json"))).toBeNull();
  });

  it("reads bytes and creates the library folder", async () => {
    const file = path.join(workDir, "bytes.bin");
    await writeFile(file, Buffer.from([5, 6, 7]));
    expect([...(await readFileBytes(file))]).toEqual([5, 6, 7]);
    const lib = await ensureLibraryDir(path.join(workDir, "Videos"));
    expect(lib).toBe(path.join(workDir, "Videos", "Flameblade Cut"));
    expect(await readdir(path.join(workDir, "Videos"))).toEqual(["Flameblade Cut"]);
  });
});

describe("ABSOLUTE_PATH_PATTERN", () => {
  // Regression: the first version only matched "C:/", so every real Windows
  // path ("C:\Users\...") was rejected and the AI page could not load history.
  it("accepts Windows, UNC and POSIX absolute paths", () => {
    for (const value of [String.raw`C:\Users\me\Videos\Flameblade Cut\h.json`, "D:/media/a.mp4", String.raw`\\server\share\a.mp4`, "/tmp/a.mp4"]) {
      expect(ABSOLUTE_PATH_PATTERN.test(value)).toBe(true);
    }
  });

  it("rejects relative and drive-relative paths", () => {
    for (const value of [String.raw`Videos\a.mp4`, "a.mp4", "C:a.mp4", "./a.mp4", ""]) {
      expect(ABSOLUTE_PATH_PATTERN.test(value)).toBe(false);
    }
  });
});
