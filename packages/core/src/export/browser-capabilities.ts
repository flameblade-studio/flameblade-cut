import { CODEC_MAP, type VideoExportSettings } from "./types";
import type { Project } from "../types/project";

type MediaBunnyModule = typeof import("mediabunny");

/**
 * Stable codes for browser export problems. The UI translates by code; the
 * English `reason`/`message` text stays for logs and older callers.
 */
export type BrowserExportCapabilityErrorCode =
  | "desktopEncoderRequired"
  | "codecUnsupportedInContainer"
  | "videoEncodeUnsupported"
  | "audioEncodeUnsupported"
  | "checkFailed";

export type ExportValidationErrorCode = "emptyTimeline" | "invalidDimensions" | "invalidFrameRate" | "invalidBitrate";

/** Values a translated message may interpolate. */
export type ExportErrorParams = Readonly<Record<string, string | number>>;

export interface BrowserExportCapability {
  supported: boolean;
  reason: string | null;
  reasonCode?: BrowserExportCapabilityErrorCode;
  reasonParams?: ExportErrorParams;
  audioCodec?: string;
}

export interface ExportValidationIssue {
  code: ExportValidationErrorCode;
  message: string;
}

export function getVideoExportValidationIssue(settings: VideoExportSettings, duration: number): ExportValidationIssue | null {
  if (!Number.isFinite(duration) || duration <= 0) return { code: "emptyTimeline", message: "Add a clip, text, or graphics to the timeline before exporting." };
  if (![settings.width, settings.height].every((value) => Number.isInteger(value) && value > 0)) return { code: "invalidDimensions", message: "Choose a valid width and height for your video." };
  if (!Number.isFinite(settings.frameRate) || settings.frameRate <= 0) return { code: "invalidFrameRate", message: "Choose a valid frame rate for your video." };
  if (!Number.isFinite(settings.bitrate) || settings.bitrate <= 0) return { code: "invalidBitrate", message: "Choose a valid video bitrate." };
  return null;
}

export function getVideoExportValidationError(settings: VideoExportSettings, duration: number): string | null {
  return getVideoExportValidationIssue(settings, duration)?.message ?? null;
}

function unsupported(reasonCode: BrowserExportCapabilityErrorCode, reason: string, reasonParams?: ExportErrorParams): BrowserExportCapability {
  return reasonParams ? { supported: false, reason, reasonCode, reasonParams } : { supported: false, reason, reasonCode };
}

/** Check the originals, even when preview playback uses a proxy. */
export function getMissingExportMedia(project: Project): string[] {
  const referenced = new Set(project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.mediaId)));
  return [...referenced].flatMap((id) => {
    const item = project.mediaLibrary.items.find((candidate) => candidate.id === id);
    if (!item) return [id];
    if (["video", "audio", "image"].includes(item.type) && (!item.blob || item.isPlaceholder)) return [item.name || id];
    return [];
  });
}

/** Probe the selected codec and container, without silently changing the video codec. */
export async function checkBrowserExportCapability(
  settings: VideoExportSettings,
  mediaBunny?: MediaBunnyModule,
  includeAudio = true,
): Promise<BrowserExportCapability> {
  if (settings.codec === "prores" || (settings.colorDepth ?? 8) > 8 || (settings.pixelFormat && settings.pixelFormat !== "yuv420")) {
    return unsupported("desktopEncoderRequired", "ProRes, transparency, and high bit depth export require the desktop encoder. Choose H.264 for browser export.");
  }
  try {
    const library = mediaBunny ?? await import("mediabunny");
    const format = settings.format === "webm" ? new library.WebMOutputFormat() : settings.format === "mov" ? new library.MovOutputFormat() : new library.Mp4OutputFormat();
    const codec = CODEC_MAP[settings.codec];
    if (!format.getSupportedVideoCodecs().includes(codec)) {
      const params = { codec: settings.codec.toUpperCase(), format: settings.format.toUpperCase() };
      return unsupported("codecUnsupportedInContainer", `${params.codec} cannot be exported in ${params.format}. Choose VP9 for WebM or H.264 for MP4.`, params);
    }
    const video = await library.getFirstEncodableVideoCodec([codec], {
      width: settings.width, height: settings.height, bitrate: settings.bitrate * 1000,
    });
    if (video !== codec) {
      const params = { codec: settings.codec.toUpperCase(), width: settings.width, height: settings.height };
      return unsupported("videoEncodeUnsupported", `This browser cannot encode ${params.codec} at ${params.width}×${params.height}. Try H.264 / MP4, VP9 / WebM, or a smaller resolution.`, params);
    }
    if (!includeAudio) return { supported: true, reason: null };
    const audioCodec = await library.getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), {
      numberOfChannels: settings.audioSettings.channels,
      sampleRate: settings.audioSettings.sampleRate,
      bitrate: settings.audioSettings.bitrate * 1000,
    });
    if (!audioCodec) {
      const params = { format: settings.format.toUpperCase() };
      return unsupported("audioEncodeUnsupported", `This browser cannot encode audio for ${params.format}. Try WebM with Opus audio or another browser.`, params);
    }
    return { supported: true, reason: null, audioCodec };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "encoder unavailable";
    return unsupported("checkFailed", `Could not check browser export support: ${detail}`, { detail });
  }
}
