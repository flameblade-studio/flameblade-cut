/**
 * "Subtitles → voiceover": one voice clip per subtitle line, placed at the
 * line's start time. Requests run strictly one at a time and stop at the
 * first failure or on cancel, reporting how far they got.
 *
 * Captions in this editor are text clips on a captions track (role
 * "captions" or the legacy name "Captions"), or text clips tagged with
 * `metadata.captionSource` — the same selection `exportSRT` uses. Projects
 * that only carry legacy `timeline.subtitles` fall back to those.
 */
import type { Project, TextClip } from "@openreel/core";
import { captionOriginalText } from "../captions/caption-documents";

export interface SubtitleLine {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
}

export function collectSubtitleLines(project: Project, textClips: readonly TextClip[]): SubtitleLine[] {
  const captionTrackIds = new Set(
    project.timeline.tracks
      .filter((track) => track.role === "captions" || track.name === "Captions")
      .map((track) => track.id),
  );
  const fromClips = textClips
    .filter((clip) => captionTrackIds.has(clip.trackId) || typeof clip.metadata?.captionSource === "string")
    // Bilingual captions show the original and its translation on two lines;
    // only the spoken original is voiced.
    .map((clip) => ({ id: clip.id, text: captionOriginalText(clip), startTime: clip.startTime, endTime: clip.startTime + clip.duration }));
  const source = fromClips.length > 0 ? fromClips : (project.timeline.subtitles ?? []);
  return source
    .map((line) => ({ id: line.id, text: line.text.trim(), startTime: line.startTime, endTime: line.endTime }))
    .filter((line) => line.text.length > 0)
    .sort((a, b) => a.startTime - b.startTime);
}

export interface SubtitleVoiceoverProgress {
  /** Lines finished so far. */
  done: number;
  total: number;
  /** Line currently being voiced, or null when finished. */
  current: SubtitleLine | null;
}

export interface SubtitleVoiceoverOutcome {
  placed: number;
  total: number;
  cancelled: boolean;
  /** First failure; remaining lines are not attempted. */
  failure: { line: SubtitleLine; error: unknown } | null;
}

export async function voiceSubtitleLines(
  lines: readonly SubtitleLine[],
  steps: {
    /** Synthesizes and places one line. */
    voiceLine(line: SubtitleLine): Promise<void>;
    onProgress?(progress: SubtitleVoiceoverProgress): void;
    signal?: AbortSignal;
  },
): Promise<SubtitleVoiceoverOutcome> {
  let placed = 0;
  for (const line of lines) {
    if (steps.signal?.aborted) return { placed, total: lines.length, cancelled: true, failure: null };
    steps.onProgress?.({ done: placed, total: lines.length, current: line });
    try {
      await steps.voiceLine(line);
    } catch (error) {
      return { placed, total: lines.length, cancelled: false, failure: { line, error } };
    }
    placed += 1;
  }
  steps.onProgress?.({ done: placed, total: lines.length, current: null });
  return { placed, total: lines.length, cancelled: false, failure: null };
}
