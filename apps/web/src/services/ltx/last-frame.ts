/**
 * Extracts the final frame of a finished generation as PNG bytes, used by
 * "extend" (the new clip starts from where the previous one ended). Uses a
 * detached <video> element so it relies only on the browser's own decoders.
 */

/** Seconds before the end to sample; the very last timestamp can be past the final decodable frame. */
const END_MARGIN_SECONDS = 0.05;
const TIMEOUT_MS = 20_000;

function waitFor(video: HTMLVideoElement, event: "loadedmetadata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${event}`));
    }, TIMEOUT_MS);
    const onDone = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error(`video error ${video.error?.code ?? "unknown"} while waiting for ${event}`));
    };
    const cleanup = (): void => {
      window.clearTimeout(timer);
      video.removeEventListener(event, onDone);
      video.removeEventListener("error", onError);
    };
    video.addEventListener(event, onDone, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

export async function extractLastFramePng(videoBytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const url = URL.createObjectURL(new Blob([videoBytes], { type: "video/mp4" }));
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  try {
    const metadata = waitFor(video, "loadedmetadata");
    video.src = url;
    await metadata;
    const seeked = waitFor(video, "seeked");
    video.currentTime = Math.max(0, video.duration - END_MARGIN_SECONDS);
    await seeked;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas unavailable");
    context.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
    if (!blob) throw new Error("PNG encoding failed");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
