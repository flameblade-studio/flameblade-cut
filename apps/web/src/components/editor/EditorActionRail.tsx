import React from "react";
import {
  ToolcraftDropdownMenu as DropdownMenu,
  ToolcraftIconButton as IconButton,
  ToolcraftTooltip as Tooltip,
} from "@openreel/ui";
import { Icon } from "@/icons/Icon";
import { useTranslation } from "react-i18next";
import {
  House,
  Sun,
  Moon,
  SunMoon,
  Settings,
  Circle,
  Play,
  Sparkles,
  HelpCircle,
  FileCode,
  Command,
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useThemeStore } from "../../stores/theme-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useRouter } from "../../hooks/use-router";
import {
  startTour,
  ONBOARDING_KEY,
  startMoGraphTour,
  MOGRAPH_TOUR_KEY,
} from "./tour";

const RailButton: React.FC<{
  label: string;
  icon: string;
  onClick: () => void;
  active?: boolean;
}> = ({ label, icon, onClick, active = false }) => (
  <Tooltip content={label} placement="end">
    <IconButton
      label={label}
      icon={<Icon name={icon} size={16} ariaHidden />}
      size="sm"
      variant={active ? "secondary" : "ghost"}
      onClick={onClick}
    />
  </Tooltip>
);

export const EditorActionRail: React.FC = () => {
  const { undo, redo } = useProjectStore();
  const {
    openModal,
    toggleKeyframeEditor,
    keyframeEditorOpen,
    panels,
    togglePanel,
    activeModal,
  } = useUIStore();
  const { mode: themeMode, toggleTheme } = useThemeStore();
  const { openSettings } = useSettingsStore();
  const { navigate } = useRouter();
  const { t } = useTranslation();

  const themeLabel =
    themeMode === "auto"
      ? t("editor.theme.system")
      : t(`editor.theme.${themeMode}`);
  const nextThemeLabel =
    themeMode === "light"
      ? t("editor.theme.dark")
      : themeMode === "dark"
        ? t("editor.theme.system")
        : t("editor.theme.light");
  const themeIcon =
    themeMode === "light" ? (
      <Sun size={16} aria-hidden />
    ) : themeMode === "dark" ? (
      <Moon size={16} aria-hidden />
    ) : (
      <SunMoon size={16} aria-hidden />
    );
  const themeActionLabel = t("editor.theme.action", { current: themeLabel, next: nextThemeLabel });

  return (
    <nav
      data-tour="toolbar"
      aria-label={t("editor.rail.tools")}
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-1 py-3"
    >
      <Tooltip content={t("editor.rail.backHome")} placement="end">
        <IconButton
          label={t("editor.rail.backHome")}
          icon={<House size={16} aria-hidden />}
          size="sm"
          variant="ghost"
          onClick={() => navigate("welcome")}
        />
      </Tooltip>

      <div className="my-1.5 h-px w-6 bg-border" />

      <RailButton
        label={t("editor.rail.search")}
        icon="magnifyingglass"
        onClick={() => openModal("search")}
      />
      <RailButton
        label={t("common.undo")}
        icon="arrow.uturn.backward"
        onClick={() => void undo()}
      />
      <RailButton
        label={t("common.redo")}
        icon="arrow.uturn.forward"
        onClick={() => void redo()}
      />

      <div className="my-1.5 h-px w-6 bg-border" />

      <RailButton
        label={t("editor.rail.history")}
        icon="clock"
        onClick={() => openModal("history")}
        active={activeModal === "history"}
      />
      <RailButton
        label={t("editor.rail.keyframeEditor")}
        icon="diamond"
        onClick={toggleKeyframeEditor}
        active={keyframeEditorOpen}
      />
      <RailButton
        label={t("editor.rail.audioMixer")}
        icon="music.note"
        onClick={() => togglePanel("audioMixer")}
        active={Boolean(panels.audioMixer?.visible)}
      />
      <RailButton
        label={t("editor.rail.aiChat")}
        icon="bubble.left.and.text.bubble.right"
        onClick={() => togglePanel("agentChat")}
        active={Boolean(panels.agentChat?.visible)}
      />
      <RailButton
        label={t("editor.rail.projectJsonComments")}
        icon="curlybraces"
        onClick={() => openModal("scriptView")}
      />

      <div className="flex-1" />

      <Tooltip content={themeActionLabel} placement="end">
        <IconButton
          label={themeActionLabel}
          icon={themeIcon}
          size="sm"
          variant="secondary"
          onClick={toggleTheme}
        />
      </Tooltip>

      <DropdownMenu
        placement="end"
        button={{
          label: t("editor.rail.more"),
          icon: <Icon name="star" size={16} ariaHidden />,
          size: "sm",
          variant: "ghost",
          isIconOnly: true,
        }}
        hasChevron={false}
        menuWidth={224}
        items={[
          {
            label: t("editor.rail.settings"),
            icon: <Settings size={14} aria-hidden />,
            onClick: () => openSettings(),
          },
          {
            label: t("editor.rail.screenRecorder"),
            icon: (
              <Circle
                size={14}
                className="fill-current text-status-error"
                aria-hidden
              />
            ),
            onClick: () => openModal("recorder"),
          },
          { type: "divider" },
          {
            label: t("editor.rail.editorTour"),
            icon: <Play size={14} aria-hidden />,
            onClick: () => {
              localStorage.removeItem(ONBOARDING_KEY);
              startTour();
            },
          },
          {
            label: t("editor.rail.animationTour"),
            icon: <Sparkles size={14} className="text-accent" aria-hidden />,
            onClick: () => {
              localStorage.removeItem(MOGRAPH_TOUR_KEY);
              startMoGraphTour();
            },
          },
          { type: "divider" },
          {
            label: t("editor.rail.helpShortcuts"),
            icon: <HelpCircle size={14} aria-hidden />,
            isDisabled: true,
          },
          {
            label: t("editor.rail.projectJson"),
            icon: <FileCode size={14} aria-hidden />,
            isDisabled: true,
          },
          {
            label: t("editor.rail.cmdK"),
            icon: <Command size={14} aria-hidden />,
            isDisabled: true,
          },
        ]}
      />
    </nav>
  );
};
