import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Captions, Square } from "@/icons/lucide-compat";
import {
  ToolcraftButton as Button,
  ToolcraftProgressBar as ProgressBar,
  ToolcraftText as Text,
} from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import {
  collectSubtitleLines,
  voiceSubtitleLines,
  type SubtitleLine,
  type SubtitleVoiceoverProgress,
} from "../../../services/voiceover/subtitle-voiceover";
import { voiceErrorText } from "./voice-ui-helpers";

interface SubtitleVoiceoverSectionProps {
  /** False while another synthesis is running or the engine is not ready. */
  enabled: boolean;
  /** Synthesizes and places one line (the panel owns engine/voice choice). */
  voiceLine(line: SubtitleLine): Promise<void>;
  onBusyChange(busy: boolean): void;
}

type Status = { kind: "idle" } | { kind: "done" | "cancelled" | "failed"; message: string };

export const SubtitleVoiceoverSection: React.FC<SubtitleVoiceoverSectionProps> = ({ enabled, voiceLine, onBusyChange }) => {
  const { t } = useTranslation();
  const project = useProjectStore((s) => s.project);
  const lines = useMemo(
    () => collectSubtitleLines(project, useProjectStore.getState().getAllTextClips()),
    [project],
  );
  const [progress, setProgress] = useState<SubtitleVoiceoverProgress | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const running = progress !== null;

  const start = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ kind: "idle" });
    setProgress({ done: 0, total: lines.length, current: null });
    onBusyChange(true);
    try {
      const outcome = await voiceSubtitleLines(lines, { voiceLine, onProgress: setProgress, signal: controller.signal });
      if (outcome.failure) {
        setStatus({
          kind: "failed",
          message: t("voice.panel.subtitles.failed", {
            index: lines.indexOf(outcome.failure.line) + 1,
            placed: outcome.placed,
            total: outcome.total,
            message: voiceErrorText(t, outcome.failure.error),
          }),
        });
      } else if (outcome.cancelled) {
        setStatus({ kind: "cancelled", message: t("voice.panel.subtitles.cancelled", { placed: outcome.placed, total: outcome.total }) });
      } else {
        setStatus({ kind: "done", message: t("voice.panel.subtitles.done", { placed: outcome.placed }) });
      }
    } finally {
      abortRef.current = null;
      setProgress(null);
      onBusyChange(false);
    }
  };

  const statusColor =
    status.kind === "failed" ? "text-status-error" : status.kind === "done" ? "text-status-success" : "text-fg-3";

  return (
    <section className="space-y-2 rounded-lg border border-border bg-bg-1 p-3">
      <div className="flex items-center gap-2">
        <Captions size={13} className="text-accent" aria-hidden />
        <Text type="label" weight="bold" className="text-[11px]">
          {t("voice.panel.subtitles.title")}
        </Text>
      </div>
      <Text type="supporting" color="secondary" display="block" className="text-[9px] leading-relaxed">
        {t("voice.panel.subtitles.description")}
      </Text>

      {running ? (
        <div className="space-y-2">
          <ProgressBar
            value={progress.done}
            max={Math.max(progress.total, 1)}
            label={t("voice.panel.subtitles.progress", { done: progress.done, total: progress.total })}
            hasValueLabel={false}
          />
          {progress.current && (
            <Text type="supporting" color="secondary" display="block" maxLines={1} className="text-[9px]">
              「{progress.current.text}」
            </Text>
          )}
          <Button
            label={t("voice.panel.subtitles.cancel")}
            icon={<Square size={11} aria-hidden />}
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={() => abortRef.current?.abort()}
          />
        </div>
      ) : (
        <Button
          label={lines.length > 0 ? t("voice.panel.subtitles.start", { count: lines.length }) : t("voice.panel.subtitles.none")}
          size="sm"
          variant="secondary"
          className="w-full"
          isDisabled={!enabled || lines.length === 0}
          onClick={() => void start()}
        />
      )}

      {status.kind !== "idle" && (
        <Text type="supporting" display="block" className={`text-[10px] ${statusColor}`} role="status">
          {status.message}
        </Text>
      )}
    </section>
  );
};
