import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopComfyTransport } from "./comfy-transport";
import type { OpenReelComfyWsEvent } from "../../types/global";

type Bridge = NonNullable<NonNullable<Window["openreel"]>["comfy"]>;

function installBridge(overrides: Partial<Bridge> = {}): {
  bridge: Bridge;
  emit: (event: OpenReelComfyWsEvent) => void;
  listenerCount: () => number;
} {
  const listeners = new Set<(event: OpenReelComfyWsEvent) => void>();
  const bridge: Bridge = {
    request: vi.fn(async () => ({ status: 200, body: "{}" })),
    uploadImage: vi.fn(async () => ({ filename: "a.png", subfolder: "flameblade-cut", type: "input" })),
    download: vi.fn(async () => undefined),
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
    onWsEvent: vi.fn((cb: (event: OpenReelComfyWsEvent) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    launch: vi.fn(async () => undefined),
    stopLaunched: vi.fn(async () => undefined),
    libraryDir: vi.fn(async () => "C:\\Users\\me\\Videos\\Flameblade Cut"),
    readFileBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
    writeTextFile: vi.fn(async () => undefined),
    readTextFile: vi.fn(async () => null),
    ...overrides,
  };
  (window as unknown as { openreel: unknown }).openreel = { comfy: bridge };
  return {
    bridge,
    emit: (event) => {
      for (const cb of [...listeners]) cb(event);
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  delete (window as unknown as { openreel?: unknown }).openreel;
});

describe("createDesktopComfyTransport", () => {
  it("returns null outside the desktop app", () => {
    expect(createDesktopComfyTransport()).toBeNull();
  });

  it("forwards request, upload, download and file calls with named arguments", async () => {
    const { bridge } = installBridge();
    const transport = createDesktopComfyTransport();
    expect(transport).not.toBeNull();
    const base = "http://127.0.0.1:8188";

    await expect(transport!.request(base, "POST", "/prompt", { a: 1 })).resolves.toEqual({ status: 200, body: "{}" });
    expect(bridge.request).toHaveBeenCalledWith({ baseUrl: base, method: "POST", path: "/prompt", jsonBody: { a: 1 } });

    const bytes = new Uint8Array([9]);
    await expect(transport!.uploadImage(base, bytes, "a.png")).resolves.toEqual({
      filename: "a.png",
      subfolder: "flameblade-cut",
      type: "input",
    });
    expect(bridge.uploadImage).toHaveBeenCalledWith({ baseUrl: base, bytes, filename: "a.png" });

    const file = { filename: "out.mp4", subfolder: "", type: "output" };
    await transport!.download(base, file, "D:\\v\\out.mp4");
    expect(bridge.download).toHaveBeenCalledWith({ baseUrl: base, file, destPath: "D:\\v\\out.mp4" });

    const config = { comfyDir: "C:\\ComfyUI", args: ["main.py"], preLaunchScript: null };
    await transport!.launch(config);
    expect(bridge.launch).toHaveBeenCalledWith(config);
    await transport!.stopLaunched();
    expect(bridge.stopLaunched).toHaveBeenCalled();

    await expect(transport!.libraryDir()).resolves.toContain("Flameblade Cut");
    await expect(transport!.readFileBytes("D:\\a.png")).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await transport!.writeTextFile("D:\\a.json", "{}");
    expect(bridge.writeTextFile).toHaveBeenCalledWith("D:\\a.json", "{}");
    await expect(transport!.readTextFile("D:\\missing.json")).resolves.toBeNull();
  });

  it("routes websocket events by subscription id and stops listening on null", async () => {
    const { bridge, emit, listenerCount } = installBridge();
    const transport = createDesktopComfyTransport()!;
    const received: Array<string | null> = [];

    await transport.subscribe("http://127.0.0.1:8188", "client-1", (text) => received.push(text));
    const { subscriptionId } = vi.mocked(bridge.subscribe).mock.calls[0][0];
    expect(vi.mocked(bridge.subscribe).mock.calls[0][0]).toMatchObject({
      baseUrl: "http://127.0.0.1:8188",
      clientId: "client-1",
    });

    emit({ subscriptionId: "someone-else", text: "ignored" });
    emit({ subscriptionId, text: '{"type":"status"}' });
    emit({ subscriptionId, text: null });
    emit({ subscriptionId, text: "after close" });

    expect(received).toEqual(['{"type":"status"}', null]);
    expect(listenerCount()).toBe(0);
  });

  it("unsubscribe removes the listener and closes the main-side socket", async () => {
    const { bridge, emit, listenerCount } = installBridge();
    const transport = createDesktopComfyTransport()!;
    const received: Array<string | null> = [];
    const unsubscribe = await transport.subscribe("http://127.0.0.1:8188", "c", (text) => received.push(text));
    const { subscriptionId } = vi.mocked(bridge.subscribe).mock.calls[0][0];

    await unsubscribe();
    emit({ subscriptionId, text: "late" });

    expect(bridge.unsubscribe).toHaveBeenCalledWith(subscriptionId);
    expect(received).toEqual([]);
    expect(listenerCount()).toBe(0);
  });

  it("removes the listener and rethrows when subscribing fails", async () => {
    const { listenerCount } = installBridge({
      subscribe: vi.fn(async () => {
        throw new Error("cannot connect");
      }),
    });
    const transport = createDesktopComfyTransport()!;
    await expect(transport.subscribe("http://127.0.0.1:8188", "c", () => undefined)).rejects.toThrow("cannot connect");
    expect(listenerCount()).toBe(0);
  });

  it("keeps concurrent subscriptions separate", async () => {
    const { bridge, emit } = installBridge();
    const transport = createDesktopComfyTransport()!;
    const a: Array<string | null> = [];
    const b: Array<string | null> = [];
    await transport.subscribe("http://127.0.0.1:8188", "a", (text) => a.push(text));
    await transport.subscribe("http://127.0.0.1:8188", "b", (text) => b.push(text));
    const [idA, idB] = vi.mocked(bridge.subscribe).mock.calls.map(([args]) => args.subscriptionId);
    expect(idA).not.toBe(idB);

    emit({ subscriptionId: idB, text: "for b" });
    emit({ subscriptionId: idA, text: "for a" });

    expect(a).toEqual(["for a"]);
    expect(b).toEqual(["for b"]);
  });
});
