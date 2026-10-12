/**
 * Sends chosen highlight ranges to the editor: imports the source video once
 * into the project media library, then for each range places the media at the
 * end of the first video track and trims it to [start, end) via the project
 * store's public `trimClip` action. Mirrors `services/ltx/send-to-editor.ts`.
 */
import type { Project } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";

export interface HighlightRange {
  readonly start: number;
  readonly end: number;
}

export interface FrameFormat {
  readonly width: number;
  readonly height: number;
}

export const VERTICAL_FORMAT: FrameFormat = { width: 1080, height: 1920 };

export class SendRangesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendRangesError";
  }
}

function firstVideoTrackId(project: Project): string | undefined {
  return project.timeline.tracks.find((track) => track.type === "video" && !track.locked)?.id;
}

function trackEndSeconds(project: Project, trackId: string): number {
  const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
  return (track?.clips ?? []).reduce((end, clip) => Math.max(end, clip.startTime + clip.duration), 0);
}

function allClipIds(project: Project): Set<string> {
  return new Set(project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
}

function mimeFor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  return "video/mp4";
}

export interface SendRangesSource {
  readonly path: string;
  readonly name: string;
}

export interface SendRangesOptions {
  /** Project format used only when no project is open. */
  readonly newProjectFormat: FrameFormat;
  readonly projectName: string;
}

/** Imports `source` once and appends each range in the given order. Returns clips placed. */
export async function sendRangesToEditor(
  source: SendRangesSource,
  ranges: readonly HighlightRange[],
  options: SendRangesOptions,
  readBytes: (path: string) => Promise<Uint8Array<ArrayBuffer>>,
): Promise<number> {
  if (ranges.length === 0) return 0;
  const store = useProjectStore.getState();
  if (!store.hasOpenProject) {
    store.createNewProject(options.projectName, { ...options.newProjectFormat, frameRate: 30 });
  }

  const before = new Set(useProjectStore.getState().project.mediaLibrary.items.map((item) => item.id));
  const bytes = await readBytes(source.path);
  const imported = await useProjectStore.getState().importMedia(new File([bytes], source.name, { type: mimeFor(source.name) }));
  if (!imported.success) throw new SendRangesError(imported.error?.message ?? "import failed");
  const media = useProjectStore.getState().project.mediaLibrary.items.find((item) => !before.has(item.id));
  if (!media) throw new SendRangesError("imported media not found in library");

  let placed = 0;
  for (const range of ranges) {
    const project = useProjectStore.getState().project;
    const trackId = firstVideoTrackId(project);
    const at = trackId ? trackEndSeconds(project, trackId) : 0;
    const existing = allClipIds(project);
    const placement = await useProjectStore.getState().placeMediaClip(media.id, trackId, at);
    if (!placement.success) throw new SendRangesError(placement.error?.message ?? "placement failed");
    const clip = useProjectStore
      .getState()
      .project.timeline.tracks.flatMap((track) => track.clips)
      .find((candidate) => !existing.has(candidate.id));
    if (!clip) throw new SendRangesError("placed clip not found on the timeline");
    const trimmed = await useProjectStore.getState().trimClip(clip.id, range.start, range.end);
    if (!trimmed.success) throw new SendRangesError(trimmed.error?.message ?? "trim failed");
    placed += 1;
  }
  return placed;
}
