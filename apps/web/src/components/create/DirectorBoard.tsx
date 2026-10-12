import type { JSX } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clapperboard,
  Loader2,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  Scissors,
  Square,
  Trash2,
} from "@/icons/lucide-compat";
import {
  GENERATION_ASPECTS,
  GENERATION_DURATIONS,
  type GenerationAspect,
  type GenerationRecord,
  type StoryboardShot,
} from "../../services/ltx/types";
import { estimateSeconds } from "../../services/ltx/workflow-binder";
import { pendingStoryboardShots, useGenerationStore, type PreparedPrompt } from "../../stores/generation-store";
import { useCreateDraft } from "./draft-store";
import { DownloadProgress, TranslationSettings, translateOrToast, useEffectiveEngine } from "./PromptTranslation";
import { pickImage, readLocalBytes } from "./desktop-files";
import { formatEstimate } from "./format";
import { ImageSlot } from "./ImageSlot";
import { useLocalFileUrl } from "./local-media";

const ASPECT_ICON: Record<GenerationAspect, typeof Square> = {
  "16:9": RectangleHorizontal,
  "9:16": RectangleVertical,
  "1:1": Square,
};

function shotRecord(shot: StoryboardShot, records: readonly GenerationRecord[]): GenerationRecord | undefined {
  return shot.recordId ? records.find((record) => record.id === shot.recordId) : undefined;
}

function ShotPreview({ record }: { record: GenerationRecord | undefined }): JSX.Element {
  const { t } = useTranslation();
  const { url } = useLocalFileUrl(record?.status === "done" ? record.outputPath : null, readLocalBytes);
  if (url) return <video className="h-full w-full bg-black object-contain" src={url} controls preload="metadata" playsInline />;
  if (!record) return <Clapperboard size={20} className="text-fg-muted" aria-hidden />;
  if (record.status === "failed" || record.status === "canceled") {
    return <span className="px-3 text-center text-[11.5px] text-fg-3">{t(`create.status.${record.status}`)}</span>;
  }
  return (
    <span className="flex flex-col items-center gap-2 text-[11.5px] font-semibold text-fg-2">
      <Loader2 size={18} className="animate-spin text-[var(--gold)]" aria-hidden />
      {record.status === "running" && record.progress > 0
        ? t("create.status.running", { percent: Math.round(record.progress * 100) })
        : t("create.status.runningUnknown")}
    </span>
  );
}

function ShotCard({ shot, index, count, record }: { shot: StoryboardShot; index: number; count: number; record: GenerationRecord | undefined }): JSX.Element {
  const { t } = useTranslation();
  const updateShot = useGenerationStore((state) => state.updateShot);
  const removeShot = useGenerationStore((state) => state.removeShot);
  const moveShot = useGenerationStore((state) => state.moveShot);
  const aspect = useGenerationStore((state) => state.storyboard.aspect);
  const done = record?.status === "done";
  return (
    <article className="fc-card grid grid-cols-[minmax(0,1fr)_260px] gap-4 p-4">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="fc-chip fc-chip--flame">{t("create.director.shot", { index: index + 1 })}</span>
          {done ? <CheckCircle2 size={15} className="text-[var(--ok)]" aria-hidden /> : null}
          <div className="ml-auto flex items-center gap-1">
            <button type="button" className="fc-action !h-7 !px-2" disabled={index === 0} onClick={() => moveShot(shot.id, index - 1)} aria-label={t("create.director.moveUp")}>
              <ArrowUp size={13} aria-hidden />
            </button>
            <button type="button" className="fc-action !h-7 !px-2" disabled={index === count - 1} onClick={() => moveShot(shot.id, index + 1)} aria-label={t("create.director.moveDown")}>
              <ArrowDown size={13} aria-hidden />
            </button>
            <button type="button" className="fc-action fc-action--danger !h-7 !px-2" onClick={() => removeShot(shot.id)} aria-label={t("create.director.removeShot")}>
              <Trash2 size={13} aria-hidden />
            </button>
          </div>
        </div>
        <textarea
          className="fc-input min-h-[96px] resize-y"
          placeholder={t("create.director.shotPlaceholder")}
          value={shot.prompt}
          maxLength={4000}
          onChange={(event) => updateShot(shot.id, { prompt: event.target.value })}
        />
        <div className="flex items-end gap-3">
          <div className="w-[120px]">
            <ImageSlot
              label={t("create.director.startImage")}
              image={shot.image}
              onPick={() => {
                void pickImage().then((image) => {
                  if (image) updateShot(shot.id, { image });
                });
              }}
              onClear={() => updateShot(shot.id, { image: null })}
            />
          </div>
          <div className="flex-1">
            <div className="fc-label mb-2">{t("create.form.duration")}</div>
            <div className="fc-segment">
              {GENERATION_DURATIONS.map((value) => (
                <button key={value} type="button" aria-pressed={shot.durationSec === value} onClick={() => updateShot(shot.id, { durationSec: value })}>
                  {t("create.form.seconds", { count: value })}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className={`fc-stage self-start overflow-hidden rounded-[12px] ${aspect === "16:9" ? "aspect-video" : aspect === "9:16" ? "aspect-[9/16]" : "aspect-square"}`}>
        <ShotPreview record={record} />
      </div>
    </article>
  );
}

/** Centre of the director tab: the editable shot list. */
export function DirectorBoard(): JSX.Element {
  const { t } = useTranslation();
  const shots = useGenerationStore((state) => state.storyboard.shots);
  const records = useGenerationStore((state) => state.records);
  const addShot = useGenerationStore((state) => state.addShot);
  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-4 px-6 py-6">
      <header>
        <h2 className="text-[20px] font-bold tracking-wide text-fg">{t("create.director.title")}</h2>
        <p className="mt-1 text-[13px] text-fg-3">{t("create.director.subtitle")}</p>
      </header>
      {shots.length === 0 ? (
        <div className="fc-card flex flex-col items-center gap-2 px-8 py-12 text-center">
          <Clapperboard size={30} className="text-[var(--gold)]" aria-hidden />
          <h3 className="text-[16px] font-semibold text-fg">{t("create.director.emptyTitle")}</h3>
          <p className="max-w-[520px] text-[13px] leading-relaxed text-fg-3">{t("create.director.emptyBody")}</p>
        </div>
      ) : (
        shots.map((shot, index) => <ShotCard key={shot.id} shot={shot} index={index} count={shots.length} record={shotRecord(shot, records)} />)
      )}
      <button type="button" className="fc-action mx-auto !h-10 !px-5" onClick={() => addShot()}>
        <Plus size={15} aria-hidden />
        {t("create.director.addShot")}
      </button>
      <p className="text-center text-[12px] text-fg-muted">{t("create.director.tip")}</p>
    </div>
  );
}

/** Left column of the director tab: shared format and the "generate all" button. */
export function DirectorSidebar({ onSendAll }: { onSendAll: (records: GenerationRecord[]) => void }): JSX.Element {
  const { t } = useTranslation();
  const storyboard = useGenerationStore((state) => state.storyboard);
  const records = useGenerationStore((state) => state.records);
  const setFormat = useGenerationStore((state) => state.setStoryboardFormat);
  const generateStoryboard = useGenerationStore((state) => state.generateStoryboard);
  const shots = storyboard.shots;
  const shotRecords = shots.map((shot) => shotRecord(shot, records));
  const finished = shotRecords.filter((record): record is GenerationRecord => record?.status === "done");
  const pending = shots.filter((_, index) => {
    const status = shotRecords[index]?.status;
    return status === undefined || status === "failed" || status === "canceled";
  });
  const writable = pending.filter((shot) => shot.prompt.trim() !== "");
  const totalSeconds = shots.reduce((sum, shot) => sum + shot.durationSec, 0);
  const estimate = writable.reduce(
    (sum, shot) =>
      sum +
      estimateSeconds({ quality: storyboard.quality, durationSec: shot.durationSec }, { warm: true }),
    0,
  );
  const allDone = shots.length > 0 && finished.length === shots.length;
  const autoTranslate = useCreateDraft((state) => state.autoTranslate);
  const engine = useEffectiveEngine();
  const [translating, setTranslating] = useState(false);

  /** Translates every pending shot first; one failure sends nothing. */
  const generateAll = async (): Promise<void> => {
    if (!autoTranslate) {
      generateStoryboard();
      return;
    }
    setTranslating(true);
    try {
      const { storyboard: current, records: latest } = useGenerationStore.getState();
      const prepared: Record<string, PreparedPrompt> = {};
      for (const shot of pendingStoryboardShots(current, latest)) {
        const translation = await translateOrToast(shot.prompt, engine, t);
        if (!translation) return;
        prepared[shot.id] = {
          prompt: translation.english,
          promptOriginal: translation.engine === null ? null : translation.original,
        };
      }
      generateStoryboard(prepared);
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="fc-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-4 pt-5">
        <section className="flex flex-col gap-2">
          <h3 className="fc-label">{t("create.form.aspect")}</h3>
          <div className="fc-segment">
            {GENERATION_ASPECTS.map((value) => {
              const Icon = ASPECT_ICON[value];
              return (
                <button key={value} type="button" aria-pressed={storyboard.aspect === value} onClick={() => setFormat({ aspect: value })}>
                  <Icon size={14} aria-hidden />
                  {value}
                </button>
              );
            })}
          </div>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="fc-label">{t("create.form.quality")}</h3>
          <div className="fc-segment">
            <button type="button" aria-pressed={storyboard.quality === "480p"} onClick={() => setFormat({ quality: "480p" })}>
              {t("create.form.quality480")}
            </button>
            <button type="button" aria-pressed={storyboard.quality === "720p"} onClick={() => setFormat({ quality: "720p" })}>
              {t("create.form.quality720")}
            </button>
          </div>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="fc-label">{t("create.form.prompt")}</h3>
          <TranslationSettings hasChinese={null} />
        </section>
        <section className="rounded-[12px] border border-border bg-bg/60 px-4 py-3 text-[12.5px] text-fg-2">
          {t("create.director.total", { count: shots.length, seconds: totalSeconds })}
          {allDone ? (
            <div className="mt-1.5 flex items-center gap-1.5 font-semibold text-[var(--ok)]">
              <CheckCircle2 size={14} aria-hidden />
              {t("create.director.allDone")}
            </div>
          ) : null}
        </section>
      </div>
      <footer className="flex flex-col gap-2.5 border-t border-border px-5 pb-5 pt-3">
        {writable.length > 0 ? <div className="text-[11.5px] font-semibold text-fg-2">{formatEstimate(estimate, t)}</div> : null}
        <DownloadProgress active={translating && engine === "local"} />
        <button type="button" className="fc-generate" disabled={writable.length === 0 || translating} onClick={() => void generateAll()}>
          {translating
            ? t("create.translate.translating")
            : finished.length > 0 && writable.length > 0
            ? t("create.director.generateRemaining", { count: writable.length })
            : t("create.director.generateAll")}
        </button>
        <button type="button" className="fc-action !h-10 justify-center" disabled={finished.length === 0} onClick={() => onSendAll(finished)}>
          <Scissors size={14} aria-hidden />
          {t("create.director.sendAll")}
        </button>
      </footer>
    </div>
  );
}
