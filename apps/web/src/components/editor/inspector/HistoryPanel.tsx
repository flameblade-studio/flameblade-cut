import React, { useState, useEffect, useCallback } from "react";
import {
  History,
  Undo2,
  Redo2,
  Bookmark,
  BookmarkPlus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Type,
  Shapes,
  FileCode,
  Smile,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import type { HistorySnapshot } from "@openreel/core";
import { useTranslation } from "react-i18next";
import { historyActionLabel } from "./history-labels";

interface DisplayEntry {
  id: string;
  description: string;
  timestamp: number;
  isCurrent: boolean;
  isClipEntry: boolean;
  clipType?: "shape" | "text" | "svg" | "sticker";
  groupId?: string;
}

export const HistoryPanel: React.FC = () => {
  const { t } = useTranslation();
  const { actionHistory, undo, redo, canUndo, canRedo, clipUndoStack, clipRedoStack } = useProjectStore();
  const [combinedHistory, setCombinedHistory] = useState<DisplayEntry[]>([]);
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [newSnapshotName, setNewSnapshotName] = useState("");
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);

  const getClipDescription = (type: "shape" | "text" | "svg" | "sticker"): string => {
    switch (type) {
      case "text": return t("inspector.history.createText");
      case "shape": return t("inspector.history.createShape");
      case "svg": return t("inspector.history.importSvg");
      case "sticker": return t("inspector.history.addSticker");
      default: return t("inspector.history.createClip");
    }
  };

  useEffect(() => {
    const updateHistory = () => {
      const actionEntries = actionHistory.getDisplayHistory();
      setSnapshots(actionHistory.getSnapshots());

      const displayEntries: DisplayEntry[] = actionEntries.map((item, idx) => ({
        id: `action-${item.entry.action.id}-${idx}`,
        description: historyActionLabel(t, item.entry.action, item.entry.description),
        timestamp: item.entry.timestamp,
        isCurrent: item.isCurrent,
        isClipEntry: false,
        groupId: item.entry.groupId,
      }));

      clipUndoStack.forEach((entry, idx) => {
        displayEntries.push({
          id: `clip-${entry.clipId}-${idx}`,
          description: getClipDescription(entry.type),
          timestamp: Date.now() - (clipUndoStack.length - idx) * 1000,
          isCurrent: idx === clipUndoStack.length - 1 && clipRedoStack.length === 0,
          isClipEntry: true,
          clipType: entry.type,
        });
      });

      displayEntries.sort((a, b) => a.timestamp - b.timestamp);
      setCombinedHistory(displayEntries);
    };

    updateHistory();
    const unsubscribe = actionHistory.subscribe(updateHistory);
    return () => unsubscribe();
  }, [actionHistory, clipUndoStack, clipRedoStack, t]);

  const handleUndo = useCallback(async () => {
    if (canUndo()) {
      await undo();
    }
  }, [undo, canUndo]);

  const handleRedo = useCallback(async () => {
    if (canRedo()) {
      await redo();
    }
  }, [redo, canRedo]);

  const handleCreateSnapshot = useCallback(() => {
    if (newSnapshotName.trim()) {
      actionHistory.createSnapshot(newSnapshotName.trim());
      setNewSnapshotName("");
      setIsCreatingSnapshot(false);
    }
  }, [actionHistory, newSnapshotName]);

  const handleDeleteSnapshot = useCallback(
    (id: string) => {
      actionHistory.deleteSnapshot(id);
    },
    [actionHistory],
  );

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const undoCount = actionHistory.getUndoStackSize() + clipUndoStack.length;
  const redoCount = actionHistory.getRedoStackSize() + clipRedoStack.length;

  const getClipIcon = (type?: "shape" | "text" | "svg" | "sticker") => {
    switch (type) {
      case "text": return Type;
      case "shape": return Shapes;
      case "svg": return FileCode;
      case "sticker": return Smile;
      default: return History;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <History size={14} className="text-primary" aria-hidden />
          <Text type="body" color="primary" weight="bold" className="text-sm">
            {t("inspector.history.title")}
          </Text>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            label={t("tools.history.undo", { count: undoCount })}
            icon={<Undo2 size={14} aria-hidden />}
            variant="ghost"
            size="sm"
            onClick={handleUndo}
            isDisabled={!canUndo()}
          />
          <IconButton
            label={t("tools.history.redo", { count: redoCount })}
            icon={<Redo2 size={14} aria-hidden />}
            variant="ghost"
            size="sm"
            onClick={handleRedo}
            isDisabled={!canRedo()}
          />
        </div>
      </div>

      <div className="border-b border-border">
        <ClickableCard
          label={t("inspector.history.toggleSnapshots", { action: showSnapshots ? t("inspector.common.hide") : t("inspector.common.show") })}
          onClick={() => setShowSnapshots(!showSnapshots)}
          padding={2}
          variant="transparent"
          className="w-full"
        >
          <div className="flex items-center gap-2">
            {showSnapshots ? (
              <ChevronDown size={12} aria-hidden />
            ) : (
              <ChevronRight size={12} aria-hidden />
            )}
            <Bookmark size={12} className="text-yellow-500" aria-hidden />
            <Text type="supporting" color="secondary" className="text-xs">
              Snapshots ({snapshots.length})
            </Text>
          </div>
        </ClickableCard>

        {showSnapshots && (
          <div className="px-2 pb-2">
            {snapshots.length === 0 && !isCreatingSnapshot && (
              <Text type="supporting" color="secondary" className="block text-[10px] py-2 text-center">
                {t("inspector.history.noSnapshots")}
              </Text>
            )}

            {snapshots.map((snapshot) => (
              <Card
                key={snapshot.id}
                variant="transparent"
                padding={2}
                className="group flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <Bookmark size={10} className="text-yellow-500" aria-hidden />
                  <div className="flex flex-col gap-0.5">
                    <Text type="supporting" color="primary" display="block" className="text-xs">
                      {snapshot.name}
                    </Text>
                    <Text type="supporting" color="secondary" display="block" className="text-[10px]">
                      {formatTime(snapshot.timestamp)}
                    </Text>
                  </div>
                </div>
                <IconButton
                  label={t("inspector.history.deleteSnapshot", { name: snapshot.name })}
                  icon={<Trash2 size={10} aria-hidden />}
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteSnapshot(snapshot.id)}
                  className="text-fg-3 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                />
              </Card>
            ))}

            {isCreatingSnapshot ? (
              <div className="flex items-center gap-2 p-2">
                <ToolcraftTextInputControl
                  label={t("inspector.history.snapshotName")}
                  isLabelHidden
                  size="sm"
                  width="100%"
                  value={newSnapshotName}
                  onChange={setNewSnapshotName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateSnapshot();
                    if (e.key === "Escape") setIsCreatingSnapshot(false);
                  }}
                  placeholder={t("inspector.history.snapshotPlaceholder")}
                  hasAutoFocus
                />
                <Button
                  label={t("inspector.common.save")}
                  variant="primary"
                  size="sm"
                  onClick={handleCreateSnapshot}
                />
              </div>
            ) : (
              <Button
                label={t("inspector.history.createSnapshot")}
                icon={<BookmarkPlus size={12} aria-hidden />}
                variant="secondary"
                size="sm"
                onClick={() => setIsCreatingSnapshot(true)}
                className="w-full border border-dashed border-border"
              />
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {combinedHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-fg-3">
            <History size={24} className="mb-2 opacity-30" aria-hidden />
            <Text type="supporting" color="secondary" className="text-xs">
              {t("inspector.history.noActions")}
            </Text>
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {combinedHistory.map((item) => {
              const ClipIcon = item.isClipEntry ? getClipIcon(item.clipType) : null;
              return (
                <Card
                  key={item.id}
                  variant={item.isCurrent ? "green" : "transparent"}
                  padding={2}
                  className={`flex items-center gap-2 p-2 rounded transition-colors ${
                    item.isCurrent
                      ? "bg-primary/20 border border-primary/30"
                      : "hover:bg-bg-2"
                  }`}
                >
                  {item.isClipEntry && ClipIcon ? (
                    <ClipIcon
                      size={12}
                      className={item.isCurrent ? "text-primary" : "text-fg-3"}
                      aria-hidden
                    />
                  ) : (
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${
                        item.isCurrent ? "bg-primary" : "bg-text-muted"
                      }`}
                    />
                  )}
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <Text
                      type="supporting"
                      color={item.isCurrent ? "primary" : "secondary"}
                      display="block"
                      className={`text-xs truncate ${
                        item.isCurrent
                          ? "text-fg"
                          : "text-fg-2"
                      }`}
                    >
                      {item.description}
                    </Text>
                    <Text type="supporting" color="secondary" display="block" className="text-[10px]">
                      {formatTime(item.timestamp)}
                    </Text>
                  </div>
                  {item.groupId && (
                    <Text type="supporting" color="secondary" className="px-1 py-0.5 bg-bg-2 rounded text-[8px]">
                      grouped
                    </Text>
                  )}
                  {item.isClipEntry && (
                    <Text type="supporting" className="px-1 py-0.5 bg-amber-500/20 rounded text-[8px] text-amber-400">
                      clip
                    </Text>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="p-2 border-t border-border bg-bg-2">
        <div className="flex items-center justify-between text-[10px] text-fg-3">
          <Text type="supporting" color="secondary" className="text-[10px]">
            {undoCount} actions
          </Text>
          <Text type="supporting" color="secondary" className="text-[10px]">
            {redoCount} redoable
          </Text>
        </div>
      </div>
    </div>
  );
};

export default HistoryPanel;
