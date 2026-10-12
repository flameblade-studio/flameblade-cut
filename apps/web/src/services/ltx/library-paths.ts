/**
 * Path and id helpers for the generation library. Paths come from the
 * desktop bridge (`libraryDir()`), so the separator follows whatever style
 * that directory already uses (backslash on Windows).
 */

export const HISTORY_FILE_NAME = "flameblade-cut-history.json";

export function joinPath(dir: string, ...parts: string[]): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  const trimmed = dir.replace(/[\\/]+$/, "");
  return [trimmed, ...parts].join(sep);
}

/** Local calendar date `yyyy-mm-dd`, used to group videos into day folders. */
export function localDateFolder(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Lower-case extension including the dot, or `fallback` when there is none. */
export function fileExtension(name: string, fallback: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return match ? `.${match[1].toLowerCase()}` : fallback;
}

export const SEED_LIMIT = 2 ** 48;

/** Uniform random integer in [0, 2^48) from the platform CSPRNG. */
export function randomSeed48(): number {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return (words[0] & 0xffff) * 2 ** 32 + words[1];
}

export function newRecordId(): string {
  return crypto.randomUUID();
}
