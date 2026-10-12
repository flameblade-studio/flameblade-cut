/**
 * Browser encoder for planner vision input: decodes an image, scales its
 * longer side down to `VISION_MAX_SIDE` and returns a JPEG data URL. Keeps
 * request sizes small while leaving design-sheet details readable.
 */
export const VISION_MAX_SIDE = 1536;
const VISION_JPEG_QUALITY = 0.88;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export async function encodeForVision(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    const scale = Math.min(1, VISION_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("This system cannot prepare images for the planner (no 2D canvas)");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: VISION_JPEG_QUALITY });
    return `data:image/jpeg;base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`;
  } finally {
    bitmap.close();
  }
}
