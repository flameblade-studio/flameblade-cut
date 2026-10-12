/**
 * Local files (generated videos, chosen images) are shown through blob URLs
 * read via the desktop bridge, so the renderer needs no file:// access.
 * URLs are cached per path and reference-counted by the hook.
 */
import { useEffect, useState } from "react";

type ReadBytes = (path: string) => Promise<Uint8Array<ArrayBuffer>>;

interface Entry {
  url: Promise<string>;
  users: number;
}

const cache = new Map<string, Entry>();

function mimeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".webm")) return "video/webm";
  return "video/mp4";
}

function acquire(path: string, readBytes: ReadBytes): Entry {
  const existing = cache.get(path);
  if (existing) {
    existing.users += 1;
    return existing;
  }
  const entry: Entry = {
    url: readBytes(path).then((bytes) => URL.createObjectURL(new Blob([bytes], { type: mimeFor(path) }))),
    users: 1,
  };
  cache.set(path, entry);
  return entry;
}

function release(path: string): void {
  const entry = cache.get(path);
  if (!entry) return;
  entry.users -= 1;
  if (entry.users > 0) return;
  cache.delete(path);
  void entry.url.then((url) => {
    URL.revokeObjectURL(url);
  });
}

/** Blob URL for a local file, or null while loading / when `path` is null. */
export function useLocalFileUrl(path: string | null, readBytes: ReadBytes | null): { url: string | null; error: string | null } {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  useEffect(() => {
    if (!path || !readBytes) {
      setState({ url: null, error: null });
      return;
    }
    let alive = true;
    const entry = acquire(path, readBytes);
    entry.url.then(
      (url) => {
        if (alive) setState({ url, error: null });
      },
      (error: unknown) => {
        cache.delete(path);
        if (alive) setState({ url: null, error: String(error) });
      },
    );
    return () => {
      alive = false;
      release(path);
    };
  }, [path, readBytes]);
  return state;
}
