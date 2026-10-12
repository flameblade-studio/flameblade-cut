/**
 * Caption clip data helpers: which text clips are captions, how bilingual
 * text is composed, and the SRT / plain-transcript exports.
 *
 * Caption clips are text clips on a captions track (role "captions" or the
 * legacy name "Captions") or tagged with `metadata.captionSource` — the same
 * selection the store's `exportSRT` uses. Metadata keys written by the
 * caption tools:
 *
 * - `captionOriginal`: the caption's own-language line when a translation is
 *   shown under it (the clip text is then `original + "\n" + translation`).
 * - `captionTranslation`, `captionTranslationLanguage`: the second line.
 * - `captionSpokenText`: the line as spoken, punctuation kept (transcripts).
 * - `captionWords` / `captionHighlightColor`: word timing and highlight
 *   colour, read by `@openreel/core` `caption-word-highlight`.
 */
import { exportSRT, type ClipMetadata, type Project, type TextClip } from "@openreel/core";

export const CAPTION_ORIGINAL_KEY = "captionOriginal";
export const CAPTION_TRANSLATION_KEY = "captionTranslation";
export const CAPTION_TRANSLATION_LANGUAGE_KEY = "captionTranslationLanguage";
export const CAPTION_SPOKEN_TEXT_KEY = "captionSpokenText";

export function captionTrackIds(project: Project): Set<string> {
  return new Set(
    project.timeline.tracks
      .filter((track) => track.role === "captions" || track.name === "Captions")
      .map((track) => track.id),
  );
}

export function selectCaptionClips(project: Project, textClips: readonly TextClip[]): TextClip[] {
  const trackIds = captionTrackIds(project);
  return textClips
    .filter(
      (clip) => trackIds.has(clip.trackId) || typeof clip.metadata?.captionSource === "string",
    )
    .sort((left, right) => left.startTime - right.startTime);
}

function metadataString(metadata: ClipMetadata | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

/** The caption's own-language text (without a translation line). */
export function captionOriginalText(clip: Pick<TextClip, "text" | "metadata">): string {
  return metadataString(clip.metadata, CAPTION_ORIGINAL_KEY) ?? clip.text;
}

export function hasTranslation(clip: Pick<TextClip, "metadata">): boolean {
  return metadataString(clip.metadata, CAPTION_TRANSLATION_KEY) !== null;
}

/** Text and metadata for a caption shown with `translation` as its second line. */
export function withTranslation(
  clip: Pick<TextClip, "text" | "metadata">,
  translation: string,
  language: string,
): { text: string; metadata: ClipMetadata } {
  const original = captionOriginalText(clip);
  return {
    text: `${original}\n${translation}`,
    metadata: {
      ...clip.metadata,
      [CAPTION_ORIGINAL_KEY]: original,
      [CAPTION_TRANSLATION_KEY]: translation,
      [CAPTION_TRANSLATION_LANGUAGE_KEY]: language,
    },
  };
}

/** Text and metadata with the translation line removed. */
export function withoutTranslation(clip: Pick<TextClip, "text" | "metadata">): {
  text: string;
  metadata: ClipMetadata;
} {
  const metadata: Record<string, unknown> = { ...clip.metadata };
  delete metadata[CAPTION_ORIGINAL_KEY];
  delete metadata[CAPTION_TRANSLATION_KEY];
  delete metadata[CAPTION_TRANSLATION_LANGUAGE_KEY];
  return { text: captionOriginalText(clip), metadata };
}

/** Replaces the own-language line, keeping any translation line. */
export function withOriginalText(
  clip: Pick<TextClip, "text" | "metadata">,
  original: string,
): { text: string; metadata: ClipMetadata } {
  const translation = metadataString(clip.metadata, CAPTION_TRANSLATION_KEY);
  if (translation === null) return { text: original, metadata: { ...clip.metadata } };
  return {
    text: `${original}\n${translation}`,
    metadata: { ...clip.metadata, [CAPTION_ORIGINAL_KEY]: original },
  };
}

/** SRT for caption clips; bilingual captions export both lines. */
export function captionsToSrt(clips: readonly TextClip[]): string {
  const subtitles = clips
    .filter((clip) => clip.text.trim().length > 0)
    .map((clip) => ({
      id: clip.id,
      text: clip.text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n"),
      startTime: clip.startTime,
      endTime: clip.startTime + clip.duration,
    }));
  const srt = exportSRT(subtitles);
  return srt.endsWith("\n") ? srt : `${srt}\n`;
}

const WIDE = /[⺀-鿿가-힯豈-﫿＀-￯]/;

/**
 * Plain-text transcript with punctuation: spoken text of each caption,
 * joined without spaces between CJK lines and with a space between Latin
 * lines; a pause of `paragraphGap` seconds or more starts a new paragraph.
 */
export function captionsToTranscript(clips: readonly TextClip[], paragraphGap = 2): string {
  const paragraphs: string[] = [];
  let current = "";
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (const clip of clips) {
    const text = (metadataString(clip.metadata, CAPTION_SPOKEN_TEXT_KEY) ?? captionOriginalText(clip))
      .replace(/\s*\n\s*/g, " ")
      .trim();
    if (!text) continue;
    if (current && clip.startTime - previousEnd >= paragraphGap) {
      paragraphs.push(current);
      current = "";
    }
    const joinWithoutSpace = current === "" || (WIDE.test(current.slice(-1)) && WIDE.test(text[0]));
    current += joinWithoutSpace ? text : ` ${text}`;
    previousEnd = clip.startTime + clip.duration;
  }
  if (current) paragraphs.push(current);
  return paragraphs.length > 0 ? `${paragraphs.join("\n\n")}\n` : "";
}
