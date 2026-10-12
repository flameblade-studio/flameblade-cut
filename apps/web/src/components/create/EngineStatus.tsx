import type { JSX } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Settings2, X } from "@/icons/lucide-compat";
import type { ComfyConnection, LtxSettings } from "../../services/ltx/types";
import { useGenerationStore } from "../../stores/generation-store";

const DOT_CLASS: Record<ComfyConnection, string> = {
  unknown: "fc-dot--offline",
  offline: "fc-dot--offline",
  starting: "fc-dot--starting",
  ready: "fc-dot--ready",
  error: "fc-dot--error",
};

async function pickFolder(): Promise<string | null> {
  return (await window.openreel?.fs?.showOpenFolderDialog()) ?? null;
}

function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation();
  const settings = useGenerationStore((state) => state.settings);
  const updateSettings = useGenerationStore((state) => state.updateSettings);
  const [draft, setDraft] = useState<LtxSettings>(settings);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t("create.settings.title")}>
      <div className="fc-panel w-[520px] max-w-[92vw] p-6">
        <header className="mb-1 flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-fg">{t("create.settings.title")}</h2>
          <button type="button" className="rounded p-1 text-fg-3 hover:text-fg" onClick={onClose} aria-label={t("create.settings.close")}>
            <X size={16} aria-hidden />
          </button>
        </header>
        <p className="mb-5 text-[12.5px] text-fg-3">{t("create.settings.description")}</p>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="fc-label">{t("create.settings.comfyDir")}</span>
            <div className="flex gap-2">
              <input className="fc-input" value={draft.comfyDir} onChange={(event) => setDraft({ ...draft, comfyDir: event.target.value })} />
              <button
                type="button"
                className="fc-action shrink-0"
                onClick={() => {
                  void pickFolder().then((folder) => {
                    if (folder) setDraft({ ...draft, comfyDir: folder });
                  });
                }}
              >
                <FolderOpen size={14} aria-hidden />
                {t("create.settings.browse")}
              </button>
            </div>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="fc-label">{t("create.settings.library")}</span>
            <div className="flex gap-2">
              <input className="fc-input" readOnly value={draft.outputDir ?? t("create.settings.libraryDefault")} aria-label={t("create.settings.library")} />
              <button
                type="button"
                className="fc-action shrink-0"
                onClick={() => {
                  void pickFolder().then((folder) => {
                    if (folder) setDraft({ ...draft, outputDir: folder });
                  });
                }}
              >
                <FolderOpen size={14} aria-hidden />
                {t("create.settings.browse")}
              </button>
              {draft.outputDir ? (
                <button type="button" className="fc-action shrink-0" onClick={() => setDraft({ ...draft, outputDir: null })}>
                  {t("create.settings.libraryReset")}
                </button>
              ) : null}
            </div>
            <span className="text-[11.5px] text-fg-muted">{t("create.settings.libraryHint")}</span>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="fc-label">{t("create.settings.baseUrl")}</span>
            <input className="fc-input" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} />
          </label>
          <label className="flex items-center gap-2.5 text-[13px] text-fg">
            <input type="checkbox" className="accent-[var(--accent)]" checked={draft.autoLaunch} onChange={(event) => setDraft({ ...draft, autoLaunch: event.target.checked })} />
            {t("create.settings.autoLaunch")}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="fc-label">{t("create.settings.preLaunch")}</span>
            <input
              className="fc-input"
              value={draft.preLaunchScript ?? ""}
              onChange={(event) => setDraft({ ...draft, preLaunchScript: event.target.value.trim() === "" ? null : event.target.value })}
            />
            <span className="text-[11.5px] text-fg-muted">{t("create.settings.preLaunchHint")}</span>
          </label>
        </div>
        <footer className="mt-6 flex justify-end gap-2">
          <button type="button" className="fc-action" onClick={onClose}>
            {t("create.settings.close")}
          </button>
          <button
            type="button"
            className="fc-action fc-action--primary"
            onClick={() => {
              updateSettings(draft);
              onClose();
            }}
          >
            {t("create.settings.save")}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** "LTX-2.5 · 本機 · 含聲音 ● 已就緒" pill with the engine settings behind the gear. */
export function EngineStatus(): JSX.Element {
  const { t } = useTranslation();
  const connection = useGenerationStore((state) => state.connection);
  const comfyDir = useGenerationStore((state) => state.settings.comfyDir);
  const [open, setOpen] = useState(false);
  // A fresh install has no ComfyUI folder yet; say so instead of a vague "offline".
  const needsFolder = connection !== "ready" && comfyDir.trim() === "";
  return (
    <>
      <div className="flex items-center gap-2 rounded-full border border-border bg-bg-1 py-1 pl-3 pr-1 text-[12px]">
        <span className="font-bold tracking-wide text-fg">{t("create.engine.name")}</span>
        <span className="fc-chip fc-chip--gold !h-5">{t("create.engine.local")}</span>
        <span className="fc-chip !h-5">{t("create.engine.sound")}</span>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <span className={`fc-dot ${needsFolder ? "fc-dot--starting" : DOT_CLASS[connection]}`} aria-hidden />
        {needsFolder ? (
          <button type="button" className="font-semibold text-[var(--gold)] underline-offset-2 hover:underline" onClick={() => setOpen(true)}>
            {t("create.engine.status.needFolder")}
          </button>
        ) : (
          <span className="text-fg-2">{t(`create.engine.status.${connection}`)}</span>
        )}
        <button type="button" className="ml-1 rounded-full p-1.5 text-fg-3 transition-colors hover:bg-bg-3 hover:text-fg" onClick={() => setOpen(true)} aria-label={t("create.engine.settings")} title={t("create.engine.settings")}>
          <Settings2 size={14} aria-hidden />
        </button>
      </div>
      {open ? <SettingsDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
