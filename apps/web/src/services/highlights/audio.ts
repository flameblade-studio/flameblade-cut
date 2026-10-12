/**
 * Pure audio helpers for highlight analysis: parse the WAV written by the
 * desktop FFmpeg sidecar (`media.extractAudioWav`: pcm_f32le, 48 kHz, stereo),
 * mix it down to 16 kHz mono for Whisper, and measure a loudness envelope.
 * No Web Audio dependency, so the same code runs in Node tests.
 */
import type { RmsProfile } from "./types";

export const ANALYSIS_SAMPLE_RATE = 16_000;
export const RMS_FRAME_SECONDS = 0.5;

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

export class WavFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WavFormatError";
  }
}

interface WavLayout {
  readonly format: typeof FORMAT_PCM | typeof FORMAT_FLOAT;
  readonly channels: number;
  readonly sampleRate: number;
  readonly bitsPerSample: number;
  readonly dataOffset: number;
  readonly dataBytes: number;
}

function ascii(view: DataView, offset: number): string {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

function readLayout(bytes: Uint8Array): WavLayout {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || ascii(view, 0) !== "RIFF" || ascii(view, 8) !== "WAVE") {
    throw new WavFormatError("not a RIFF/WAVE file");
  }
  let offset = 12;
  let fmt: Omit<WavLayout, "dataOffset" | "dataBytes"> | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      let format = view.getUint16(body, true);
      if (format === FORMAT_EXTENSIBLE && size >= 26) format = view.getUint16(body + 24, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      const supported = (format === FORMAT_FLOAT && bitsPerSample === 32) || (format === FORMAT_PCM && bitsPerSample === 16);
      if (!supported) throw new WavFormatError(`unsupported WAV encoding (format ${format}, ${bitsPerSample}-bit)`);
      fmt = {
        format: format as WavLayout["format"],
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample,
      };
    } else if (id === "data") {
      if (!fmt) throw new WavFormatError("data chunk before fmt chunk");
      if (fmt.channels < 1 || fmt.sampleRate < 1) throw new WavFormatError("invalid channel count or sample rate");
      // Streamed WAVs may carry a placeholder size; trust the bytes we have.
      const dataBytes = Math.min(size, bytes.byteLength - body);
      return { ...fmt, dataOffset: body, dataBytes };
    }
    offset = body + size + (size % 2);
  }
  throw new WavFormatError("no data chunk");
}

/** Interleaved samples as floats in [-1, 1]. Uses a zero-copy view when aligned. */
function interleavedSamples(bytes: Uint8Array, layout: WavLayout): Float32Array | Int16Array {
  const bytesPerSample = layout.bitsPerSample / 8;
  const count = Math.floor(layout.dataBytes / bytesPerSample);
  const start = bytes.byteOffset + layout.dataOffset;
  const aligned = start % bytesPerSample === 0;
  const source = aligned ? bytes.buffer : bytes.slice(layout.dataOffset, layout.dataOffset + count * bytesPerSample).buffer;
  const sourceOffset = aligned ? start : 0;
  return layout.format === FORMAT_FLOAT ? new Float32Array(source, sourceOffset, count) : new Int16Array(source, sourceOffset, count);
}

/**
 * Decodes a WAV to mono at `ANALYSIS_SAMPLE_RATE`: channels are averaged and
 * each output sample is the mean of the source frames it covers (a box filter,
 * which avoids aliasing when going from 48 kHz to 16 kHz).
 */
export function decodeWavToAnalysisMono(bytes: Uint8Array): { samples: Float32Array; duration: number } {
  const layout = readLayout(bytes);
  const data = interleavedSamples(bytes, layout);
  const scale = layout.format === FORMAT_FLOAT ? 1 : 1 / 32768;
  const frames = Math.floor(data.length / layout.channels);
  const duration = frames / layout.sampleRate;
  const outputLength = Math.floor(duration * ANALYSIS_SAMPLE_RATE);
  const output = new Float32Array(outputLength);
  const ratio = layout.sampleRate / ANALYSIS_SAMPLE_RATE;
  const channels = layout.channels;
  for (let index = 0; index < outputLength; index += 1) {
    const first = Math.floor(index * ratio);
    const last = Math.max(first + 1, Math.min(frames, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let frame = first; frame < last; frame += 1) {
      const base = frame * channels;
      for (let channel = 0; channel < channels; channel += 1) sum += data[base + channel];
    }
    output[index] = (sum * scale) / ((last - first) * channels);
  }
  return { samples: output, duration };
}

/** Root-mean-square loudness per frame (linear amplitude, 0..1). */
export function computeRmsProfile(samples: Float32Array, sampleRate: number, frameSeconds = RMS_FRAME_SECONDS): RmsProfile {
  const frameLength = Math.max(1, Math.round(sampleRate * frameSeconds));
  const frameCount = Math.ceil(samples.length / frameLength);
  const values = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * frameLength;
    const end = Math.min(samples.length, start + frameLength);
    let sumSquares = 0;
    for (let index = start; index < end; index += 1) sumSquares += samples[index] * samples[index];
    values[frame] = Math.sqrt(sumSquares / Math.max(1, end - start));
  }
  return { frameSeconds, values };
}

/** RMS values whose frames overlap [start, end). */
export function rmsSlice(profile: RmsProfile, start: number, end: number): Float32Array {
  const first = Math.max(0, Math.floor(start / profile.frameSeconds));
  const last = Math.min(profile.values.length, Math.ceil(end / profile.frameSeconds));
  return profile.values.subarray(first, Math.max(first, last));
}

/**
 * Splits a long recording into pieces of about `targetSeconds` for sequential
 * transcription (so progress can be reported), moving each cut to the
 * quietest RMS frame within `searchSeconds` of the nominal boundary so cuts
 * land in pauses rather than mid-word. Returns [start, end) pairs in seconds.
 */
export function planTranscriptionPieces(
  profile: RmsProfile,
  duration: number,
  targetSeconds = 300,
  searchSeconds = 10,
): Array<readonly [number, number]> {
  const pieces: Array<readonly [number, number]> = [];
  let start = 0;
  while (duration - start > targetSeconds * 1.2) {
    const nominal = start + targetSeconds;
    const window = rmsSlice(profile, nominal - searchSeconds, nominal + searchSeconds);
    const firstFrame = Math.max(0, Math.floor((nominal - searchSeconds) / profile.frameSeconds));
    let quietest = 0;
    for (let index = 1; index < window.length; index += 1) {
      if (window[index] < window[quietest]) quietest = index;
    }
    const cut = window.length > 0 ? (firstFrame + quietest + 0.5) * profile.frameSeconds : nominal;
    pieces.push([start, cut]);
    start = cut;
  }
  if (duration > start) pieces.push([start, duration]);
  return pieces;
}
