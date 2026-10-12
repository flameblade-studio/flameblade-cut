import React, { useCallback } from "react";
import { ToolcraftSwitchControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl as TextInput } from "@openreel/ui";
import { useSettingsStore, SERVICE_REGISTRY, type TtsProvider, type LlmProvider, type AggregatorProvider } from "../../../stores/settings-store";
import { useProjectStore } from "../../../stores/project-store";
import { EDITING_FRAME_RATE_OPTIONS } from "../editing-frame-rate";
import { useTranslation } from "react-i18next";
import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  isAppLanguage,
  setLanguage,
} from "@/i18n";

/** `id` selects the translated label under `settings.general.presets`. */
const ASPECT_PRESETS: Array<{ id: string; width: number; height: number }> = [
  { id: "landscape1080", width: 1920, height: 1080 },
  { id: "vertical", width: 1080, height: 1920 },
  { id: "square", width: 1080, height: 1080 },
  { id: "portrait", width: 1080, height: 1350 },
  { id: "standard", width: 1440, height: 1080 },
  { id: "cinematic", width: 2560, height: 1080 },
  { id: "landscape4k", width: 3840, height: 2160 },
];

const AUTO_SAVE_MINUTES = [1, 2, 5, 10, 15, 30] as const;

const BACKGROUND_SWATCHES = [
  "#000000",
  "#FFFFFF",
  "#1E1E1E",
  "#2563EB",
  "#DC2626",
  "#16A34A",
  "#F59E0B",
  "#9333EA",
  "#DB2777",
  "#0EA5E9",
];

export const GeneralPanel: React.FC = () => {
  const {
    autoSave,
    autoSaveInterval,
    defaultTtsProvider,
    defaultLlmProvider,
    llmBaseUrl,
    llmModel,
    defaultAggregator,
    configuredServices,
    setAutoSave,
    setAutoSaveInterval,
    setDefaultTtsProvider,
    setDefaultLlmProvider,
    setLlmBaseUrl,
    setLlmModel,
    setDefaultAggregator,
  } = useSettingsStore();
  const { t, i18n } = useTranslation();
  const currentLanguage = isAppLanguage(i18n.language) ? i18n.language : "en";
  const projectWidth = useProjectStore((s) => s.project.settings.width);
  const projectHeight = useProjectStore((s) => s.project.settings.height);
  const projectFrameRate = useProjectStore(
    (s) => s.project.settings.frameRate,
  );
  const updateProjectSettings = useProjectStore((s) => s.updateSettings);
  const backgroundFillMode = useProjectStore(
    (s) => s.project.timeline.backgroundFillMode,
  );
  const layoutBackgroundColor = useProjectStore(
    (s) => s.project.timeline.layoutBackgroundColor,
  );
  const setCanvasBackground = useProjectStore((s) => s.setCanvasBackground);

  const [draftWidth, setDraftWidth] = React.useState(String(projectWidth));
  const [draftHeight, setDraftHeight] = React.useState(String(projectHeight));

  React.useEffect(() => {
    setDraftWidth(String(projectWidth));
    setDraftHeight(String(projectHeight));
  }, [projectWidth, projectHeight]);

  const applyDimensions = useCallback(
    async (width: number, height: number) => {
      const w = Math.max(16, Math.min(7680, Math.round(width)));
      const h = Math.max(16, Math.min(7680, Math.round(height)));
      await updateProjectSettings({ width: w, height: h });
    },
    [updateProjectSettings],
  );

  const handleApplyCustom = useCallback(() => {
    const w = Number(draftWidth);
    const h = Number(draftHeight);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      applyDimensions(w, h);
    }
  }, [draftWidth, draftHeight, applyDimensions]);

  const ttsProviders = SERVICE_REGISTRY.filter((s) => s.id === "elevenlabs");

  const llmProviders = SERVICE_REGISTRY.filter(
    (s) => s.id === "openai-compatible" || s.id === "anthropic-compatible",
  );

  const aggregatorProviders = SERVICE_REGISTRY.filter(
    (s) =>
      s.id === "kie-ai" ||
      s.id === "freepik" ||
      configuredServices.includes(s.id),
  );
  return (
    <div className="space-y-6 pb-4">
      {/* Interface language */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">
            {t("settings.general.language")}
          </Text>
          <Text type="supporting" color="secondary" className="mt-0.5 block text-xs">
            {t("settings.general.languageHint")}
          </Text>
        </div>
        <Selector
          label={t("settings.general.language")}
          isLabelHidden
          size="md"
          width={160}
          value={currentLanguage}
          onChange={(value) => {
            if (isAppLanguage(value)) setLanguage(value);
          }}
          options={SUPPORTED_LANGUAGES.map((language) => ({
            label: LANGUAGE_LABELS[language],
            value: language,
          }))}
        />
      </div>

      <div className="h-px bg-border" />
      {/* Project Composition */}
      <div className="space-y-4">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">
            {t("settings.general.composition")}
          </Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
            {t("settings.general.compositionHint")}
          </Text>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {ASPECT_PRESETS.map((preset) => {
            const isActive =
                preset.width === projectWidth && preset.height === projectHeight;
            return (
              <ClickableCard
                key={preset.id}
                label={t(`settings.general.presets.${preset.id}`)}
                onClick={() => applyDimensions(preset.width, preset.height)}
                padding={3}
                variant={isActive ? "green" : "muted"}
                className={`text-left text-xs border ${
                  isActive
                    ? "border-primary bg-primary/10 text-text-primary"
                    : "border-border bg-background-tertiary text-text-secondary hover:text-text-primary hover:border-primary/40"
                }`}
              >
                <Text type="supporting" color="inherit" className="font-medium">
                  {t(`settings.general.presets.${preset.id}`)}
                </Text>
                <Text type="supporting" color="secondary" className="mt-0.5 text-[10px]">
                  {preset.width} × {preset.height}
                </Text>
              </ClickableCard>
            );
          })}
        </div>

        <div className="flex items-end gap-2">
          <ToolcraftNumberInputControl
            label={t("common.width")}
            size="md"
            width="100%"
            min={16}
            max={7680}
            value={Number.isFinite(Number(draftWidth)) ? Number(draftWidth) : null}
            onChange={(value) => setDraftWidth(String(value))}
          />
          <ToolcraftNumberInputControl
            label={t("common.height")}
            size="md"
            width="100%"
            min={16}
            max={7680}
            value={Number.isFinite(Number(draftHeight)) ? Number(draftHeight) : null}
            onChange={(value) => setDraftHeight(String(value))}
          />
          <Button
            label={t("common.apply")}
            onClick={handleApplyCustom}
            variant="primary"
            size="md"
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background-tertiary p-3">
          <div>
            <Text type="supporting" color="primary" className="text-sm font-medium">
              {t("settings.general.editingFrameRate")}
            </Text>
            <Text type="supporting" color="secondary" className="mt-0.5 block text-[11px]">
              {t("settings.general.editingFrameRateHint")}
            </Text>
          </div>
          <Selector
            label={t("settings.general.editingFrameRate")}
            isLabelHidden
            size="md"
            width={160}
            value={String(projectFrameRate)}
            onChange={(value) => {
              const frameRate = Number(value);
              if (Number.isFinite(frameRate) && frameRate > 0) {
                void updateProjectSettings({ frameRate });
              }
            }}
            options={EDITING_FRAME_RATE_OPTIONS.map((option) => ({
              label: option.label,
              value: String(option.value),
            }))}
          />
        </div>

        <div className="space-y-2">
          <Text type="supporting" color="secondary" className="text-xs font-medium">
            {t("settings.general.backgroundFill")}
          </Text>
          <Text type="supporting" color="secondary" className="text-[11px]">
            {t("settings.general.backgroundFillHint")}
          </Text>
          <div className="flex flex-wrap items-center gap-2">
            <ClickableCard
              label={t("settings.general.noBackgroundFill")}
              onClick={() => setCanvasBackground(undefined, undefined)}
              padding={2}
              variant={!backgroundFillMode ? "green" : "muted"}
              className={`border px-3 py-1.5 text-xs ${
                !backgroundFillMode
                  ? "border-primary bg-primary/10 text-text-primary"
                  : "border-border bg-background-tertiary text-text-secondary hover:text-text-primary"
              }`}
            >
              {t("common.none")}
            </ClickableCard>
            <ClickableCard
              label={t("settings.general.blurBackgroundFill")}
              onClick={() =>
                setCanvasBackground("blur", layoutBackgroundColor)
              }
              padding={2}
              variant={backgroundFillMode === "blur" ? "green" : "muted"}
              className={`border px-3 py-1.5 text-xs ${
                backgroundFillMode === "blur"
                  ? "border-primary bg-primary/10 text-text-primary"
                  : "border-border bg-background-tertiary text-text-secondary hover:text-text-primary"
              }`}
            >
              {t("settings.general.blur")}
            </ClickableCard>
            {BACKGROUND_SWATCHES.map((hex) => {
              const isActive =
                backgroundFillMode === "color" &&
                layoutBackgroundColor?.toLowerCase() === hex.toLowerCase();
              return (
                <ClickableCard
                  key={hex}
                  label={t("settings.general.backgroundColor", { color: hex })}
                  onClick={() => setCanvasBackground("color", hex)}
                  padding={0}
                  variant="transparent"
                  style={{ backgroundColor: hex }}
                  className={`h-6 w-6 rounded-full border-2 transition-transform ${
                    isActive
                      ? "border-primary scale-110"
                      : "border-border hover:scale-105"
                  }`}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Auto-save */}
      <div className="space-y-4">
        <Text type="body" color="primary" className="text-sm font-medium">
          {t("settings.general.autoSave")}
        </Text>

        <div className="flex items-center justify-between">
          <div>
            <Text type="supporting" color="secondary" className="text-sm">
              {t("settings.general.enableAutoSave")}
            </Text>
            <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
              {t("settings.general.enableAutoSaveHint")}
            </Text>
          </div>
          <ToolcraftSwitchControl
            ariaLabel={t("settings.general.enableAutoSave")}
            checked={autoSave}
            onCheckedChange={setAutoSave}
            showLabel={false}
          />
        </div>

        {autoSave && (
          <div className="flex items-center gap-3">
            <Text type="supporting" color="secondary" className="whitespace-nowrap text-sm">
              {t("settings.general.saveEvery")}
            </Text>
            <Selector
              label={t("settings.general.autoSaveInterval")}
              isLabelHidden
              size="md"
              width={150}
              value={String(autoSaveInterval)}
              onChange={(value) => setAutoSaveInterval(Number(value))}
              options={AUTO_SAVE_MINUTES.map((minutes) => ({
                label: t("settings.general.minutes", { count: minutes }),
                value: String(minutes),
              }))}
            />
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* AI connections */}
      <div className="space-y-4">
        <Text type="body" color="primary" className="text-sm font-medium">
          {t("settings.general.aiConnections")}
        </Text>
        <Text type="supporting" color="secondary" className="text-xs">
          {t("settings.general.aiConnectionsHint")}
        </Text>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Text type="supporting" color="secondary" className="text-sm">
              {t("settings.general.ttsLabel")}
            </Text>
            <Selector
              label={t("settings.general.ttsProvider")}
              isLabelHidden
              size="md"
              width={180}
              value={defaultTtsProvider}
              onChange={(value) => setDefaultTtsProvider(value as TtsProvider)}
              options={ttsProviders.map((s) => ({ label: s.label, value: s.id }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <Text type="supporting" color="secondary" className="text-sm">
              {t("settings.general.llmFormat")}
            </Text>
            <Selector
              label={t("settings.general.llmFormat")}
              isLabelHidden
              size="md"
              width={180}
              value={defaultLlmProvider ?? ""}
              onChange={(value) =>
                setDefaultLlmProvider((value || null) as LlmProvider | null)
              }
              options={[
                { label: t("settings.general.chooseFormat"), value: "" },
                ...llmProviders.map((s) => ({ label: s.label, value: s.id })),
              ]}
            />
          </div>

          {defaultLlmProvider ? (
            <div className="space-y-3 rounded-lg border border-border bg-background-tertiary p-3">
              <div>
                <Text type="supporting" color="secondary" className="text-sm font-medium">
                  {defaultLlmProvider === "anthropic-compatible"
                    ? t("settings.general.anthropicEndpoint")
                    : t("settings.general.openaiEndpoint")}
                </Text>
                <Text type="supporting" color="secondary" className="mt-0.5 block text-xs">
                  {t("settings.general.endpointHint")}
                </Text>
              </div>
              <TextInput
                label={t("settings.general.baseUrl")}
                value={llmBaseUrl}
                onChange={setLlmBaseUrl}
                placeholder={
                  defaultLlmProvider === "anthropic-compatible"
                    ? "https://gateway.example/v1"
                    : "http://localhost:11434/v1"
                }
                width="100%"
              />
              <TextInput
                label={t("settings.general.modelId")}
                value={llmModel}
                onChange={setLlmModel}
                placeholder={t("settings.general.modelIdPlaceholder")}
                width="100%"
              />
              <Text type="supporting" color="secondary" className="block text-[11px] leading-relaxed">
                {t("settings.general.modelHint")}
              </Text>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-background-tertiary p-3">
              <Text type="supporting" color="secondary" className="block text-xs">
                {t("settings.general.chooseFormatHint")}
              </Text>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <Text type="supporting" color="secondary" className="text-sm">
                {t("settings.general.aggregator")}
              </Text>
              <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
                {t("settings.general.aggregatorHint")}
              </Text>
            </div>
            <Selector
              label={t("settings.general.aggregatorProvider")}
              isLabelHidden
              size="md"
              width={180}
              value={defaultAggregator}
              onChange={(value) => setDefaultAggregator(value as AggregatorProvider)}
              options={aggregatorProviders.map((s) => ({ label: s.label, value: s.id }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
