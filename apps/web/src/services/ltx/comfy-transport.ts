/**
 * Desktop implementation of `ComfyTransport`: a thin adapter over the Electron
 * preload bridge `window.openreel.comfy`. All HTTP/WebSocket traffic to ComfyUI
 * runs in the main process (ComfyUI rejects browser-origin requests with 403).
 */
import type { ComfyTransport } from "./types";

type ComfyBridge = NonNullable<NonNullable<Window["openreel"]>["comfy"]>;

function newSubscriptionId(): string {
  return `comfy-${crypto.randomUUID()}`;
}

/** Returns null when not running inside the desktop app (no preload bridge). */
export function createDesktopComfyTransport(): ComfyTransport | null {
  const bridge: ComfyBridge | undefined =
    typeof window === "undefined" ? undefined : window.openreel?.comfy;
  if (!bridge) return null;

  return {
    request: (baseUrl, method, path, jsonBody) => bridge.request({ baseUrl, method, path, jsonBody }),
    uploadImage: (baseUrl, bytes, filename) => bridge.uploadImage({ baseUrl, bytes, filename }),
    download: (baseUrl, file, destPath) => bridge.download({ baseUrl, file, destPath }),
    async subscribe(baseUrl, clientId, onMessage) {
      // Listen before subscribing so no frame sent right after connect is lost.
      const subscriptionId = newSubscriptionId();
      const stopListening = bridge.onWsEvent((event) => {
        if (event.subscriptionId !== subscriptionId) return;
        if (event.text === null) stopListening();
        onMessage(event.text);
      });
      try {
        await bridge.subscribe({ subscriptionId, baseUrl, clientId });
      } catch (error) {
        stopListening();
        throw error;
      }
      return async () => {
        stopListening();
        await bridge.unsubscribe(subscriptionId);
      };
    },
    launch: (config) => bridge.launch(config),
    stopLaunched: () => bridge.stopLaunched(),
    libraryDir: () => bridge.libraryDir(),
    // IPC delivers a fresh copy, so re-wrapping only narrows the buffer type for Blob consumers.
    readFileBytes: async (path) => new Uint8Array(await bridge.readFileBytes(path)),
    writeTextFile: (path, contents) => bridge.writeTextFile(path, contents),
    readTextFile: (path) => bridge.readTextFile(path),
  };
}
