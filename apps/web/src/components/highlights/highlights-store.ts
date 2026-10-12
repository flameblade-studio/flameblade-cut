/**
 * AI Highlights page state. Kept in memory only (no disk writes): the chosen
 * source and options, Whisper transcripts per (video, language) so re-running
 * with another length or engine skips transcription, and the last analysis
 * (clips + selection) per video path.
 */
import { create } from "zustand";
import type { HighlightRequest, Transcription, TranscriptLanguage } from "../../services/highlights/analyze";
import type { HighlightClip, HighlightEngine, HighlightLength } from "../../services/highlights/types";

export type ClipCount = 3 | 5 | 10;

export interface HighlightSource {
  readonly path: string;
  readonly name: string;
}

export interface AnalysisEntry {
  readonly request: HighlightRequest;
  readonly clips: readonly HighlightClip[];
  readonly selected: readonly string[];
}

interface HighlightsState {
  source: HighlightSource | null;
  length: HighlightLength;
  count: ClipCount;
  engine: HighlightEngine;
  language: TranscriptLanguage;
  transcripts: Record<string, Transcription>;
  entries: Record<string, AnalysisEntry>;
  patch: (next: Partial<Pick<HighlightsState, "source" | "length" | "count" | "engine" | "language">>) => void;
  saveTranscript: (transcription: Transcription) => void;
  saveEntry: (path: string, entry: AnalysisEntry) => void;
  setClipRange: (path: string, clipId: string, start: number, end: number) => void;
  toggleClip: (path: string, clipId: string) => void;
  selectAll: (path: string, selected: boolean) => void;
}

export function transcriptKey(path: string, language: TranscriptLanguage): string {
  return `${language}|${path}`;
}

function updateEntry(state: HighlightsState, path: string, change: (entry: AnalysisEntry) => AnalysisEntry): Partial<HighlightsState> {
  const entry = state.entries[path];
  return entry ? { entries: { ...state.entries, [path]: change(entry) } } : {};
}

export const useHighlightsStore = create<HighlightsState>()((set) => ({
  source: null,
  length: "short",
  count: 5,
  engine: "local",
  language: "auto",
  transcripts: {},
  entries: {},
  patch: (next) => set(next),
  saveTranscript: (transcription) =>
    set((state) => ({
      transcripts: { ...state.transcripts, [transcriptKey(transcription.path, transcription.language)]: transcription },
    })),
  saveEntry: (path, entry) => set((state) => ({ entries: { ...state.entries, [path]: entry } })),
  setClipRange: (path, clipId, start, end) =>
    set((state) =>
      updateEntry(state, path, (entry) => ({
        ...entry,
        clips: entry.clips.map((clip) => (clip.id === clipId ? { ...clip, start, end } : clip)),
      })),
    ),
  toggleClip: (path, clipId) =>
    set((state) =>
      updateEntry(state, path, (entry) => ({
        ...entry,
        selected: entry.selected.includes(clipId) ? entry.selected.filter((id) => id !== clipId) : [...entry.selected, clipId],
      })),
    ),
  selectAll: (path, selected) =>
    set((state) => updateEntry(state, path, (entry) => ({ ...entry, selected: selected ? entry.clips.map((clip) => clip.id) : [] }))),
}));
