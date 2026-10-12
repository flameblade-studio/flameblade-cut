/**
 * One highlight: a preview that plays only [start, end], title, length, score,
 * reasons, ±1 s nudges for both edges and a selection checkbox.
 */
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Minus, Pause, Play, Plus } from "@/icons/lucide-compat";
import { formatTimestamp } from "../../services/highlights/transcript";
import type { HighlightClip } from "../../services/highlights/types";

const MIN_CLIP_SECONDS = 1;

export interface HighlightCardProps {
  readonly clip: HighlightClip;
  readonly rank: number;
  readonly videoUrl: string | null;
  readonly duration: number;
  readonly selected: boolean;
  readonly onToggle: () => void;
  readonly onChangeRange: (start: number, end: number) => void;
}

function scoreTone(score: number): string {
  if (score >= 80) return "fc-chip fc-chip--flame";
  if (score >= 60) return "fc-chip fc-chip--gold";
  return "fc-chip";
}

function EdgeControl(props: {
  label: string;
  value: number;
  earlierLabel: string;
  laterLabel: string;
  canEarlier: boolean;
  canLater: boolean;
  onNudge: (delta: number) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-9 text-[11.5px] font-semibold text-fg-3">{props.label}</span>
      <button type="button" className="fc-action !h-7 !px-2" aria-label={`${props.label} ${props.earlierLabel}`} disabled={!props.canEarlier} onClick={() => props.onNudge(-1)}>
        <Minus size={12} aria-hidden />
      </button>
      <span className="w-[66px] text-center font-mono text-[12.5px] tabular-nums text-fg">{formatTimestamp(props.value)}</span>
      <button type="button" className="fc-action !h-7 !px-2" aria-label={`${props.label} ${props.laterLabel}`} disabled={!props.canLater} onClick={() => props.onNudge(1)}>
        <Plus size={12} aria-hidden />
      </button>
    </div>
  );
}

export function HighlightCard(props: HighlightCardProps): JSX.Element {
  const { t } = useTranslation();
  const { clip } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const length = clip.end - clip.start;

  // Show the first frame of the range whenever the range or source changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !props.videoUrl) return;
    const seek = (): void => {
      video.currentTime = clip.start;
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
    return () => video.removeEventListener("loadedmetadata", seek);
  }, [clip.start, props.videoUrl]);

  const togglePlay = (): void => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (video.currentTime < clip.start || video.currentTime >= clip.end - 0.05) video.currentTime = clip.start;
    void video.play().catch((error: unknown) => console.warn("[highlights] preview playback failed", error));
  };

  const nudgeStart = (delta: number): void =>
    props.onChangeRange(Math.max(0, Math.min(clip.end - MIN_CLIP_SECONDS, clip.start + delta)), clip.end);
  const nudgeEnd = (delta: number): void =>
    props.onChangeRange(clip.start, Math.min(props.duration, Math.max(clip.start + MIN_CLIP_SECONDS, clip.end + delta)));


  return (
    <article className="fc-card grid grid-cols-[minmax(0,240px)_minmax(0,1fr)] gap-0" data-active={props.selected}>
      <div className="fc-stage relative aspect-video self-stretch">
        {props.videoUrl && (
          <video
            ref={videoRef}
            src={props.videoUrl}
            preload="metadata"
            playsInline
            className="absolute inset-0 h-full w-full object-contain"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => {
              const video = event.currentTarget;
              if (video.currentTime >= clip.end) {
                video.pause();
                video.currentTime = clip.start;
              }
            }}
          />
        )}
        <button
          type="button"
          aria-label={playing ? t("highlights.card.pause") : t("highlights.card.play")}
          className="absolute inset-0 grid place-items-center opacity-90 transition-opacity hover:opacity-100"
          onClick={togglePlay}
        >
          <span className="grid h-11 w-11 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
            {playing ? <Pause size={18} aria-hidden /> : <Play size={18} className="ml-0.5" aria-hidden />}
          </span>
        </button>
        <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-bold text-white">#{props.rank}</span>
      </div>

      <div className="flex min-w-0 flex-col gap-2.5 p-4">
        <div className="flex items-start gap-3">
          <h3 className="min-w-0 flex-1 text-[14.5px] font-bold leading-snug text-fg">{clip.title}</h3>
          <span className={scoreTone(clip.score)}>{t("highlights.card.score", { score: clip.score })}</span>
          <button
            type="button"
            role="checkbox"
            aria-checked={props.selected}
            aria-label={t("highlights.card.select")}
            onClick={props.onToggle}
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors ${
              props.selected ? "border-transparent text-white" : "border-border-strong text-transparent hover:border-[var(--accent)]"
            }`}
            style={props.selected ? { background: "var(--flame-gradient)" } : undefined}
          >
            <Check size={14} aria-hidden />
          </button>
        </div>
        {clip.hook && clip.hook !== clip.title && <p className="line-clamp-2 text-[12.5px] leading-relaxed text-fg-2">「{clip.hook}」</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="fc-chip">{t("highlights.card.seconds", { seconds: Math.round(length) })}</span>
          {clip.reasonCodes.map((code) => (
            <span key={code} className="fc-chip">
              {t(`highlights.card.reasons.${code}`)}
            </span>
          ))}
        </div>
        {clip.reasonText && <p className="text-[12px] leading-relaxed text-fg-3">{clip.reasonText}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1">
          <EdgeControl
            label={t("highlights.card.start")}
            value={clip.start}
            earlierLabel={t("highlights.card.earlier")}
            laterLabel={t("highlights.card.later")}
            canEarlier={clip.start > 0}
            canLater={clip.start + MIN_CLIP_SECONDS < clip.end}
            onNudge={nudgeStart}
          />
          <EdgeControl
            label={t("highlights.card.end")}
            value={clip.end}
            earlierLabel={t("highlights.card.earlier")}
            laterLabel={t("highlights.card.later")}
            canEarlier={clip.end - MIN_CLIP_SECONDS > clip.start}
            canLater={clip.end < props.duration}
            onNudge={nudgeEnd}
          />
        </div>
      </div>
    </article>
  );
}
