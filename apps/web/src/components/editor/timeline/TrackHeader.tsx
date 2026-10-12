import { displayTrackName } from "./track-display-name";
import { useTranslation } from "react-i18next";
import React, { useState, useRef, useEffect } from "react";
import { Eye, EyeOff, Volume2, VolumeX, Lock, MoreHorizontal, Trash2, Pencil, AlignLeft, Link2, Unlink } from "@/icons/lucide-compat";
import {
  ToolcraftContextMenu as ContextMenu,
  ToolcraftDropdownMenu as DropdownMenu,
  type ToolcraftContextMenuOption as ContextMenuOption,
} from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import type { Track } from "@openreel/core";
import {
  getTrackItems,
  trackHasAudioItems,
  trackHasVisualItems,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useCompactEditor } from "../../../hooks/useCompactEditor";
import { getTrackInfo } from "./utils";

interface TrackHeaderProps {
  track: Track;
  index: number;
  onDragStart: (e: React.DragEvent, trackId: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetTrackId: string) => void;
  onDragEnd: () => void;
  keyframeCount?: number;
}

export const TrackHeader: React.FC<TrackHeaderProps> = React.memo(function TrackHeader({
  track,
  index,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) {
  const { t } = useTranslation();
  const compact = useCompactEditor();
  const {
    lockTrack,
    hideTrack,
    muteTrack,
    soloTrack,
    removeTrack,
    renameTrack,
    consolidateTrack,
    groupTracks,
    project,
  } = useProjectStore();
  const trackHeight = useTimelineStore((state) =>
    state.trackHeights[track.id] ?? state.trackHeight,
  );

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(track.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const trackInfo = getTrackInfo(track, index);
  const isVisual = trackHasVisualItems(project, track.id);
  const isAudio = trackHasAudioItems(project, track.id);
  const hasSoloedAudioTrack = project.timeline.tracks.some(
    (candidate) =>
      trackHasAudioItems(project, candidate.id) && candidate.solo,
  );
  const effectivelyMuted =
    isAudio && (track.muted || (hasSoloedAudioTrack && !track.solo));
  const groupCandidates = project.timeline.tracks.filter(
    (candidate) =>
      candidate.id !== track.id &&
      candidate.groupId !== track.groupId,
  );

  const handleRemoveTrack = async () => {
    await removeTrack(track.id);
  };

  const handleRemoveGaps = async () => {
    await consolidateTrack(track.id);
  };

  // Only enable "Remove Gaps" if there's actually a gap on this track.
  const hasGaps = React.useMemo(() => {
    const sorted = getTrackItems(project, track.id);
    if (sorted.length === 0) return false;
    if (sorted[0].startTime > 0.0001) return true;
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].startTime + sorted[i - 1].duration;
      if (sorted[i].startTime - prevEnd > 0.0001) return true;
    }
    return false;
  }, [project, track.id]);

  const startRename = () => {
    setRenameValue(track.name);
    setIsRenaming(true);
  };

  const commitRename = () => {
    renameTrack(track.id, renameValue || track.name);
    setIsRenaming(false);
  };

  const cancelRename = () => {
    setRenameValue(track.name);
    setIsRenaming(false);
  };

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  const menuItems: ContextMenuOption[] = [
    {
      label: t("timeline.track.rename"),
      icon: <Pencil size={14} aria-hidden />,
      onClick: startRename,
    },
    {
      label: t("timeline.track.removeGaps"),
      icon: <AlignLeft size={14} aria-hidden />,
      isDisabled: !hasGaps,
      onClick: handleRemoveGaps,
    },
    ...(track.groupId
      ? [
          {
            label: t("timeline.track.ungroup"),
            icon: <Unlink size={14} aria-hidden />,
            onClick: () => groupTracks(track.id),
          } satisfies ContextMenuOption,
        ]
      : []),
    ...(groupCandidates.length > 0
      ? [
          {
            type: "section" as const,
            title: t("timeline.track.groupSection"),
            items: groupCandidates.map((candidate) => ({
              label: t("timeline.track.groupWith", { name: candidate.name }),
              icon: <Link2 size={14} aria-hidden />,
              onClick: () => groupTracks(track.id, candidate.id),
            })),
          } satisfies ContextMenuOption,
        ]
      : []),
    { type: "divider" },
    {
      label: t("timeline.layers.deleteTrack"),
      icon: <Trash2 size={14} aria-hidden />,
      onClick: handleRemoveTrack,
    },
  ];

  return (
    <ContextMenu items={menuItems} menuWidth={180} size="sm">
      <div
        data-timeline-track-header
        draggable={!compact && !isRenaming}
        onDragStart={(e) => onDragStart(e, track.id)}
        onDragOver={onDragOver}
        onDrop={(e) => onDrop(e, track.id)}
        onDragEnd={onDragEnd}
        style={{ height: trackHeight }}
        className={`border-b border-border flex items-center gap-2.5 px-4 relative group transition-colors cursor-grab active:cursor-grabbing ${
          track.hidden || effectivelyMuted ? "opacity-60" : ""
        } ${
          track.locked ? "bg-bg-2/50" : "bg-bg-1"
        }`}
      >
          <div className="min-w-0 flex-1">
            {isRenaming ? (
              <ToolcraftTextInputControl
                ref={inputRef}
                label={t("timeline.track.name")}
                isLabelHidden
                size="sm"
                width="100%"
                value={renameValue}
                onChange={setRenameValue}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") cancelRename();
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="block truncate text-[13px] font-semibold text-fg-2 cursor-grab active:cursor-grabbing"
                onDoubleClick={startRename}
              >
                {track.name ? displayTrackName(track.name, t) : trackInfo.label}
              </span>
            )}
          </div>

          {compact && <DropdownMenu
            menuWidth={220} placement="end" alignment="start" size="lg"
            button={{ label: t("timeline.track.options", { name: track.name || trackInfo.label }), isIconOnly: true, variant: "ghost", icon: <MoreHorizontal size={18} aria-hidden /> }}
            items={[
              ...(isVisual ? [{ label: track.hidden ? t("timeline.track.show") : t("timeline.track.hide"), onClick: () => hideTrack(track.id, !track.hidden) }] : []),
              ...(isAudio ? [
                { label: track.muted ? t("timeline.track.unmute") : t("timeline.track.mute"), onClick: () => muteTrack(track.id, !track.muted) },
                { label: track.solo ? t("timeline.track.clearSolo") : t("timeline.track.solo"), onClick: () => soloTrack(track.id, !track.solo) },
              ] : []),
              { label: track.locked ? t("timeline.track.unlock") : t("timeline.track.lock"), onClick: () => lockTrack(track.id, !track.locked) },
              { type: "divider" }, ...menuItems,
            ]}
          />}
          <div hidden={compact} className="flex items-center gap-2.5 shrink-0">
            {track.groupId && (
              <Link2
                size={13}
                className="text-accent"
                aria-label={t("timeline.track.grouped")}
              />
            )}
            {isVisual && (
              <button
                type="button"
                aria-label={track.hidden ? t("timeline.track.show") : t("timeline.track.hide")}
                className="text-fg-muted hover:text-fg-2 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  hideTrack(track.id, !track.hidden);
                }}
              >
                {track.hidden ? (
                  <EyeOff size={15} strokeWidth={1.7} aria-hidden />
                ) : (
                  <Eye size={15} strokeWidth={1.7} aria-hidden />
                )}
              </button>
            )}
            {isAudio && (
              <>
                <button
                  type="button"
                  aria-label={track.muted ? t("timeline.track.unmuteNamed", { name: track.name }) : t("timeline.layers.muteNamed", { name: track.name })}
                  aria-pressed={track.muted}
                  title={track.muted ? t("timeline.track.unmute") : t("timeline.track.mute")}
                  className={`transition-colors ${
                    track.muted ? "text-destructive" : "text-fg-muted hover:text-fg-2"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    muteTrack(track.id, !track.muted);
                  }}
                >
                  {track.muted ? (
                    <VolumeX size={15} strokeWidth={1.7} aria-hidden />
                  ) : (
                    <Volume2 size={15} strokeWidth={1.7} aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={track.solo ? t("timeline.track.clearSoloNamed", { name: track.name }) : t("timeline.layers.soloNamed", { name: track.name })}
                  aria-pressed={track.solo}
                  title={track.solo ? t("timeline.track.clearSolo") : t("timeline.track.solo")}
                  className={`flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 text-[9px] font-black transition-colors ${
                    track.solo
                      ? "bg-status-warning text-black"
                      : "text-fg-muted hover:bg-hover hover:text-fg-2"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    soloTrack(track.id, !track.solo);
                  }}
                >
                  S
                </button>
              </>
            )}
            <button
              type="button"
              aria-label={track.locked ? t("timeline.track.unlockShort") : t("timeline.track.lockShort")}
              className={`transition-colors ${
                track.locked ? "text-fg-2" : "text-fg-muted hover:text-fg-2"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                lockTrack(track.id, !track.locked);
              }}
            >
              <Lock size={13} strokeWidth={1.8} aria-hidden />
            </button>
          </div>
      </div>
    </ContextMenu>
  );
});
