/**
 * Hands finished AI generations to the editor: imports each video into the
 * project media library and appends it to the end of the first video track,
 * in the given order. Creates a project (matching the clip aspect) when none
 * is open.
 */
import type { Project } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import type { GenerationAspect } from "./types";

export interface EditorClipSource {
  /** Absolute path of the finished MP4. */
  path: string;
  /** File name shown in the media library. */
  name: string;
}

const FORMAT_FOR_ASPECT: Record<GenerationAspect, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};

export class SendToEditorError extends Error {
  constructor(message: string, readonly failedName: string) {
    super(message);
    this.name = "SendToEditorError";
  }
}

function firstVideoTrackId(project: Project): string | undefined {
  return project.timeline.tracks.find((track) => track.type === "video" && !track.locked)?.id;
}

function trackEndSeconds(project: Project, trackId: string): number {
  const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
  return (track?.clips ?? []).reduce((end, clip) => Math.max(end, clip.startTime + clip.duration), 0);
}

async function importOne(source: EditorClipSource, readBytes: (path: string) => Promise<Uint8Array<ArrayBuffer>>): Promise<string> {
  const store = useProjectStore.getState();
  const before = new Set(store.project.mediaLibrary.items.map((item) => item.id));
  const bytes = await readBytes(source.path);
  const file = new File([bytes], source.name, { type: "video/mp4" });
  const result = await store.importMedia(file);
  if (!result.success) {
    throw new SendToEditorError(result.error?.message ?? "import failed", source.name);
  }
  const added = useProjectStore.getState().project.mediaLibrary.items.find((item) => !before.has(item.id));
  if (!added) throw new SendToEditorError("imported media not found in library", source.name);
  return added.id;
}

/** Imports and appends `sources` in order. Returns the number of clips placed. */
export async function sendToEditor(
  sources: readonly EditorClipSource[],
  aspect: GenerationAspect,
  readBytes: (path: string) => Promise<Uint8Array<ArrayBuffer>>,
): Promise<number> {
  // Start auto-save before touching the project: it only saves changes it
  // observes, and the editor (which also starts it) may not have opened yet.
  // Without this, a project built here is never saved and is lost on quit.
  await useProjectStore.getState().initializeAutoSave();
  const store = useProjectStore.getState();
  if (!store.hasOpenProject) {
    store.createNewProject("AI 影片", { ...FORMAT_FOR_ASPECT[aspect], frameRate: 24 });
    // LTX sizes are multiples of 64 (e.g. 832x448), slightly off 16:9; a black
    // canvas keeps the thin letterbox invisible instead of showing white bars.
    await useProjectStore.getState().setCanvasBackground("color", "#000000");
  }
  let placed = 0;
  for (const source of sources) {
    const mediaId = await importOne(source, readBytes);
    const project = useProjectStore.getState().project;
    const trackId = firstVideoTrackId(project);
    const start = trackId ? trackEndSeconds(project, trackId) : 0;
    const result = await useProjectStore.getState().placeMediaClip(mediaId, trackId, start);
    if (!result.success) {
      throw new SendToEditorError(result.error?.message ?? "placement failed", source.name);
    }
    placed += 1;
  }
  return placed;
}
