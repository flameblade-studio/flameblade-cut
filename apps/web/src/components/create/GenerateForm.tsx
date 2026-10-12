import type { JSX } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRight,
  ChevronDown,
  RectangleHorizontal,
  RectangleVertical,
  Sparkles,
  Square,
} from "@/icons/lucide-compat";
import {
  GENERATION_ASPECTS,
  GENERATION_DURATIONS,
  type GenerationAspect,
  type GenerationMode,
  type GenerationRecord,
} from "../../services/ltx/types";
import { estimateSeconds } from "../../services/ltx/workflow-binder";
import { useGenerationStore } from "../../stores/generation-store";
import { toast } from "../../stores/notification-store";
import { imageSize, pickImage } from "./desktop-files";
import { containsChinese } from "../../services/prompt-translation/segments";
import { draftProblem, draftToRequest, nearestAspect, translationPlan, useCreateDraft } from "./draft-store";
import { formatEstimate } from "./format";
import { ImageSlot } from "./ImageSlot";
import { DownloadProgress, EnglishPreview, TranslationSettings, translateOrToast, useEffectiveEngine } from "./PromptTranslation";
import { ReferenceImages } from "./ReferenceImages";

const ASPECT_ICON: Record<GenerationAspect, typeof Square> = {
  "16:9": RectangleHorizontal,
  "9:16": RectangleVertical,
  "1:1": Square,
};

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="fc-label">{label}</h3>
      {children}
    </section>
  );
}

function FrameInputs({ mode }: { mode: GenerationMode }): JSX.Element | null {
  const { t } = useTranslation();
  const draft = useCreateDraft();
  if (mode !== "i2v" && mode !== "flf2v") return null;

  const choose = async (slot: "firstImage" | "lastImage"): Promise<void> => {
    const image = await pickImage();
    if (!image) return;
    draft.patch({ [slot]: image });
    if (slot === "firstImage") {
      const size = await imageSize(image.path);
      draft.patch({ aspect: nearestAspect(size.width, size.height) });
    }
  };

  return (
    <Field label={t("create.form.image")}>
      <div className="flex items-start gap-2">
        <ImageSlot
          label={t("create.form.firstFrame")}
          image={draft.firstImage}
          onPick={() => void choose("firstImage")}
          onClear={() => draft.patch({ firstImage: null })}
        />
        {mode === "flf2v" ? (
          <>
            <button
              type="button"
              onClick={draft.swapFrames}
              className="mt-[18%] rounded-full border border-border bg-bg-2 p-1.5 text-fg-3 transition-colors hover:text-fg"
              aria-label={t("create.form.swap")}
              title={t("create.form.swap")}
            >
              <ArrowLeftRight size={14} aria-hidden />
            </button>
            <ImageSlot
              label={t("create.form.lastFrame")}
              image={draft.lastImage}
              onPick={() => void choose("lastImage")}
              onClear={() => draft.patch({ lastImage: null })}
            />
          </>
        ) : null}
      </div>
    </Field>
  );
}

function ExtendSource({ records }: { records: readonly GenerationRecord[] }): JSX.Element {
  const { t } = useTranslation();
  const { extendFromRecordId, patch } = useCreateDraft();
  const finished = records.filter((record) => record.status === "done");
  const selected = finished.find((record) => record.id === extendFromRecordId);
  return (
    <Field label={t("create.form.extendSource")}>
      {finished.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-border-strong px-3 py-4 text-center text-[12px] text-fg-3">
          {t("create.form.extendNone")}
        </p>
      ) : (
        <select
          className="fc-input"
          value={selected?.id ?? ""}
          onChange={(event) => {
            const source = finished.find((record) => record.id === event.target.value);
            // The continuation must match the source clip's frame shape.
            patch({ extendFromRecordId: source?.id ?? null, ...(source ? { aspect: source.request.aspect } : {}) });
          }}
        >
          <option value="">{t("create.form.extendPick")}</option>
          {finished.map((record) => (
            <option key={record.id} value={record.id}>
              {(record.request.promptOriginal ?? record.request.prompt).slice(0, 48)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

const IMAGE_MODES = ["i2v", "flf2v", "ref2v"] as const;

/** LitVideo-style "generation mode" switch inside the image-to-video tab. */
function ImageModeSwitch({ mode }: { mode: GenerationMode }): JSX.Element {
  const { t } = useTranslation();
  const patch = useCreateDraft((state) => state.patch);
  return (
    <Field label={t("create.form.imageMode")}>
      <div className="fc-segment">
        {IMAGE_MODES.map((value) => (
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => patch({ tab: value })}>
            {t(`create.form.imageModes.${value}`)}
          </button>
        ))}
      </div>
    </Field>
  );
}

function FormatFields({ showAspect, showQuality }: { showAspect: boolean; showQuality: boolean }): JSX.Element {
  const { t } = useTranslation();
  const { aspect, durationSec, quality, patch } = useCreateDraft();
  return (
    <>
      {showAspect ? (
        <Field label={t("create.form.aspect")}>
          <div className="fc-segment">
            {GENERATION_ASPECTS.map((value) => {
              const Icon = ASPECT_ICON[value];
              return (
                <button key={value} type="button" aria-pressed={aspect === value} onClick={() => patch({ aspect: value })}>
                  <Icon size={14} aria-hidden />
                  {value}
                </button>
              );
            })}
          </div>
        </Field>
      ) : null}
      <Field label={t("create.form.duration")}>
        <div className="fc-segment">
          {GENERATION_DURATIONS.map((value) => (
            <button key={value} type="button" aria-pressed={durationSec === value} onClick={() => patch({ durationSec: value })}>
              {t("create.form.seconds", { count: value })}
            </button>
          ))}
        </div>
      </Field>
      {showQuality ? (
        <Field label={t("create.form.quality")}>
          <div className="fc-segment">
            <button type="button" aria-pressed={quality === "480p"} onClick={() => patch({ quality: "480p" })}>
              {t("create.form.quality480")}
            </button>
            <button type="button" aria-pressed={quality === "720p"} onClick={() => patch({ quality: "720p" })}>
              {t("create.form.quality720")}
            </button>
          </div>
        </Field>
      ) : null}
    </>
  );
}

function AdvancedFields({ showEnhance }: { showEnhance: boolean }): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { enhancePrompt, fixedSeed, patch } = useCreateDraft();
  return (
    <section className="rounded-[12px] border border-border bg-bg/60">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2.5 text-[12px] font-semibold text-fg-2 hover:text-fg"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {t("create.form.advanced")}
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
          {showEnhance ? (
          <label className="flex items-start gap-2.5 text-[12.5px] text-fg">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--accent)]"
              checked={enhancePrompt}
              onChange={(event) => patch({ enhancePrompt: event.target.checked })}
            />
            <span>
              {t("create.form.enhance")}
              <span className="block text-[11.5px] text-fg-3">{t("create.form.enhanceHint")}</span>
            </span>
          </label>
          ) : null}
          <label className="flex items-center justify-between gap-3 text-[12.5px] text-fg">
            {t("create.form.seed")}
            <input
              type="number"
              min={0}
              className="fc-input !w-40 !py-1.5 text-right"
              placeholder={t("create.form.seedRandom")}
              value={fixedSeed ?? ""}
              onChange={(event) => {
                const value = event.target.value === "" ? null : Math.max(0, Math.floor(Number(event.target.value)));
                patch({ fixedSeed: value !== null && Number.isFinite(value) ? value : null });
              }}
            />
          </label>
        </div>
      ) : null}
    </section>
  );
}

/** Left column of the AI page: everything needed to start one generation. */
export function GenerateForm({ mode }: { mode: GenerationMode }): JSX.Element {
  const { t } = useTranslation();
  const draft = useCreateDraft();
  const records = useGenerationStore((state) => state.records);
  const connection = useGenerationStore((state) => state.connection);
  const submit = useGenerationStore((state) => state.submit);
  const problem = draftProblem({ ...draft, tab: mode });
  const busy = records.some((record) => record.status !== "done" && record.status !== "failed" && record.status !== "canceled");
  const request = draftToRequest(draft, mode);
  const estimate = estimateSeconds(request, { warm: connection === "ready" });
  const engine = useEffectiveEngine();
  const [translating, setTranslating] = useState(false);

  const onGenerate = async (): Promise<void> => {
    if (problem) {
      toast.warning(t(`create.form.${problem}`));
      return;
    }
    const plan = translationPlan(draft);
    if (plan.kind === "none") {
      submit(request);
      return;
    }
    if (plan.kind === "use") {
      submit({ ...request, prompt: plan.english, promptOriginal: request.prompt });
      return;
    }
    setTranslating(true);
    try {
      // Failure shows a toast and sends nothing: never submit silently untranslated.
      const translation = await translateOrToast(request.prompt, engine, t);
      if (!translation) return;
      draft.patch({ englishPreview: translation.english, englishPreviewSource: translation.original, englishEdited: false });
      submit({ ...request, prompt: translation.english, promptOriginal: translation.engine === null ? null : translation.original });
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="fc-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-4 pt-5">
        {(IMAGE_MODES as readonly string[]).includes(mode) ? <ImageModeSwitch mode={mode} /> : null}
        <FrameInputs mode={mode} />
        {mode === "ref2v" ? (
          <ReferenceImages images={draft.referenceImages} onChange={(referenceImages) => draft.patch({ referenceImages })} />
        ) : null}
        {mode === "extend" ? <ExtendSource records={records} /> : null}
        <Field label={t("create.form.prompt")}>
          <textarea
            className="fc-input min-h-[150px] resize-y"
            placeholder={t(`create.form.promptPlaceholder.${mode}`)}
            value={draft.prompt}
            maxLength={4000}
            onChange={(event) => draft.patch({ prompt: event.target.value })}
          />
          <div className="flex items-center justify-between text-[11px] text-fg-muted">
            <span>{t("create.form.promptTip")}</span>
            <span>{draft.prompt.length}/4000</span>
          </div>
          <TranslationSettings hasChinese={containsChinese(draft.prompt)} />
          <EnglishPreview translating={translating} onTranslating={setTranslating} />
        </Field>
        {/* ref2v output size follows the reference sheet (960x544 class), so quality does not apply. */}
        <FormatFields showAspect={mode === "t2v" || mode === "ref2v"} showQuality={mode !== "ref2v"} />
        <AdvancedFields showEnhance={mode !== "ref2v"} />
      </div>
      <footer className="border-t border-border px-5 pb-5 pt-3">
        <div className="mb-2.5 flex items-center justify-between text-[11.5px]">
          <span className="flex items-center gap-1.5 font-semibold text-fg-2">
            <Sparkles size={13} className="text-[var(--gold)]" aria-hidden />
            {formatEstimate(estimate, t)}
          </span>
          <span className="text-fg-muted">{t("create.form.free")}</span>
        </div>
        <DownloadProgress active={translating && engine === "local"} />
        <button
          type="button"
          className="fc-generate"
          onClick={() => void onGenerate()}
          disabled={problem !== null || translating}
          title={problem ? t(`create.form.${problem}`) : undefined}
        >
          {translating ? t("create.translate.translating") : busy ? t("create.form.queueMore") : t("create.form.generate")}
        </button>
      </footer>
    </div>
  );
}
