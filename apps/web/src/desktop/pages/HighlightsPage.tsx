/**
 * AI Highlights page (WayinVideo-style): pick a long video, find its best
 * moments (local Whisper + heuristic scoring, or OpenAI on the transcript),
 * review and adjust them, then send the chosen ranges to the editor.
 * Requires the desktop bridge; renders standalone.
 */
import type { JSX } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, MonitorPlay, Scissors, Smartphone, Sparkles } from "@/icons/lucide-compat";
import "../../components/create/create.css";
import { baseName, isDesktop, readLocalBytes } from "../../components/create/desktop-files";
import { useLocalFileUrl } from "../../components/create/local-media";
import { HighlightCard } from "../../components/highlights/HighlightCard";
import { HighlightsSidebar, type OpenAiAvailability } from "../../components/highlights/HighlightsSidebar";
import { transcriptKey, useHighlightsStore } from "../../components/highlights/highlights-store";
import { TranscriptSearch } from "../../components/highlights/TranscriptSearch";
import { useHighlightRunner } from "../../components/highlights/use-highlight-runner";
import { NoSpeechError } from "../../services/highlights/analyze";
import { getOpenAiTextBridge } from "../../services/highlights/openai-highlights";
import { sendRangesToEditor, VERTICAL_FORMAT, type FrameFormat } from "../../services/highlights/send-ranges-to-editor";
import { toast } from "../../stores/notification-store";
import { useProjectStore } from "../../stores/project-store";
import { useWorkspaceMode } from "../../stores/workspace-mode-store";

const VIDEO_FILTERS = [{ name: "Video", extensions: ["mp4", "mov", "m4v", "webm", "mkv"] }];
const FALLBACK_FORMAT: FrameFormat = { width: 1920, height: 1080 };

function useOpenAiAvailability(): OpenAiAvailability {
  const [availability, setAvailability] = useState<OpenAiAvailability>("hidden");
  useEffect(() => {
    const bridge = getOpenAiTextBridge();
    if (!bridge) return;
    let alive = true;
    bridge.keyStatus().then(
      ({ configured }) => {
        if (alive) setAvailability(configured ? "ready" : "no-key");
      },
      (error: unknown) => {
        console.warn("[highlights] OpenAI key status failed", error);
        if (alive) setAvailability("no-key");
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return availability;
}

function EmptyState(): JSX.Element {
  const { t } = useTranslation();
  const steps = [t("highlights.empty.step1"), t("highlights.empty.step2"), t("highlights.empty.step3")];
  return (
    <div className="mx-auto flex max-w-[600px] flex-col items-center px-8 pt-[12vh] text-center">
      <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl" style={{ background: "var(--flame-gradient)" }}>
        <Scissors size={28} className="text-white" aria-hidden />
      </div>
      <h2 className="text-[24px] font-bold tracking-wide text-fg">{t("highlights.empty.title")}</h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-fg-3">{t("highlights.empty.body")}</p>
      <ol className="mt-8 flex w-full flex-col gap-2 text-left">
        {steps.map((step, index) => (
          <li key={step} className="fc-card flex items-center gap-3 px-4 py-3 text-[13px] text-fg-2">
            <span className="fc-chip fc-chip--gold !h-6 !w-6 justify-center !p-0">{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HighlightsPage(): JSX.Element {
  const { t } = useTranslation();
  const source = useHighlightsStore((state) => state.source);
  const engine = useHighlightsStore((state) => state.engine);
  const patch = useHighlightsStore((state) => state.patch);
  const entry = useHighlightsStore((state) => (state.source ? state.entries[state.source.path] : undefined));
  const transcription = useHighlightsStore((state) =>
    state.source ? state.transcripts[transcriptKey(state.source.path, state.language)] : undefined,
  );
  const setClipRange = useHighlightsStore((state) => state.setClipRange);
  const toggleClip = useHighlightsStore((state) => state.toggleClip);
  const selectAll = useHighlightsStore((state) => state.selectAll);
  const hasOpenProject = useProjectStore((state) => state.hasOpenProject);
  const setMode = useWorkspaceMode((state) => state.setMode);
  const runner = useHighlightRunner();
  const openai = useOpenAiAvailability();
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const [sourceFormat, setSourceFormat] = useState<FrameFormat | null>(null);
  const [sending, setSending] = useState(false);
  const { url: videoUrl } = useLocalFileUrl(source?.path ?? null, source ? readLocalBytes : null);
  const desktop = isDesktop();

  useEffect(() => {
    if (engine === "openai" && openai !== "ready") patch({ engine: "local" });
  }, [engine, openai, patch]);

  const selectedClips = useMemo(
    () => (entry ? entry.clips.filter((clip) => entry.selected.includes(clip.id)).sort((a, b) => a.start - b.start) : []),
    [entry],
  );
  const duration = transcription?.duration ?? previewRef.current?.duration ?? 0;

  const pick = async (): Promise<void> => {
    const fs = window.openreel?.fs;
    if (!fs) {
      toast.warning(t("highlights.source.noDesktop"));
      return;
    }
    const path = await fs.showOpenDialog({ filters: VIDEO_FILTERS });
    if (!path) return;
    setSourceFormat(null);
    patch({ source: { path, name: baseName(path) } });
  };

  const run = (): void => {
    runner.run().then(
      (outcome) => {
        if (outcome === "cancelled") toast.info(t("highlights.toast.cancelled"));
      },
      (error: unknown) => {
        if (error instanceof NoSpeechError) toast.error(t("highlights.toast.noSpeech"));
        else toast.error(t("highlights.toast.failed", { message: error instanceof Error ? error.message : String(error) }));
      },
    );
  };

  const jump = (seconds: number): void => {
    const video = previewRef.current;
    if (!video) return;
    video.currentTime = seconds;
    void video.play().catch((error: unknown) => console.warn("[highlights] preview playback failed", error));
  };

  const send = (vertical: boolean): void => {
    if (!source || selectedClips.length === 0) return;
    setSending(true);
    sendRangesToEditor(
      source,
      selectedClips,
      { newProjectFormat: vertical ? VERTICAL_FORMAT : (sourceFormat ?? FALLBACK_FORMAT), projectName: t("highlights.projectName") },
      readLocalBytes,
    )
      .then(
        (count) => {
          toast.success(t("highlights.toast.added", { count }));
          setMode("edit");
        },
        (error: unknown) => toast.error(t("highlights.toast.addFailed", { message: error instanceof Error ? error.message : String(error) })),
      )
      .finally(() => setSending(false));
  };

  return (
    <div className="fc-create flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <Sparkles size={17} className="text-[var(--gold)]" aria-hidden />
        <h1 className="text-[15px] font-bold tracking-wide text-fg">{t("highlights.title")}</h1>
        <p className="truncate text-[12.5px] text-fg-3">{t("highlights.subtitle")}</p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[380px_minmax(0,1fr)] gap-3 p-3">
        <aside className="fc-panel min-h-0 overflow-hidden">
          <HighlightsSidebar
            previewRef={previewRef}
            onPick={() => void pick()}
            onRun={run}
            onCancel={runner.cancel}
            running={runner.running}
            stage={runner.stage}
            openai={openai}
            hasResult={Boolean(entry)}
            onPreviewSize={setSourceFormat}
          />
        </aside>
        <main className="fc-panel flex min-h-0 flex-col overflow-hidden">
          {!desktop ? (
            <p className="m-auto text-[13.5px] text-fg-3">{t("highlights.source.noDesktop")}</p>
          ) : !entry ? (
            <div className="fc-scroll min-h-0 flex-1 overflow-y-auto">
              {runner.running ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-3">
                  <Loader2 size={28} className="animate-spin" aria-hidden />
                </div>
              ) : (
                <EmptyState />
              )}
            </div>
          ) : (
            <>
              <div className="fc-scroll min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4 px-6 py-5">
                  {transcription && <TranscriptSearch segments={transcription.segments} onJump={jump} />}
                  <div className="flex items-center gap-3">
                    <h2 className="text-[15px] font-bold tracking-wide text-fg">{t("highlights.results.title")}</h2>
                    <span className="fc-chip">{t("highlights.results.count", { count: entry.clips.length })}</span>
                    {runner.cachedTranscript && <span className="text-[11.5px] text-fg-3">{t("highlights.results.cached")}</span>}
                    <div className="ml-auto flex gap-2">
                      <button type="button" className="fc-action !h-8" onClick={() => source && selectAll(source.path, true)}>
                        {t("highlights.results.selectAll")}
                      </button>
                      <button type="button" className="fc-action !h-8" onClick={() => source && selectAll(source.path, false)}>
                        {t("highlights.results.selectNone")}
                      </button>
                    </div>
                  </div>
                  {entry.clips.length === 0 && <p className="fc-card px-4 py-6 text-center text-[13px] text-fg-3">{t("highlights.results.noResults")}</p>}
                  {entry.clips.map((clip, index) => (
                    <HighlightCard
                      key={clip.id}
                      clip={clip}
                      rank={index + 1}
                      videoUrl={videoUrl}
                      duration={duration}
                      selected={entry.selected.includes(clip.id)}
                      onToggle={() => source && toggleClip(source.path, clip.id)}
                      onChangeRange={(start, end) => source && setClipRange(source.path, clip.id, start, end)}
                    />
                  ))}
                </div>
              </div>
              <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border px-6 py-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[13px] font-semibold text-fg">{t("highlights.actions.selected", { count: selectedClips.length })}</span>
                  <span className="text-[11.5px] leading-relaxed text-fg-3">
                    {hasOpenProject ? t("highlights.actions.projectOpenTip") : t("highlights.actions.reframeTip")}
                  </span>
                </div>
                <button type="button" className="fc-action !h-10" disabled={sending || selectedClips.length === 0} onClick={() => send(false)}>
                  <MonitorPlay size={15} aria-hidden />
                  {t("highlights.actions.addOriginal")}
                </button>
                <button
                  type="button"
                  className="fc-action fc-action--primary !h-10"
                  disabled={sending || selectedClips.length === 0}
                  onClick={() => send(true)}
                >
                  {sending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Smartphone size={15} aria-hidden />}
                  {sending ? t("highlights.actions.adding") : t("highlights.actions.addVertical")}
                </button>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
