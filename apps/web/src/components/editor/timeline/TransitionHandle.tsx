import { useTranslation } from "react-i18next";
import React, { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TransitionType } from "@openreel/core";
import type { ResolvedTransitionHandle } from "./transition-handles";
import { useProjectStore } from "../../../stores/project-store";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import { toast } from "../../../stores/notification-store";

const BADGE_SIZE = 18;
const MENU_WIDTH = 200;

interface TransitionHandleProps {
  handle: ResolvedTransitionHandle;
  trackId: string;
  isSelected: boolean;
  onSelect: (transitionId: string, trackId: string) => void;
}

export const TransitionHandle: React.FC<TransitionHandleProps> = ({
  handle,
  trackId,
  isSelected,
  onSelect,
}) => {
  const { t } = useTranslation();
  const { centerX, transition, clipA, clipB, edge } = handle;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    above: boolean;
  } | null>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);

  const { addClipTransition, updateClipTransition, removeClipTransition } =
    useProjectStore();
  const bridge = getTransitionBridge();
  const types = bridge.getAvailableTransitionTypes();

  const openMenu = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const rect = badgeRef.current?.getBoundingClientRect();
      if (!rect) return;
      const above = rect.top > 300;
      setAnchor({
        left: rect.left,
        top: above ? rect.top - 6 : rect.bottom + 6,
        above,
      });
      setOpen(true);
      if (transition) onSelect(transition.id, trackId);
    },
    [transition, onSelect, trackId],
  );

  const applyType = useCallback(
    async (type: TransitionType) => {
      setOpen(false);
      if (transition) {
        await updateClipTransition(transition.id, { type });
        toast.success(t("timeline.transition.updated"), type);
        return;
      }
      if (!bridge.isInitialized()) {
        toast.error(t("timeline.transition.notReady"), t("timeline.transition.tryAgainSoon"));
        return;
      }
      const params = bridge.getDefaultParams(type);
      const result = clipB
        ? bridge.createTransition(clipA, clipB, type, 1.0, params)
        : bridge.createClipEdgeTransition(clipA, edge ?? "out", type, 1.0, params);
      if (result.success && result.transitionId) {
        const created = bridge.getTransition(result.transitionId);
        if (created) {
          await addClipTransition(created);
          toast.success(t("timeline.transition.added"), `${type} · 1.0s`);
          return;
        }
      }
      toast.error(
        t("timeline.transition.failed"),
        result.error || t("timeline.transition.couldNotCreate"),
      );
    },
    [
      transition,
      clipA,
      clipB,
      edge,
      addClipTransition,
      updateClipTransition,
      bridge,
      t,
    ],
  );

  const handleRemove = useCallback(async () => {
    setOpen(false);
    if (!transition) return;
    await removeClipTransition(transition.id);
    toast.success(t("timeline.transition.removed"), t("timeline.transition.hardCut"));
  }, [transition, removeClipTransition, t]);

  const typeName = (type: string): string =>
    t(`tools.transitionTypes.${type}.name`, { defaultValue: type });
  const label = transition
    ? t("tools.timelineItems.transition.badge", { name: typeName(transition.type), seconds: transition.duration.toFixed(1) })
    : edge === "in"
      ? t("tools.timelineItems.transition.addIntro")
      : edge === "out"
        ? t("tools.timelineItems.transition.addOutro")
        : t("tools.timelineItems.transition.add");
  const ariaLabel = edge === "in"
    ? t("tools.timelineItems.transition.editIntro", { label })
    : edge === "out"
      ? t("tools.timelineItems.transition.editOutro", { label })
      : t("tools.timelineItems.transition.editBetween", { label });
  const isActive = Boolean(transition) || isSelected || open;

  const menu =
    open && anchor
      ? createPortal(
          <>
            <div
              className="fixed inset-0 z-[9998]"
              onMouseDown={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
            />
            <div
              role="menu"
              className="fixed z-[9999] rounded-lg border border-border bg-bg-1 shadow-lg overflow-hidden"
              style={{
                left: anchor.left,
                width: MENU_WIDTH,
                ...(anchor.above
                  ? { bottom: window.innerHeight - anchor.top }
                  : { top: anchor.top }),
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="py-1 max-h-72 overflow-y-auto">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-fg-muted uppercase tracking-wide">
                  {t("tools.timelineItems.transition.menuTitle")}
                </div>
                {transition && (
                  <button
                    type="button"
                    onClick={handleRemove}
                    className="w-full flex items-center px-3 py-2 text-[12px] font-medium text-destructive hover:bg-hover transition-colors text-left"
                  >
                    {t("tools.timelineItems.transition.remove")}
                  </button>
                )}
                {types.map((info) => (
                  <button
                    key={info.type}
                    type="button"
                    onClick={() => applyType(info.type)}
                    className={`w-full flex flex-col px-3 py-1.5 hover:bg-hover transition-colors text-left ${
                      transition?.type === info.type ? "bg-selected" : ""
                    }`}
                  >
                    <span
                      className={`text-[12px] font-medium ${
                        transition?.type === info.type ? "text-accent" : "text-fg"
                      }`}
                    >
                      {t(`tools.transitionTypes.${info.type}.name`, { defaultValue: info.name })}
                    </span>
                    <span className="text-[11px] text-fg-muted leading-tight">
                      {t(`tools.transitionTypes.${info.type}.description`, { defaultValue: info.description })}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <div
      className="absolute top-0 bottom-0 z-30 flex items-center pointer-events-none"
      style={{ left: centerX }}
    >
      <button
        ref={badgeRef}
        type="button"
        title={label}
        aria-label={ariaLabel}
        data-transition-id={transition?.id}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={openMenu}
        className={`pointer-events-auto flex items-center justify-center rounded-[5px] shadow-sm transition-all ${
          isActive ? "ring-2 ring-accent" : ""
        }`}
        style={{
          width: BADGE_SIZE,
          height: BADGE_SIZE,
          marginLeft: -(BADGE_SIZE / 2),
          background: "rgba(255,255,255,0.85)",
        }}
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="#3a3a3c">
          <rect x="6" y="5" width="4" height="14" />
          <rect x="14" y="5" width="4" height="14" />
        </svg>
      </button>
      {menu}
    </div>
  );
};
