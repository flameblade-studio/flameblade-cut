/**
 * The AI generation page (LitVideo-style): mode tabs on top, the form on the
 * left, the generation feed in the middle, thumbnails on the right. The
 * director tab swaps the feed for an editable shot list.
 */
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clapperboard, Film, Image as ImageIcon, FastForward, Sparkles } from "@/icons/lucide-compat";
import { DirectorBoard, DirectorSidebar } from "../../components/create/DirectorBoard";
import { baseName, isDesktop, readLocalBytes } from "../../components/create/desktop-files";
import { type CreateTab, useCreateDraft } from "../../components/create/draft-store";
import { EngineStatus } from "../../components/create/EngineStatus";
import { GenerateForm } from "../../components/create/GenerateForm";
import { RecordCard } from "../../components/create/RecordCard";
import { ThumbRail } from "../../components/create/ThumbRail";
import "../../components/create/create.css";
import { createDesktopComfyTransport } from "../../services/ltx/comfy-transport";
import { extractLastFramePng } from "../../services/ltx/last-frame";
import { sendToEditor } from "../../services/ltx/send-to-editor";
import type { GenerationRecord } from "../../services/ltx/types";
import { useGenerationStore } from "../../stores/generation-store";
import { toast } from "../../stores/notification-store";
import { useWorkspaceMode } from "../../stores/workspace-mode-store";

/** Top tabs; the image tab groups first-frame, first+last frame and reference modes (as in LitVideo). */
const TABS: { id: CreateTab; icon: typeof Film; group: readonly CreateTab[] }[] = [
  { id: "t2v", icon: Film, group: ["t2v"] },
  { id: "i2v", icon: ImageIcon, group: ["i2v", "flf2v", "ref2v"] },
  { id: "extend", icon: FastForward, group: ["extend"] },
  { id: "director", icon: Clapperboard, group: ["director"] },
];

const IN_FLIGHT = new Set(["queued", "preparing", "running", "downloading"]);

/** Readable media-library name: the start of the prompt instead of the record id. */
function mediaNameFor(prompt: string, outputPath: string): string {
  // Characters Windows forbids in file names, plus line breaks.
  const words = prompt.replace(/[\\/:*?"<>|\r\n]+/g, " ").trim();
  const head = Array.from(words).slice(0, 24).join("").trim();
  return head === "" ? baseName(outputPath) : `${head}.mp4`;
}

function EmptyFeed(): JSX.Element {
  const { t } = useTranslation();
  const patch = useCreateDraft((state) => state.patch);
  const examples = [t("create.feed.example1"), t("create.feed.example2"), t("create.feed.example3")];
  return (
    <div className="mx-auto flex max-w-[640px] flex-col items-center px-8 pt-[12vh] text-center">
      <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl" style={{ background: "var(--flame-gradient)" }}>
        <Sparkles size={30} className="text-white" aria-hidden />
      </div>
      <h2 className="text-[24px] font-bold tracking-wide text-fg">{t("create.feed.emptyTitle")}</h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-fg-3">{t("create.feed.emptyBody")}</p>
      <div className="mt-8 w-full text-left">
        <div className="fc-label mb-2.5">{t("create.feed.examples")}</div>
        <div className="flex flex-col gap-2">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              className="fc-card px-4 py-3 text-left text-[13px] leading-relaxed text-fg-2 transition-colors hover:text-fg"
              onClick={() => patch({ tab: "t2v", prompt: example })}
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function useCreateActions(): {
  send: (records: GenerationRecord[]) => void;
  extend: (record: GenerationRecord) => void;
  redo: (record: GenerationRecord) => void;
  cancel: (record: GenerationRecord) => void;
  remove: (record: GenerationRecord) => void;
} {
  const { t } = useTranslation();
  const setMode = useWorkspaceMode((state) => state.setMode);
  const patch = useCreateDraft((state) => state.patch);
  const store = useGenerationStore;

  const send = useCallback(
    (records: GenerationRecord[]) => {
      const sources = records.flatMap((record) =>
        record.outputPath ? [{ path: record.outputPath, name: mediaNameFor(record.request.prompt, record.outputPath) }] : [],
      );
      const first = records[0];
      if (!first || sources.length === 0) return;
      sendToEditor(sources, first.request.aspect, readLocalBytes).then(
        (count) => {
          toast.success(count === 1 ? t("create.toast.added") : t("create.toast.addedMany", { count }));
          setMode("edit");
        },
        (error: unknown) => toast.error(t("create.toast.addFailed", { message: error instanceof Error ? error.message : String(error) })),
      );
    },
    [setMode, t],
  );

  return {
    send,
    extend: (record) => patch({ tab: "extend", extendFromRecordId: record.id, aspect: record.request.aspect, prompt: "" }),
    redo: (record) => store.getState().retry(record.id),
    cancel: (record) => store.getState().cancel(record.id),
    remove: (record) => store.getState().remove(record.id),
  };
}

export function CreatePage(): JSX.Element {
  const { t } = useTranslation();
  const tab = useCreateDraft((state) => state.tab);
  const patch = useCreateDraft((state) => state.patch);
  const records = useGenerationStore((state) => state.records);
  const init = useGenerationStore((state) => state.init);
  const [filter, setFilter] = useState<"all" | "done">("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const actions = useCreateActions();

  useEffect(() => {
    const transport = isDesktop() ? createDesktopComfyTransport() : null;
    if (!transport) {
      toast.warning(t("create.toast.noDesktop"));
      return;
    }
    void init(transport, {
      extractLastFrame: async (videoPath: string) => extractLastFramePng(await readLocalBytes(videoPath)),
    });
  }, [init, t]);

  const queueOrder = useMemo(
    () => records.filter((record) => IN_FLIGHT.has(record.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [records],
  );
  const visible = filter === "done" ? records.filter((record) => record.status === "done") : records;

  const jumpTo = (id: string): void => {
    setActiveId(id);
    document.getElementById(`record-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="fc-create flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-4">
        <div role="tablist" className="flex items-center gap-1">
          {TABS.map(({ id, icon: Icon, group }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={group.includes(tab)}
              className="fc-tab flex items-center gap-1.5"
              onClick={() => {
                if (!group.includes(tab)) patch({ tab: id });
              }}
            >
              <Icon size={15} aria-hidden />
              {t(`create.modes.${id}`)}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <EngineStatus />
        </div>
      </div>
      <div
        className={`grid min-h-0 flex-1 gap-3 p-3 ${
          records.length > 0 ? "grid-cols-[380px_minmax(0,1fr)_92px]" : "grid-cols-[380px_minmax(0,1fr)]"
        }`}
      >
        <aside className="fc-panel min-h-0 overflow-hidden">
          {tab === "director" ? <DirectorSidebar onSendAll={actions.send} /> : <GenerateForm mode={tab} />}
        </aside>
        <main className="fc-panel fc-scroll min-h-0 overflow-y-auto">
          {tab === "director" ? (
            <DirectorBoard />
          ) : records.length === 0 ? (
            <EmptyFeed />
          ) : (
            <div className="mx-auto flex w-full max-w-[920px] flex-col gap-4 px-6 py-5">
              <div className="flex items-center justify-between">
                <h2 className="text-[15px] font-bold tracking-wide text-fg">{t("create.feed.title")}</h2>
                <div className="fc-segment !grid-cols-2 !p-[3px]">
                  <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                    {t("create.feed.all")}
                  </button>
                  <button type="button" aria-pressed={filter === "done"} onClick={() => setFilter("done")}>
                    {t("create.feed.done")}
                  </button>
                </div>
              </div>
              {visible.map((record) => (
                <RecordCard
                  key={record.id}
                  record={record}
                  active={record.id === activeId}
                  queuePosition={Math.max(0, queueOrder.findIndex((item) => item.id === record.id))}
                  onAddToEditor={(item) => actions.send([item])}
                  onExtend={actions.extend}
                  onRedo={actions.redo}
                  onCancel={actions.cancel}
                  onDelete={actions.remove}
                />
              ))}
            </div>
          )}
        </main>
        {records.length > 0 ? (
          <aside className="fc-panel min-h-0 overflow-hidden">
            <ThumbRail records={records} activeId={activeId} onSelect={jumpTo} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
