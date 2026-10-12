/**
 * Puts a synthesized WAV on the timeline: imports it into the media library
 * (diffing `mediaLibrary.items` to find the new id, as `ltx/send-to-editor`
 * does) and places it on the first unlocked audio track that is free over the
 * clip's interval, creating a "配音" dialogue track when none is.
 */
import type { ActionResult, Project, Track } from "@openreel/core";
import { v4 as uuidv4 } from "uuid";
import { useProjectStore } from "../../stores/project-store";

/** The slice of the project store this module needs (injectable for tests). */
export interface VoiceoverProjectStore {
  getState(): {
    project: Project;
    hasOpenProject: boolean;
    importMedia(file: File): Promise<ActionResult>;
    addTrack(
      trackType: "audio",
      position?: number,
      options?: { mode?: "standard"; role?: Track["role"]; name?: string; trackId?: string },
    ): Promise<ActionResult>;
    placeMediaClip(mediaId: string, targetTrackId: string | undefined, startTime: number): Promise<ActionResult>;
  };
}

export interface VoiceoverClipSource {
  bytes: Uint8Array;
  /** Media library name (".wav" is appended when missing). */
  name: string;
  startSeconds: number;
  durationSec: number;
}

export interface PlacedVoiceover {
  mediaId: string;
  trackId: string;
  startSeconds: number;
}

export class VoiceoverPlacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceoverPlacementError";
  }
}

const EPSILON = 1e-6;

function overlaps(track: Track, start: number, end: number): boolean {
  return track.clips.some((clip) => clip.startTime < end - EPSILON && clip.startTime + clip.duration > start + EPSILON);
}

/** First unlocked audio track (dialogue role preferred) with nothing in [start, start + duration). */
export function findFreeAudioTrack(project: Project, start: number, duration: number): string | null {
  const end = start + Math.max(duration, EPSILON);
  const audio = project.timeline.tracks.filter((track) => track.type === "audio" && !track.locked);
  const ordered = [...audio.filter((track) => track.role === "dialogue"), ...audio.filter((track) => track.role !== "dialogue")];
  return ordered.find((track) => !overlaps(track, start, end))?.id ?? null;
}

/** Media library file name: a short, filesystem-safe excerpt of the spoken text. */
export function voiceoverFileName(text: string, prefix: string): string {
  const excerpt = text.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 24);
  return `${prefix}${excerpt ? ` - ${excerpt}` : ""}.wav`;
}

async function importWav(store: VoiceoverProjectStore, source: VoiceoverClipSource): Promise<string> {
  const before = new Set(store.getState().project.mediaLibrary.items.map((item) => item.id));
  const name = source.name.toLowerCase().endsWith(".wav") ? source.name : `${source.name}.wav`;
  const file = new File([new Uint8Array(source.bytes)], name, { type: "audio/wav" });
  const result = await store.getState().importMedia(file);
  if (!result.success) throw new VoiceoverPlacementError(result.error?.message ?? "import failed");
  const added = store.getState().project.mediaLibrary.items.find((item) => !before.has(item.id));
  if (!added) throw new VoiceoverPlacementError("imported audio not found in the media library");
  return added.id;
}

async function ensureAudioTrack(
  store: VoiceoverProjectStore,
  start: number,
  duration: number,
  trackName: string,
): Promise<string> {
  const free = findFreeAudioTrack(store.getState().project, start, duration);
  if (free) return free;
  const trackId = `track-${uuidv4()}`;
  const result = await store.getState().addTrack("audio", undefined, {
    mode: "standard",
    role: "dialogue",
    name: trackName,
    trackId,
  });
  if (!result.success) throw new VoiceoverPlacementError(result.error?.message ?? "could not add an audio track");
  return trackId;
}

export async function placeVoiceover(
  source: VoiceoverClipSource,
  options: { trackName: string; store?: VoiceoverProjectStore },
): Promise<PlacedVoiceover> {
  const store = options.store ?? (useProjectStore as unknown as VoiceoverProjectStore);
  if (!store.getState().hasOpenProject) throw new VoiceoverPlacementError("no project is open");
  const start = Math.max(0, source.startSeconds);
  const mediaId = await importWav(store, source);
  const trackId = await ensureAudioTrack(store, start, source.durationSec, options.trackName);
  const result = await store.getState().placeMediaClip(mediaId, trackId, start);
  if (!result.success) throw new VoiceoverPlacementError(result.error?.message ?? "placement failed");
  return { mediaId, trackId, startSeconds: start };
}
