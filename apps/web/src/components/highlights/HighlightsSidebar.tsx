/**
 * Left column of the AI Highlights page: source video, options, the big
 * "find highlights" button and staged progress with cancel.
 */
import type { JSX, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Cpu, FolderOpen, Loader2, ShieldCheck, Sparkles, Wand2, X } from "@/icons/lucide-compat";
import { readLocalBytes } from "../create/desktop-files";
import { useLocalFileUrl } from "../create/local-media";
import type { AnalysisStage, TranscriptLanguage } from "../../services/highlights/analyze";
import type { HighlightEngine, HighlightLength } from "../../services/highlights/types";
import { type ClipCount, useHighlightsStore } from "./highlights-store";

export type OpenAiAvailability = "hidden" | "no-key" | "ready";

const LENGTHS: { id: HighlightLength; key: string }[] = [
  { id: "short", key: "lengthShort" },
  { id: "medium", key: "lengthMedium" },
  { id: "long", key: "lengthLong" },
];
const COUNTS: ClipCount[] = [3, 5, 10];
const LANGUAGES: { id: TranscriptLanguage; key: string }[] = [
  { id: "auto", key: "languageAuto" },
  { id: "zh", key: "languageZh" },
  { id: "en", key: "languageEn" },
  { id: "ja", key: "languageJa" },
];

function Segment<T extends string | number>(props: {
  label: string;
  value: T;
  options: { id: T; label: string; disabled?: boolean; icon?: JSX.Element }[];
  onChange: (value: T) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="fc-label">{props.label}</div>
      <div className="fc-segment" role="group" aria-label={props.label}>
        {props.options.map((option) => (
          <button
            key={String(option.id)}
            type="button"
            aria-pressed={props.value === option.id}
            disabled={props.disabled || option.disabled}
            className="disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => props.onChange(option.id)}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function stageText(stage: AnalysisStage | null, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!stage) return t("highlights.progress.audio");
  switch (stage.stage) {
    case "audio":
      return t("highlights.progress.audio");
    case "model":
      return t("highlights.progress.model", { percent: Math.round(stage.progress * 100) });
    case "transcribe":
      return t("highlights.progress.transcribe", { percent: Math.round(stage.progress * 100) });
    case "analyze":
      return t("highlights.progress.analyze");
  }
}

/** Overall bar: audio 0–5 %, transcription 5–90 %, analysis 90–100 %. */
function stageFraction(stage: AnalysisStage | null): number {
  if (!stage || stage.stage === "audio") return 0.03;
  if (stage.stage === "model") return 0.05;
  if (stage.stage === "transcribe") return 0.05 + stage.progress * 0.85;
  return 0.95;
}

export interface HighlightsSidebarProps {
  readonly previewRef: RefObject<HTMLVideoElement | null>;
  readonly onPick: () => void;
  readonly onRun: () => void;
  readonly onCancel: () => void;
  readonly running: boolean;
  readonly stage: AnalysisStage | null;
  readonly openai: OpenAiAvailability;
  readonly hasResult: boolean;
  readonly onPreviewSize: (size: { width: number; height: number }) => void;
}

export function HighlightsSidebar(props: HighlightsSidebarProps): JSX.Element {
  const { t } = useTranslation();
  const source = useHighlightsStore((state) => state.source);
  const length = useHighlightsStore((state) => state.length);
  const count = useHighlightsStore((state) => state.count);
  const engine = useHighlightsStore((state) => state.engine);
  const language = useHighlightsStore((state) => state.language);
  const patch = useHighlightsStore((state) => state.patch);
  const { url } = useLocalFileUrl(source?.path ?? null, source ? readLocalBytes : null);
  const busy = props.running;

  const engines: { id: HighlightEngine; label: string; disabled?: boolean; icon: JSX.Element }[] = [
    { id: "local", label: t("highlights.options.engineLocal"), icon: <Cpu size={14} aria-hidden /> },
    {
      id: "openai",
      label: t("highlights.options.engineOpenai"),
      disabled: props.openai !== "ready",
      icon: <Wand2 size={14} aria-hidden />,
    },
  ];

  return (
    <div className="fc-scroll flex h-full flex-col gap-5 overflow-y-auto p-5">
      <div className="flex flex-col gap-2">
        <div className="fc-label">{t("highlights.source.label")}</div>
        {source && url ? (
          <div className="flex flex-col gap-2">
            <video
              ref={props.previewRef}
              src={url}
              controls
              preload="metadata"
              className="aspect-video w-full rounded-[10px] border border-border bg-[var(--stage-bg)] object-contain"
              onLoadedMetadata={(event) =>
                props.onPreviewSize({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })
              }
            />
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-2" title={source.path}>
                {source.name}
              </span>
              <button type="button" className="fc-action" disabled={busy} onClick={props.onPick}>
                <FolderOpen size={14} aria-hidden />
                {t("highlights.source.change")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="fc-drop !aspect-video" disabled={busy} onClick={props.onPick}>
            {source ? <Loader2 size={26} className="animate-spin" aria-hidden /> : <FolderOpen size={26} aria-hidden />}
            <span className="text-[13.5px] font-semibold text-fg">{t("highlights.source.pick")}</span>
            <span className="text-[11.5px]">{t("highlights.source.hint")}</span>
          </button>
        )}
      </div>

      <Segment
        label={t("highlights.options.length")}
        value={length}
        options={LENGTHS.map(({ id, key }) => ({ id, label: t(`highlights.options.${key}`) }))}
        onChange={(value) => patch({ length: value })}
        disabled={busy}
      />
      <Segment
        label={t("highlights.options.count")}
        value={count}
        options={COUNTS.map((id) => ({ id, label: t("highlights.options.countValue", { count: id }) }))}
        onChange={(value) => patch({ count: value })}
        disabled={busy}
      />
      <Segment
        label={t("highlights.options.language")}
        value={language}
        options={LANGUAGES.map(({ id, key }) => ({ id, label: t(`highlights.options.${key}`) }))}
        onChange={(value) => patch({ language: value })}
        disabled={busy}
      />
      {props.openai !== "hidden" && (
        <div className="flex flex-col gap-2">
          <Segment
            label={t("highlights.options.engine")}
            value={engine}
            options={engines}
            onChange={(value) => patch({ engine: value })}
            disabled={busy}
          />
          {props.openai === "no-key" && <p className="text-[11.5px] leading-relaxed text-fg-3">{t("highlights.options.openaiNoKey")}</p>}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-3">
        {busy ? (
          <div className="fc-card flex flex-col gap-3 p-4" role="status" aria-live="polite">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-fg">
              <Loader2 size={15} className="animate-spin" aria-hidden />
              <span className="flex-1">{stageText(props.stage, t)}</span>
              <button type="button" className="fc-action fc-action--danger !h-7" onClick={props.onCancel}>
                <X size={13} aria-hidden />
                {t("highlights.cancel")}
              </button>
            </div>
            <div className="fc-progress-track">
              <div className="fc-progress-bar" style={{ width: `${Math.round(stageFraction(props.stage) * 100)}%` }} />
            </div>
          </div>
        ) : (
          <button type="button" className="fc-generate flex items-center justify-center gap-2" disabled={!source} onClick={props.onRun}>
            <Sparkles size={18} aria-hidden />
            {props.hasResult ? t("highlights.rerun") : t("highlights.run")}
          </button>
        )}
        <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-fg-3">
          <ShieldCheck size={13} className="mt-[2px] shrink-0" aria-hidden />
          {engine === "openai" && props.openai === "ready" ? t("highlights.privacy.openai") : t("highlights.privacy.local")}
        </p>
      </div>
    </div>
  );
}
