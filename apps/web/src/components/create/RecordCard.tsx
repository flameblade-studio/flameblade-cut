import type { JSX } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Copy,
  Download,
  FastForward,
  FolderOpen,
  Loader2,
  RotateCcw,
  Scissors,
  Trash2,
  X,
} from "@/icons/lucide-compat";
import { modelErrorKind } from "../../services/ltx/model-choice";
import type { GenerationRecord } from "../../services/ltx/types";
import { estimateSeconds } from "../../services/ltx/workflow-binder";
import { toast } from "../../stores/notification-store";
import { readLocalBytes, revealInFolder, saveCopyAs } from "./desktop-files";
import { promptPatch, useCreateDraft } from "./draft-store";
import { formatCreatedAt, formatDuration } from "./format";
import { useLocalFileUrl } from "./local-media";

export interface RecordCardActions {
  onAddToEditor: (record: GenerationRecord) => void;
  onExtend: (record: GenerationRecord) => void;
  onRedo: (record: GenerationRecord) => void;
  onCancel: (record: GenerationRecord) => void;
  onDelete: (record: GenerationRecord) => void;
}

interface RecordCardProps extends RecordCardActions {
  record: GenerationRecord;
  /** Jobs ahead of this one in the queue (only meaningful while queued). */
  queuePosition: number;
  active: boolean;
}

const ASPECT_CLASS: Record<string, string> = {
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16] max-h-[520px]",
  "1:1": "aspect-square max-h-[520px]",
};

function useNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

function ProgressStage({ record, queuePosition }: { record: GenerationRecord; queuePosition: number }): JSX.Element {
  const { t } = useTranslation();
  const now = useNow(true);
  const startedMs = record.startedAt ? new Date(record.startedAt).getTime() : null;
  const elapsed = startedMs ? (now.getTime() - startedMs) / 1000 : 0;
  const estimate = estimateSeconds(record.request, { warm: true });
  const percent = Math.round(record.progress * 100);
  const label =
    record.status === "queued"
      ? queuePosition > 0
        ? t("create.status.queued", { count: queuePosition })
        : t("create.status.queuedNext")
      : record.status === "preparing"
        ? t("create.status.preparing")
        : record.status === "downloading"
          ? t("create.status.downloading")
          : record.progress > 0
            ? t("create.status.running", { percent })
            : t("create.status.runningUnknown");
  const shownPercent = record.status === "downloading" ? 100 : record.status === "running" ? Math.max(4, percent) : 0;
  return (
    <div className="fc-shimmer absolute inset-0 flex flex-col items-center justify-center gap-4 px-10">
      <Loader2 size={26} className="animate-spin text-[var(--gold)]" aria-hidden />
      <div className="text-[14px] font-semibold text-fg">{label}</div>
      <div className="w-full max-w-[320px]">
        <div className="fc-progress-track">
          <div className="fc-progress-bar" style={{ width: `${shownPercent}%` }} />
        </div>
        {startedMs ? (
          <div className="mt-2 flex justify-between text-[11.5px] text-fg-3">
            <span>{t("create.status.elapsed", { time: formatDuration(elapsed, t) })}</span>
            {elapsed < estimate ? <span>{t("create.status.remaining", { time: formatDuration(estimate - elapsed, t) })}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ResultStage({ record }: { record: GenerationRecord }): JSX.Element {
  const { t } = useTranslation();
  const { url, error } = useLocalFileUrl(record.outputPath, readLocalBytes);
  if (error) {
    return (
      <div className="absolute inset-0 grid place-items-center px-8 text-center text-[12.5px] text-fg-3">
        {error}
      </div>
    );
  }
  if (!url) {
    return <Loader2 size={22} className="animate-spin text-fg-muted" aria-label={t("create.status.downloading")} />;
  }
  return <video className="absolute inset-0 h-full w-full bg-black object-contain" src={url} controls preload="auto" playsInline />;
}

function FailedStage({ record, onRedo }: { record: GenerationRecord; onRedo: () => void }): JSX.Element {
  const { t } = useTranslation();
  const canceled = record.status === "canceled";
  const modelError = modelErrorKind(record.error);
  const message = modelError === null ? record.error : t(`create.errors.model.${modelError}`);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-10 text-center">
      <AlertCircle size={26} className={canceled ? "text-fg-muted" : "text-[var(--error)]"} aria-hidden />
      <div className="text-[14px] font-semibold text-fg">{canceled ? t("create.status.canceled") : t("create.status.failed")}</div>
      {message && !canceled ? <p className="max-w-[460px] text-[12px] leading-relaxed text-fg-3">{message}</p> : null}
      <button type="button" className="fc-action" onClick={onRedo}>
        <RotateCcw size={14} aria-hidden />
        {t("create.actions.retry")}
      </button>
    </div>
  );
}

/** Shows the user's own prompt; `sent` is the English actually sent when it was translated. */
function PromptText({ prompt, sent }: { prompt: string; sent: string | null }): JSX.Element {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const patch = useCreateDraft((state) => state.patch);
  const long = prompt.length > 160;
  return (
    <div className="group relative">
      <p className={`whitespace-pre-wrap text-[13px] leading-relaxed text-fg ${expanded || !long ? "" : "line-clamp-3"}`}>{prompt}</p>
      <div className="mt-1.5 flex items-center gap-3 text-[11.5px] font-semibold text-fg-3">
        {sent !== null ? (
          <button
            type="button"
            className="fc-chip hover:text-fg"
            title={t("create.translate.sentTitle", { prompt: sent })}
            aria-label={t("create.translate.sentTitle", { prompt: sent })}
            onClick={() => {
              void navigator.clipboard.writeText(sent).then(() => toast.success(t("create.toast.copied")));
            }}
          >
            {t("create.translate.sentChip")}
          </button>
        ) : null}
        {long ? (
          <button type="button" className="hover:text-fg" onClick={() => setExpanded(!expanded)}>
            {expanded ? t("create.actions.less") : t("create.actions.more")}
          </button>
        ) : null}
        <button
          type="button"
          className="hover:text-fg"
          onClick={() => {
            void navigator.clipboard.writeText(prompt).then(() => toast.success(t("create.toast.copied")));
          }}
        >
          <Copy size={11} className="mr-1 inline" aria-hidden />
          {t("create.actions.copyPrompt")}
        </button>
        <button type="button" className="hover:text-fg" onClick={() => patch(promptPatch(prompt))}>
          {t("create.actions.usePrompt")}
        </button>
      </div>
    </div>
  );
}

export function RecordCard({ record, queuePosition, active, ...actions }: RecordCardProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const now = useNow(false);
  const inFlight = record.status === "queued" || record.status === "preparing" || record.status === "running" || record.status === "downloading";
  const done = record.status === "done" && record.outputPath !== null;
  const { request } = record;

  const saveAs = async (): Promise<void> => {
    if (!record.outputPath) return;
    try {
      const destination = await saveCopyAs(record.outputPath);
      if (destination) toast.success(t("create.toast.saved", { path: destination }));
    } catch (error) {
      toast.error(t("create.toast.saveFailed", { message: String(error) }));
    }
  };

  return (
    <article id={`record-${record.id}`} className="fc-card" data-active={active}>
      <header className="flex flex-wrap items-center gap-2 px-5 pt-4">
        <span className="text-[12px] font-semibold text-fg-2">{formatCreatedAt(record.createdAt, now, i18n.language, t)}</span>
        <span className="fc-chip fc-chip--flame">{t(`create.modes.${request.mode}`)}</span>
        <span className="fc-chip">{request.aspect}</span>
        {request.mode === "ref2v" ? (
          <span className="fc-chip">{t("create.form.referenceCount", { count: request.referenceImages.length })}</span>
        ) : (
          <span className="fc-chip">{request.quality}</span>
        )}
        <span className="fc-chip">{t("create.form.seconds", { count: request.durationSec })}</span>
        <span className="fc-chip fc-chip--gold">LTX-2.5</span>
      </header>
      <div className="px-5 pb-3 pt-3">
        <PromptText
          prompt={request.promptOriginal ?? request.prompt}
          sent={request.promptOriginal === null ? null : request.prompt}
        />
      </div>
      <div className="px-5">
        <div className={`fc-stage mx-auto w-full overflow-hidden rounded-[12px] ${ASPECT_CLASS[request.aspect] ?? "aspect-video"}`}>
          {inFlight ? <ProgressStage record={record} queuePosition={queuePosition} /> : null}
          {done ? <ResultStage record={record} /> : null}
          {record.status === "failed" || record.status === "canceled" ? (
            <FailedStage record={record} onRedo={() => actions.onRedo(record)} />
          ) : null}
        </div>
      </div>
      <footer className="flex flex-wrap items-center gap-2 px-5 pb-4 pt-3.5">
        {inFlight ? (
          <button type="button" className="fc-action fc-action--danger" onClick={() => actions.onCancel(record)}>
            <X size={14} aria-hidden />
            {t("create.actions.cancel")}
          </button>
        ) : (
          <>
            <button type="button" className="fc-action fc-action--primary" disabled={!done} onClick={() => actions.onAddToEditor(record)}>
              <Scissors size={14} aria-hidden />
              {t("create.actions.addToEditor")}
            </button>
            <button type="button" className="fc-action" disabled={!done} onClick={() => actions.onExtend(record)}>
              <FastForward size={14} aria-hidden />
              {t("create.actions.extend")}
            </button>
            <button type="button" className="fc-action" onClick={() => actions.onRedo(record)}>
              <RotateCcw size={14} aria-hidden />
              {t("create.actions.redo")}
            </button>
            <button type="button" className="fc-action" disabled={!done} onClick={() => void saveAs()}>
              <Download size={14} aria-hidden />
              {t("create.actions.saveAs")}
            </button>
            <button
              type="button"
              className="fc-action"
              disabled={!done}
              onClick={() => {
                if (record.outputPath) void revealInFolder(record.outputPath);
              }}
            >
              <FolderOpen size={14} aria-hidden />
              {t("create.actions.openFolder")}
            </button>
          </>
        )}
        <button
          type="button"
          className="fc-action fc-action--danger ml-auto"
          disabled={inFlight}
          onClick={() => actions.onDelete(record)}
          aria-label={t("create.actions.delete")}
          title={t("create.actions.delete")}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </footer>
    </article>
  );
}
