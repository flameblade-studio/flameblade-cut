import React, { useCallback } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import {
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
} from "@/icons/lucide-compat";
import type { Transform } from "@openreel/core";
import { useTranslation } from "react-i18next";

interface AlignmentSectionProps {
  clipType: string | null;
  transform: Transform;
  canvasWidth: number;
  canvasHeight: number;
  onTransformChange: (changes: Partial<Transform>) => void;
}

export const AlignmentSection: React.FC<AlignmentSectionProps> = ({
  clipType,
  transform,
  canvasWidth,
  canvasHeight,
  onTransformChange,
}) => {
  const { t } = useTranslation();
  const usesNormalizedPosition =
    clipType === "text" ||
    clipType === "shape" ||
    clipType === "svg" ||
    clipType === "sticker";

  const handleAlign = useCallback(
    (axis: "x" | "y", normalizedValue: 0 | 0.5 | 1) => {
      const dimension = axis === "x" ? canvasWidth : canvasHeight;
      const value = usesNormalizedPosition
        ? normalizedValue
        : (normalizedValue - 0.5) * dimension;
      onTransformChange({
        position: { ...transform.position, [axis]: value },
      });
    },
    [
      canvasHeight,
      canvasWidth,
      onTransformChange,
      transform.position,
      usesNormalizedPosition,
    ],
  );

  const handleCenterBoth = useCallback(() => {
    onTransformChange({
      position: usesNormalizedPosition ? { x: 0.5, y: 0.5 } : { x: 0, y: 0 },
    });
  }, [onTransformChange, usesNormalizedPosition]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Text type="supporting" color="secondary" className="w-16">
          {t("inspector.alignment.horizontal")}
        </Text>
        <div className="flex gap-1">
          <IconButton
            label={t("inspector.alignment.alignLeft")}
            icon={<AlignHorizontalJustifyStart size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("x", 0)}
          />
          <IconButton
            label={t("inspector.alignment.centerH")}
            icon={<AlignHorizontalJustifyCenter size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("x", 0.5)}
          />
          <IconButton
            label={t("inspector.alignment.alignRight")}
            icon={<AlignHorizontalJustifyEnd size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("x", 1)}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Text type="supporting" color="secondary" className="w-16">
          {t("inspector.alignment.vertical")}
        </Text>
        <div className="flex gap-1">
          <IconButton
            label={t("inspector.alignment.alignTop")}
            icon={<AlignVerticalJustifyStart size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("y", 0)}
          />
          <IconButton
            label={t("inspector.alignment.centerV")}
            icon={<AlignVerticalJustifyCenter size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("y", 0.5)}
          />
          <IconButton
            label={t("inspector.alignment.alignBottom")}
            icon={<AlignVerticalJustifyEnd size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("y", 1)}
          />
        </div>
      </div>
      <Button
        label={t("inspector.alignment.centerCanvas")}
        variant="secondary"
        size="sm"
        onClick={handleCenterBoth}
        className="w-full"
      />
      <Text type="supporting" color="secondary" className="block text-center text-[9px] text-fg-muted">
        {usesNormalizedPosition
          ? t("inspector.alignment.overlayHint")
          : t("inspector.alignment.mediaHint")}
      </Text>
    </div>
  );
};
