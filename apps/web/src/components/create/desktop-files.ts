/**
 * File helpers for the AI page, backed by the existing desktop bridge
 * (`window.openreel.fs`). Every function fails with a clear error outside the
 * desktop app instead of silently doing nothing.
 */
import type { ImageInput } from "../../services/ltx/types";

const IMAGE_FILTERS = [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }];
const CHUNK_BYTES = 8 * 1024 * 1024;

function desktopFs(): NonNullable<NonNullable<Window["openreel"]>["fs"]> {
  const fs = window.openreel?.fs;
  if (!fs) throw new Error("desktop file access is unavailable");
  return fs;
}

export function isDesktop(): boolean {
  return Boolean(window.openreel?.fs);
}

export async function readLocalBytes(path: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await desktopFs().readFileBytes(path));
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export async function pickImage(): Promise<ImageInput | null> {
  const path = await desktopFs().showOpenDialog({ filters: IMAGE_FILTERS });
  return path ? { path, name: baseName(path) } : null;
}

/** Multi-select image picker; returns [] when cancelled. */
export async function pickImages(): Promise<ImageInput[]> {
  const paths = await desktopFs().showOpenFilesDialog({ filters: IMAGE_FILTERS });
  return paths.map((path) => ({ path, name: baseName(path) }));
}

/** Natural size of a local image, used to suggest the closest aspect ratio. */
export async function imageSize(path: string): Promise<{ width: number; height: number }> {
  const bytes = await readLocalBytes(path);
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/** Copies a local file to a user-chosen location. Returns the destination, or null if cancelled. */
export async function saveCopyAs(sourcePath: string): Promise<string | null> {
  const fs = desktopFs();
  const destination = await fs.showSaveDialog({
    defaultPath: baseName(sourcePath),
    filters: [{ name: "MP4", extensions: ["mp4"] }],
  });
  if (!destination) return null;
  const bytes = await readLocalBytes(sourcePath);
  const handle = await fs.openWrite(destination);
  try {
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      await fs.writeChunk(handle, bytes.subarray(offset, offset + CHUNK_BYTES), offset);
    }
    await fs.closeWrite(handle);
  } catch (error) {
    await fs.abortWrite(handle);
    throw error;
  }
  return destination;
}

export async function revealInFolder(path: string): Promise<void> {
  await desktopFs().revealInFolder(path);
}
