/**
 * Highlight analysis pipeline: source video -> 16 kHz mono audio -> local
 * Whisper transcript (in pieces, for real progress) -> sentences + loudness
 * profile -> highlight clips (local scorer or OpenAI). Side effects are
 * injected through `AnalysisDeps` so the pipeline is testable without a
 * desktop bridge or worker.
 */
import { ANALYSIS_SAMPLE_RATE, computeRmsProfile, decodeWavToAnalysisMono, planTranscriptionPieces } from "./audio";
import { findOpenAiHighlights, type OpenAiTextBridge } from "./openai-highlights";
import { findLocalHighlights } from "./scoring";
import { buildSentences, chunksToSegments, type WhisperChunk } from "./transcript";
import type { HighlightClip, HighlightEngine, LengthRange, RmsProfile, TranscriptSegment } from "./types";
import type { WhisperEvent } from "./whisper-client";

/** Whisper language hint; "auto" lets the model detect it. */
export type TranscriptLanguage = "auto" | "zh" | "en" | "ja";

export type AnalysisStage =
  | { readonly stage: "audio" }
  | { readonly stage: "model"; readonly progress: number }
  | { readonly stage: "transcribe"; readonly progress: number }
  | { readonly stage: "analyze" };

export interface AnalysisDeps {
  /** WAV bytes of the source's first audio stream. */
  loadWav(path: string): Promise<Uint8Array>;
  transcribe(
    samples: Float32Array,
    language: string | undefined,
    onEvent: (event: WhisperEvent) => void,
    signal: AbortSignal,
  ): Promise<WhisperChunk[]>;
  /** Simplified -> Taiwan Traditional, applied to Chinese segments. */
  toTaiwan(text: string): string;
}

export interface Transcription {
  readonly path: string;
  readonly language: TranscriptLanguage;
  readonly duration: number;
  readonly segments: readonly TranscriptSegment[];
  readonly sentences: readonly TranscriptSegment[];
  readonly rms: RmsProfile;
}

export class NoSpeechError extends Error {
  constructor() {
    super("no speech detected");
    this.name = "NoSpeechError";
  }
}

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN = /\p{Script=Han}/u;

/** Chinese text (Han without kana) is shown in Taiwan Traditional characters. */
export function shouldConvertToTaiwan(text: string, language: TranscriptLanguage): boolean {
  if (language === "en" || language === "ja") return false;
  return HAN.test(text) && !KANA.test(text);
}

export async function transcribeVideo(
  path: string,
  language: TranscriptLanguage,
  deps: AnalysisDeps,
  onStage: (stage: AnalysisStage) => void,
  signal: AbortSignal,
): Promise<Transcription> {
  onStage({ stage: "audio" });
  const { samples, duration } = decodeWavToAnalysisMono(await deps.loadWav(path));
  const rms = computeRmsProfile(samples, ANALYSIS_SAMPLE_RATE);
  const pieces = planTranscriptionPieces(rms, duration);
  const segments: TranscriptSegment[] = [];
  const hint = language === "auto" ? undefined : language;
  for (const [index, [start, end]] of pieces.entries()) {
    signal.throwIfAborted();
    const piece = samples.subarray(Math.floor(start * ANALYSIS_SAMPLE_RATE), Math.floor(end * ANALYSIS_SAMPLE_RATE));
    onStage({ stage: "transcribe", progress: index / pieces.length });
    const chunks = await deps.transcribe(
      piece,
      hint,
      (event) => {
        if (event.kind === "model-download") onStage({ stage: "model", progress: event.progress });
        else onStage({ stage: "transcribe", progress: index / pieces.length });
      },
      signal,
    );
    for (const segment of chunksToSegments(chunks, start, end - start)) {
      segments.push(shouldConvertToTaiwan(segment.text, language) ? { ...segment, text: deps.toTaiwan(segment.text) } : segment);
    }
  }
  onStage({ stage: "transcribe", progress: 1 });
  if (segments.length === 0) throw new NoSpeechError();
  return { path, language, duration, segments, sentences: buildSentences(segments), rms };
}

export interface HighlightRequest {
  readonly engine: HighlightEngine;
  readonly length: LengthRange;
  readonly count: number;
}

export async function findHighlights(
  transcription: Transcription,
  request: HighlightRequest,
  openai: OpenAiTextBridge | null,
): Promise<HighlightClip[]> {
  const options = { length: request.length, count: request.count, duration: transcription.duration };
  if (request.engine === "openai") {
    if (!openai) throw new Error("OpenAI engine is unavailable in this build");
    return findOpenAiHighlights(openai, transcription.segments, { ...options, sentences: transcription.sentences });
  }
  return findLocalHighlights(transcription.sentences, transcription.rms, options);
}

/** Desktop WAV loader: FFmpeg sidecar extraction, then read the temp file. */
export async function loadWavViaDesktop(path: string): Promise<Uint8Array> {
  const bridge = window.openreel;
  if (!bridge) throw new Error("desktop bridge is unavailable");
  const { streams } = await bridge.media.probeAudioStreams({ srcPath: path });
  if (streams.length === 0) throw new NoSpeechError();
  const { outPath } = await bridge.media.extractAudioWav({ srcPath: path, format: "speech" });
  return new Uint8Array(await bridge.fs.readFileBytes(outPath));
}
