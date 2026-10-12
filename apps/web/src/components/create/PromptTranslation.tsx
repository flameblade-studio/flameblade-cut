/**
 * "Let AI tidy it up" controls shared by the generate form and the director
 * sidebar: the toggle and the planner picker. The user writes the way they
 * like; the shot planner (see `services/ltx/shot-plan`) turns the prompt and
 * references into what LTX understands inside the generation job.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { TranslationEngine } from "../../services/prompt-translation";
import { useCreateDraft } from "./draft-store";
import { useCloudKeyStatus } from "../../services/cloud-keys/cloud-key-store";

/** Whether the user saved an OpenAI key (Settings → API keys); follows later changes. */
export function useOpenAiKey(): boolean {
  return useCloudKeyStatus()?.openai ?? false;
}

/** Toggle + planner picker. In the director every shot is tidied on its own. */
export function TranslationSettings({ director }: { director: boolean }): JSX.Element {
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
          <span className="block text-[11.5px] leading-relaxed text-fg-3">
            {director ? t("create.translate.directorHint") : t("create.translate.toggleHint")}
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
          <span className="text-[11px] leading-relaxed text-fg-muted">
            {engine === "local" ? t("create.translate.localNote") : t("create.translate.openaiNote")}
            {!openAiReady ? ` ${t("create.translate.openaiNoKey")}` : null}
          </span>
        </>
      ) : null}
    </div>
  );
}

/** The planner actually usable now (OpenAI falls back to local without a key). */
export function useEffectiveEngine(): TranslationEngine {
  const translationEngine = useCreateDraft((state) => state.translationEngine);
  const openAiReady = useOpenAiKey();
  return translationEngine === "openai" && openAiReady ? "openai" : "local";
}
