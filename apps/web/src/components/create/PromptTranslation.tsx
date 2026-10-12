/**
 * Prompt translation controls shared by the generate form and the director
 * sidebar: the "translate before sending" toggle, the engine picker, the
 * editable English preview, and the local model's download progress.
 */
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Loader2 } from "@/icons/lucide-compat";
import {
  LOCAL_TRANSLATION_MODEL,
  onLocalModelProgress,
  openAiKeyConfigured,
  translatePrompt,
  type ModelDownloadProgress,
  type PromptTranslation,
  type TranslationEngine,
} from "../../services/prompt-translation";
import { containsChinese } from "../../services/prompt-translation/segments";
import { toast } from "../../stores/notification-store";
import { useCreateDraft } from "./draft-store";

/** Whether the user saved an OpenAI key (checked once per mount). */
export function useOpenAiKey(): boolean {
  const [configured, setConfigured] = useState(false);
  useEffect(() => {
    let alive = true;
    void openAiKeyConfigured().then((value) => {
      if (alive) setConfigured(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return configured;
}

/** Summed download progress of the local model's files while `active`. */
export function useModelDownload(active: boolean): { loaded: number; total: number } | null {
  const [files, setFiles] = useState<Record<string, ModelDownloadProgress>>({});
  useEffect(() => {
    if (!active) {
      setFiles({});
      return;
    }
    return onLocalModelProgress((progress) => setFiles((current) => ({ ...current, [progress.file]: progress })));
  }, [active]);
  const entries = Object.values(files);
  if (entries.length === 0) return null;
  const loaded = entries.reduce((sum, file) => sum + (file.loaded || 0), 0);
  const total = entries.reduce((sum, file) => sum + (file.total || 0), 0);
  return loaded < total ? { loaded, total } : null;
}

export function DownloadProgress({ active }: { active: boolean }): JSX.Element | null {
  const { t } = useTranslation();
  const download = useModelDownload(active);
  if (!download) return null;
  const mb = (bytes: number): string => (bytes / 1_000_000).toFixed(0);
  return (
    <div className="flex flex-col gap-1 text-[11px] text-fg-3" role="status">
      {t("create.translate.downloading", { loaded: mb(download.loaded), total: mb(download.total) })}
      <div className="fc-progress-track">
        <div className="fc-progress-bar" style={{ width: `${Math.round((download.loaded / download.total) * 100)}%` }} />
      </div>
    </div>
  );
}

/** Translates with the draft's engine; shows a toast and returns null on failure. */
export async function translateOrToast(
  text: string,
  engine: TranslationEngine,
  t: (key: string, options?: Record<string, unknown>) => string,
): Promise<PromptTranslation | null> {
  try {
    return await translatePrompt(text, { engine });
  } catch (error) {
    toast.error(t("create.translate.failed", { message: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}

/** Toggle + engine picker. `hasChinese` is null in the director (each shot decides). */
export function TranslationSettings({ hasChinese }: { hasChinese: boolean | null }): JSX.Element {
  const { t } = useTranslation();
  const { autoTranslate, translationEngine, patch } = useCreateDraft();
  const openAiReady = useOpenAiKey();
  const engine = translationEngine === "openai" && !openAiReady ? "local" : translationEngine;
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-bg/60 px-3 py-2.5">
      <label className="flex items-start gap-2.5 text-[12.5px] text-fg">
        <input
          type="checkbox"
          className="mt-0.5 accent-[var(--accent)]"
          checked={autoTranslate}
          onChange={(event) => patch({ autoTranslate: event.target.checked })}
        />
        <span>
          {t("create.translate.toggle")}
          <span className="block text-[11.5px] text-fg-3">
            {hasChinese === false ? t("create.translate.noChinese") : hasChinese === null ? t("create.translate.directorHint") : t("create.translate.toggleHint")}
          </span>
        </span>
      </label>
      {autoTranslate ? (
        <>
          <div className="fc-segment" role="group" aria-label={t("create.translate.engine")}>
            <button type="button" aria-pressed={engine === "local"} onClick={() => patch({ translationEngine: "local" })}>
              {t("create.translate.engineLocal")}
            </button>
            <button
              type="button"
              aria-pressed={engine === "openai"}
              disabled={!openAiReady}
              title={openAiReady ? undefined : t("create.translate.openaiNoKey")}
              onClick={() => patch({ translationEngine: "openai" })}
            >
              {t("create.translate.engineOpenai")}
            </button>
          </div>
          <span className="text-[11px] text-fg-muted">
            {engine === "local"
              ? t("create.translate.localNote", { size: LOCAL_TRANSLATION_MODEL.downloadSize })
              : null}
            {!openAiReady ? ` ${t("create.translate.openaiNoKey")}` : null}
          </span>
        </>
      ) : null}
    </div>
  );
}

/** The engine actually usable now (OpenAI falls back to local without a key). */
export function useEffectiveEngine(): TranslationEngine {
  const translationEngine = useCreateDraft((state) => state.translationEngine);
  const openAiReady = useOpenAiKey();
  return translationEngine === "openai" && openAiReady ? "openai" : "local";
}

/** Collapsible, editable English preview under the prompt box. */
export function EnglishPreview({ translating, onTranslating }: { translating: boolean; onTranslating: (busy: boolean) => void }): JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { prompt, autoTranslate, englishPreview, englishPreviewSource, englishEdited, patch } = useCreateDraft();
  const engine = useEffectiveEngine();
  const source = prompt.trim();
  if (!autoTranslate || !containsChinese(source)) return null;
  const stale = englishPreview !== null && englishPreviewSource !== source;

  const preview = async (): Promise<void> => {
    onTranslating(true);
    try {
      const result = await translateOrToast(source, engine, t);
      if (result) patch({ englishPreview: result.english, englishPreviewSource: source, englishEdited: false });
      setOpen(true);
    } finally {
      onTranslating(false);
    }
  };

  return (
    <section className="rounded-[10px] border border-border bg-bg/60">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          className="flex items-center gap-1.5 text-[12px] font-semibold text-fg-2 hover:text-fg"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          {t("create.translate.preview")}
        </button>
        <button type="button" className="fc-action !h-7 !px-2.5 text-[11.5px]" disabled={translating} onClick={() => void preview()}>
          {translating ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}
          {translating ? t("create.translate.translating") : t("create.translate.previewButton")}
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-1.5 border-t border-border px-3 py-2.5">
          <textarea
            className="fc-input min-h-[84px] resize-y"
            lang="en"
            placeholder={t("create.translate.previewEmpty")}
            value={englishPreview ?? ""}
            maxLength={4000}
            onChange={(event) => patch({ englishPreview: event.target.value, englishPreviewSource: source, englishEdited: true })}
          />
          {stale ? (
            <span className="text-[11px] text-[var(--gold)]">{t("create.translate.stale")}</span>
          ) : englishEdited ? (
            <span className="text-[11px] text-fg-3">{t("create.translate.edited")}</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
