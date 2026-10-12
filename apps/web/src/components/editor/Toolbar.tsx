import React, { useCallback, useState, useEffect, useMemo } from "react";
import {
  X,
  Settings,
  MoreHorizontal,
  Video,
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import {
  getDeviceProfile,
  estimateExportTime,
  trackHasAudioItems,
  type VideoExportSettings,
  type AudioExportSettings,
  type DeviceProfile,
  type TimeEstimate,
} from "@openreel/core";
import { ExportDialog } from "./ExportDialog";
import { CompressDialog } from "./CompressDialog";
import { deriveSourceExportMatch } from "../../services/export-source-match";
import { useExportRunner, extForFormat, exportFilename, type ExportDeliveryMode } from "../../services/export-runner";
import { ScreenRecorder } from "./ScreenRecorder";
import { HistoryPanel } from "./inspector/HistoryPanel";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SettingsDialog } from "./settings/SettingsDialog";
import { Icon } from "@/icons/Icon";
import { useTranslation } from "react-i18next";
import { toast } from "../../stores/notification-store";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";
import {
  ToolcraftDropdownMenu as DropdownMenu,
  ToolcraftDropdownMenuItem as DropdownMenuItem,
  ToolcraftIconButton,
  ToolcraftText as Text,
  ToolcraftTextInputControl,
} from "@openreel/ui";

type ExportType =
  | "mp4"
  | "prores"
  | "gif"
  | "wav"
  | "4k-master"
  | "4k-prores"
  | "4k"
  | "1080p-high"
  | "4k-60-master"
  | "1080p-60"
  | "project";

export const Toolbar: React.FC = () => {
  const { t } = useTranslation();
  const project = useProjectStore((state) => state.project);
  const renameProject = useProjectStore((state) => state.renameProject);
  const setGlobalExportState = useUIStore((state) => state.setExportState);
  const activeModal = useUIStore((state) => state.activeModal);
  const closeModal = useUIStore((state) => state.closeModal);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const isExportDialogOpen = activeModal === "export";
  const openExportDialog = useCallback(() => {
    setIsExportOpen(false);
    useUIStore.getState().openModal("export");
  }, []);
  const [isCompressOpen, setIsCompressOpen] = useState(false);
  const importMedia = useProjectStore((state) => state.importMedia);
  const sourceMatch = useMemo(() => deriveSourceExportMatch(project), [project]);
  const hasTimelineContent = (project.timeline?.duration ?? 0) > 0;
  const { track } = useAnalytics();

  // Local editable project name (committed onBlur / Enter)
  const [projectNameDraft, setProjectNameDraft] = useState(project.name);
  useEffect(() => {
    setProjectNameDraft(project.name);
  }, [project.name]);

  const commitProjectName = useCallback(() => {
    const next = projectNameDraft.trim();
    if (next && next !== project.name) {
      void renameProject(next);
    } else {
      setProjectNameDraft(project.name);
    }
  }, [projectNameDraft, project.name, renameProject]);

  const handleExported = useCallback(
    (videoSettings: Partial<VideoExportSettings>) => {
      track(AnalyticsEvents.PROJECT_EXPORTED, {
        format: videoSettings.format ?? "mp4",
        codec: videoSettings.codec ?? "h264",
        width: videoSettings.width ?? project.settings.width,
        height: videoSettings.height ?? project.settings.height,
        frameRate: videoSettings.frameRate ?? project.settings.frameRate,
        duration: project.timeline?.duration ?? 0,
      });
    },
    [project, track],
  );

  const {
    state: exportState,
    runExport,
    runAudioExport,
    showSavePicker,
    markComplete,
    beginExport,
    finishExportSoon,
    failExport,
    cancel: handleCancelExport,
    resetError,
  } = useExportRunner({ project, onExported: handleExported });

  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const [exportEstimates, setExportEstimates] = useState<Map<string, TimeEstimate>>(new Map());

  useEffect(() => {
    setGlobalExportState({
      isExporting: exportState.isExporting,
      progress: exportState.progress,
      phase: exportState.phase,
    });
  }, [exportState.isExporting, exportState.progress, exportState.phase, setGlobalExportState]);

  useEffect(() => {
    if (isExportOpen && !deviceProfile) {
      getDeviceProfile().then(setDeviceProfile);
    }
  }, [isExportOpen, deviceProfile]);

  useEffect(() => {
    if (!deviceProfile || !project.timeline?.duration) {
      return;
    }

    const duration = project.timeline.duration;
    const estimates = new Map<string, TimeEstimate>();

    const configs: Array<{ key: string; width: number; height: number; frameRate: number; codec: "h264" | "h265" | "vp9" | "av1" }> = [
      { key: "mp4", width: project.settings.width, height: project.settings.height, frameRate: 30, codec: "h264" },
      { key: "4k", width: 3840, height: 2160, frameRate: 30, codec: "h264" },
      { key: "4k-60-master", width: 3840, height: 2160, frameRate: 60, codec: "h264" },
      { key: "4k-master", width: 3840, height: 2160, frameRate: 30, codec: "h264" },
      { key: "1080p-high", width: 1920, height: 1080, frameRate: 30, codec: "h264" },
      { key: "1080p-60", width: 1920, height: 1080, frameRate: 60, codec: "h264" },
      { key: "prores", width: project.settings.width, height: project.settings.height, frameRate: 30, codec: "h264" },
    ];

    for (const config of configs) {
      const estimate = estimateExportTime(deviceProfile, {
        width: config.width,
        height: config.height,
        frameRate: config.frameRate,
        duration,
        codec: config.codec,
      });
      estimates.set(config.key, estimate);
    }

    setExportEstimates(estimates);
  }, [deviceProfile, project.timeline?.duration, project.settings.width, project.settings.height]);

  const handleExport = useCallback(
    async (type: ExportType) => {
      setIsExportOpen(false);
      if (!hasTimelineContent) return;

      try {
        if (type === "wav") {
          const writable = await showSavePicker(exportFilename(project.name, "wav"), "wav", { delivery: window.openreel?.platform === "desktop" ? "file" : "download" });

          beginExport(writable);

          const audioSettings: Partial<AudioExportSettings> = {
            format: "wav",
            sampleRate: 48000,
            channels: 2,
            bitDepth: 24,
          };

          await runAudioExport(audioSettings, writable);
          markComplete();
          track(AnalyticsEvents.PROJECT_EXPORTED, {
            format: "wav",
            duration: project.timeline?.duration ?? 0,
          });
        } else {
          const base = {
            width: project.settings.width,
            height: project.settings.height,
            frameRate: project.settings.frameRate,
          };

          const presets: Record<string, { settings: Partial<VideoExportSettings>; ext: string }> = {
            mp4: { settings: { ...base, format: "mp4", codec: "h264", bitrate: 12000, quality: 85 }, ext: "mp4" },
            gif: { settings: { ...base, format: "webm", codec: "vp9", bitrate: 8000 }, ext: "webm" },
            project: { settings: { ...base, format: "mp4", codec: "h264", bitrate: 12000, quality: 85 }, ext: "mp4" },
            "4k-60-master": { settings: { ...base, width: 3840, height: 2160, frameRate: 60, format: "mov", codec: "h265", bitrate: 100000, quality: 95 }, ext: "mov" },
            "4k-master": { settings: { ...base, width: 3840, height: 2160, frameRate: 30, format: "mov", codec: "h265", bitrate: 80000, quality: 95 }, ext: "mov" },
            "4k-prores": { settings: { ...base, width: 3840, height: 2160, frameRate: 30, format: "mov", codec: "prores", bitrate: 880000, quality: 100 }, ext: "mov" },
            "4k": { settings: { ...base, width: 3840, height: 2160, frameRate: 30, format: "mp4", codec: "h264", bitrate: 50000, quality: 90 }, ext: "mp4" },
            "1080p-60": { settings: { ...base, width: 1920, height: 1080, frameRate: 60, format: "mp4", codec: "h264", bitrate: 25000, quality: 95 }, ext: "mp4" },
            "1080p-high": { settings: { ...base, width: 1920, height: 1080, frameRate: 30, format: "mp4", codec: "h264", bitrate: 20000, quality: 95 }, ext: "mp4" },
            prores: { settings: { ...base, format: "mov", codec: "prores", bitrate: 220000, quality: 100 }, ext: "mov" },
          };

          const preset = presets[type] ?? presets.mp4;
          const writable = await showSavePicker(exportFilename(project.name, preset.ext), preset.ext, { delivery: window.openreel?.platform === "desktop" ? "file" : "download" });

          beginExport(writable);

          await runExport(preset.settings, preset.ext, writable);
        }

        finishExportSoon();
      } catch (error) {
        failExport(error);
      }
    },
    [project, hasTimelineContent, track, runExport, runAudioExport, showSavePicker, beginExport, markComplete, finishExportSoon, failExport],
  );

  const handleCustomExport = useCallback(
    async (settings: VideoExportSettings, delivery: ExportDeliveryMode = window.openreel?.platform === "desktop" ? "file" : "download") => {
      closeModal();
      if (!hasTimelineContent) return;

      try {
        const ext = extForFormat(settings.format);
        const writable = await showSavePicker(exportFilename(project.name, ext), ext, { delivery });

        beginExport(writable);

        const needsUpscaling =
          settings.width > project.settings.width ||
          settings.height > project.settings.height;

        const exportSettings: Partial<VideoExportSettings> = {
          ...settings,
          upscaling:
            settings.upscaling?.enabled && needsUpscaling
              ? settings.upscaling
              : undefined,
        };

        await runExport(exportSettings, ext, writable);

        track(AnalyticsEvents.PROJECT_EXPORTED, {
          format: settings.format,
          codec: settings.codec,
          width: settings.width,
          height: settings.height,
          frameRate: settings.frameRate,
          duration: project.timeline?.duration ?? 0,
          exportType: "custom",
          upscaling: settings.upscaling?.enabled ?? false,
        });

        finishExportSoon();
      } catch (error) {
        failExport(error);
      }
    },
    [project, hasTimelineContent, closeModal, track, runExport, showSavePicker, beginExport, finishExportSoon, failExport],
  );


  const handleRecordingComplete = useCallback(
    async (screenBlob: Blob, webcamBlob?: Blob) => {
      if (!screenBlob || screenBlob.size === 0) {
        toast.error(
          t("editor.toolbar.recordingFailed"),
          t("editor.toolbar.recordingEmpty"),
        );
        return;
      }

      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:-]/g, "");
      let importCount = 0;
      const errors: string[] = [];

      const screenFile = new File([screenBlob], `Screen_${timestamp}.webm`, {
        type: screenBlob.type || "video/webm",
      });
      const screenResult = await importMedia(screenFile);
      if (screenResult.success) {
        importCount++;
      } else {
        errors.push(
          screenResult.error?.message || t("editor.toolbar.screenImportFailed"),
        );
      }

      if (webcamBlob && webcamBlob.size > 0) {
        const webcamFile = new File([webcamBlob], `Webcam_${timestamp}.webm`, {
          type: webcamBlob.type || "video/webm",
        });
        const webcamResult = await importMedia(webcamFile);
        if (webcamResult.success) {
          importCount++;
        } else {
          errors.push(
            webcamResult.error?.message || t("editor.toolbar.webcamImportFailed"),
          );
        }
      }

      if (importCount > 0) {
        toast.success(
          t("editor.toolbar.recordingsImported", { count: importCount }),
          webcamBlob && webcamBlob.size > 0
            ? t("editor.toolbar.screenAndWebcamAdded")
            : t("editor.toolbar.screenAdded"),
        );
      } else if (errors.length > 0) {
        toast.error(t("editor.toolbar.importFailed"), errors.join(". "));
      }
    },
    [importMedia, t],
  );

  const projectRes = `${project.settings.width}×${project.settings.height}`;
  const aspectRatio = project.settings.width / project.settings.height;
  const isVertical = aspectRatio < 0.9;

  const exportOptions: Array<{
    label: string;
    iconName: string;
    desc: string;
    type: ExportType;
    recommended?: boolean;
    separator?: boolean;
  }> = [
    {
      label: t("editor.toolbar.export.mp4"),
      iconName: "bolt",
      desc: t("editor.toolbar.export.mp4Desc", { resolution: projectRes }),
      type: "mp4",
      recommended: true,
    },
    {
      label: "",
      iconName: "film",
      desc: "",
      type: "mp4",
      separator: true,
    },
    ...(isVertical
      ? []
      : [
          {
            label: t("editor.toolbar.export.4k"),
            iconName: "film",
            desc: t("editor.toolbar.export.4kDesc"),
            type: "4k" as ExportType,
          },
        ]),
    {
      label: t("editor.toolbar.export.1080pHigh"),
      iconName: "film",
      desc: t("editor.toolbar.export.1080pHighDesc"),
      type: "1080p-high",
    },
    {
      label: t("editor.toolbar.export.1080p60"),
      iconName: "film",
      desc: t("editor.toolbar.export.1080p60Desc"),
      type: "1080p-60",
    },
    {
      label: t("editor.toolbar.export.wav"),
      iconName: "music.note",
      desc: t("editor.toolbar.export.wavDesc"),
      type: "wav",
    },
  ];

  return (
    <header className="h-[60px] flex items-center gap-2 px-2 sm:gap-[18px] sm:px-[18px] bg-bg-1 border-b border-border shrink-0 z-30 relative">
      {/* ─── Center: project name ─────────────────────────────── */}
      <div className="flex flex-1 min-w-0 items-center justify-center gap-1.5">
        <ToolcraftTextInputControl
          label={t("editor.toolbar.projectName")}
          isLabelHidden
          value={projectNameDraft}
          onChange={setProjectNameDraft}
          onBlur={commitProjectName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.currentTarget as HTMLElement).blur();
            } else if (e.key === "Escape") {
              setProjectNameDraft(project.name);
              (e.currentTarget as HTMLElement).blur();
            }
          }}
          width={Math.min(Math.max(projectNameDraft.length, 6) * 8 + 40, 220)}
          className="max-w-[min(220px,40vw)] bg-transparent border-0 text-center font-medium text-[14px] tracking-tight text-fg-2 px-2 py-0.5 rounded-md min-w-[60px] focus:bg-bg-2 focus:outline-none"
        />
        <ProjectSwitcher />
      </div>

      {/* ─── Right: export only ───────────────────────────────── */}
      <div className="flex items-center justify-end shrink-0">
        {/* Export */}
        {exportState.isExporting ? (
          <button
            type="button"
            onClick={handleCancelExport}
            className="flex items-center gap-1.5 rounded-[8px] bg-bg-3 px-[18px] py-[9px] text-[13px] font-semibold text-fg-2"
          >
            <Icon name="square.and.arrow.up" size={13} ariaHidden />
            {`${Math.round(exportState.progress)}%`}
            <Icon name="xmark" size={11} ariaHidden />
          </button>
        ) : exportState.error ? (
          <button
            type="button"
            onClick={resetError}
            className="flex max-w-[180px] items-center gap-1.5 truncate rounded-[8px] bg-destructive px-[18px] py-[9px] text-[13px] font-semibold text-destructive-foreground"
          >
            <span className="truncate">{exportState.error}</span>
            <Icon name="xmark" size={11} ariaHidden />
          </button>
        ) : exportState.complete ? (
          <button
            type="button"
            disabled
            className="flex items-center gap-1.5 rounded-[8px] bg-bg-3 px-[18px] py-[9px] text-[13px] font-semibold text-fg-2"
          >
            <Icon name="checkmark" size={13} ariaHidden />
            {t("desktop.export.saved")}
          </button>
        ) : (
          <div className="flex items-stretch">
            <button
              type="button"
              onClick={openExportDialog}
              disabled={!hasTimelineContent}
              title={hasTimelineContent ? t("editor.toolbar.chooseExportSettings") : t("editor.toolbar.exportNeedsContent")}
              className="rounded-l-[8px] rounded-r-none bg-accent px-[18px] py-[9px] text-[13px] font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("desktop.export.export")}
            </button>
            <DropdownMenu
              isMenuOpen={isExportOpen}
              onOpenChange={setIsExportOpen}
              hasChevron={false}
              button={{
                label: t("editor.toolbar.exportOptions"),
                variant: "primary",
                size: "sm",
                isIconOnly: true,
                icon: (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="2.4"
                    aria-hidden
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                ),
                className:
                  "rounded-l-none rounded-r-[8px] border-l border-white/25",
                style: {
                  background: "var(--accent)",
                  width: "auto",
                  height: "auto",
                  padding: "9px 8px",
                  borderRadius: "0 8px 8px 0",
                },
              }}
              menuWidth={288}
            >
              <div className="space-y-1 max-h-[400px] overflow-y-auto">
                {exportOptions.map((option, index) =>
                  option.separator ? (
                    <div key={`sep-${index}`} className="my-1 border-t border-border" />
                  ) : (
                    <DropdownMenuItem
                      key={option.type + index}
                      icon={<Icon name={option.iconName} size={18} ariaHidden />}
                      label={
                        <div className="flex items-center gap-2">
                          <Text
                            type="label"
                            weight="bold"
                            className={option.recommended ? "text-accent" : "text-fg"}
                          >
                            {option.label}
                          </Text>
                          {option.recommended && (
                            <Text type="supporting" className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
                              {t("editor.toolbar.bestMatch")}
                            </Text>
                          )}
                        </div>
                      }
                      description={
                        <div>
                          <Text type="supporting" color="secondary" display="block">
                            {option.desc}
                          </Text>
                          {exportEstimates.get(option.type) && (
                            <Text type="supporting" color="secondary" display="block" className="text-[10px]">
                              {t("editor.toolbar.estimate", { time: exportEstimates.get(option.type)?.formatted })}
                            </Text>
                          )}
                        </div>
                      }
                      className={option.recommended ? "bg-accent-soft" : undefined}
                      onClick={() => handleExport(option.type)}
                    />
                  ),
                )}

                <div className="my-1 border-t border-border" />
                <DropdownMenuItem
                  icon={<Settings size={18} aria-hidden />}
                  label={t("editor.toolbar.customExport")}
                  description={t("editor.toolbar.customExportDesc")}
                  endContent={<MoreHorizontal size={14} className="text-fg-muted" aria-hidden />}
                  onClick={openExportDialog}
                />
                <DropdownMenuItem
                  icon={<Video size={18} aria-hidden />}
                  label={t("editor.toolbar.compressVideo")}
                  description={t("editor.toolbar.compressVideoDesc")}
                  onClick={() => setIsCompressOpen(true)}
                />
              </div>
              <Text type="supporting" color="secondary" display="block" className="border-t border-border bg-bg-2 px-3 py-2.5 text-center text-xs">
                {project.settings.width}×{project.settings.height} •{" "}
                {project.settings.frameRate}fps
              </Text>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* ─── Auxiliary popups & dialogs ───────────────────────── */}
      <CompressDialog
        isOpen={isCompressOpen}
        onClose={() => setIsCompressOpen(false)}
      />
      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={closeModal}
        onExport={handleCustomExport}
        duration={project.timeline?.duration ?? 0}
        projectWidth={project.settings?.width ?? 1920}
        projectHeight={project.settings?.height ?? 1080}
        frameRate={project.settings?.frameRate ?? 30}
        sourceMatch={sourceMatch}
        hasAudio={project.timeline.tracks.some((track) => trackHasAudioItems(project, track.id))}
      />

      <ScreenRecorder
        isOpen={activeModal === "recorder"}
        onClose={closeModal}
        onRecordingComplete={handleRecordingComplete}
      />

      <SettingsDialog />

      {activeModal === "history" && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={closeModal}
          />
          <div className="fixed top-topbar right-0 bottom-0 w-80 bg-bg-1 border-l border-border z-50 shadow-lg animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between p-3 border-b border-border">
              <Text type="body" weight="bold" className="text-sm text-fg">
                {t("editor.rail.history")}
              </Text>
              <ToolcraftIconButton
                label={t("editor.toolbar.closeHistory")}
                icon={<X size={14} aria-hidden />}
                size="sm"
                variant="ghost"
                onClick={closeModal}
                className="p-1.5 rounded hover:bg-hover text-fg-3 hover:text-fg transition-colors"
              />
            </div>
            <div className="h-[calc(100%-49px)]">
              <HistoryPanel />
            </div>
          </div>
        </>
      )}
    </header>
  );
};

export default Toolbar;
