/**
 * Runs one highlight analysis for the page: reuses a cached transcript when
 * available, otherwise transcribes with the local Whisper worker, then scores
 * with the chosen engine and stores the result. Owns cancellation.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AnalysisStage,
  findHighlights,
  loadWavViaDesktop,
  transcribeVideo,
} from "../../services/highlights/analyze";
import { getOpenAiTextBridge } from "../../services/highlights/openai-highlights";
import { createTaiwanConverter } from "../../services/highlights/search";
import { LENGTH_RANGES } from "../../services/highlights/types";
import { WhisperClient } from "../../services/highlights/whisper-client";
import { transcriptKey, useHighlightsStore } from "./highlights-store";

export type RunOutcome = "done" | "cancelled";

export interface HighlightRunner {
  readonly running: boolean;
  readonly stage: AnalysisStage | null;
  readonly cachedTranscript: boolean;
  run(): Promise<RunOutcome>;
  cancel(): void;
}

export function useHighlightRunner(): HighlightRunner {
  const whisperRef = useRef<WhisperClient | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<AnalysisStage | null>(null);
  const [cachedTranscript, setCachedTranscript] = useState(false);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      whisperRef.current?.dispose();
      whisperRef.current = null;
    },
    [],
  );

  const run = useCallback(async (): Promise<RunOutcome> => {
    const state = useHighlightsStore.getState();
    const source = state.source;
    if (!source) throw new Error("no source video selected");
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setStage(null);
    try {
      const key = transcriptKey(source.path, state.language);
      let transcription = state.transcripts[key];
      setCachedTranscript(Boolean(transcription));
      if (!transcription) {
        const whisper = (whisperRef.current ??= new WhisperClient());
        const toTaiwan = await createTaiwanConverter();
        transcription = await transcribeVideo(
          source.path,
          state.language,
          {
            loadWav: loadWavViaDesktop,
            transcribe: (samples, language, onEvent, signal) => whisper.transcribe({ samples, language, onEvent, signal }),
            toTaiwan,
          },
          setStage,
          controller.signal,
        );
        useHighlightsStore.getState().saveTranscript(transcription);
      }
      controller.signal.throwIfAborted();
      setStage({ stage: "analyze" });
      const request = { engine: state.engine, length: LENGTH_RANGES[state.length], count: state.count };
      const clips = await findHighlights(transcription, request, getOpenAiTextBridge());
      controller.signal.throwIfAborted();
      useHighlightsStore.getState().saveEntry(source.path, { request, clips, selected: clips.map((clip) => clip.id) });
      return "done";
    } catch (error) {
      if (controller.signal.aborted) return "cancelled";
      throw error;
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setRunning(false);
      setStage(null);
    }
  }, []);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  return { running, stage, cachedTranscript, run, cancel };
}
