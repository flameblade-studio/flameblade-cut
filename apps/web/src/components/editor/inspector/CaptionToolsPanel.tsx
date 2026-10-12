/**
 * Caption tools for existing captions: Traditional/Simplified conversion,
 * word highlight, bilingual second line (OpenAI via the desktop bridge),
 * social safe-area placement, and SRT / transcript export.
 *
 * Acts on the selected captions, or on all captions when none are selected.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TextClip } from "@openreel/core";
import {
  CAPTION_HIGHLIGHT_COLOR_METADATA_KEY,
  CAPTION_WORDS_METADATA_KEY,
} from "@openreel/core";
import {
  ToolcraftButton as Button,
  ToolcraftCard as Card,
  ToolcraftSelectControl as Selector,
  ToolcraftText as Text,
} from "@openreel/ui";
import { FileText, Languages, Loader2, Smartphone, Subtitles } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import {
  CAPTION_SPOKEN_TEXT_KEY,
  captionOriginalText,
  captionsToSrt,
  captionsToTranscript,
  hasTranslation,
  withOriginalText,
  withTranslation,
  withoutTranslation,
} from "../../../services/captions/caption-documents";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  reconcileWords,
  withWordHighlight,
} from "../../../services/captions/caption-pipeline";
import {
  TRANSLATION_TARGETS,
  getCaptionTranslationBridge,
  translateCaptionLines,
  type TranslationTargetId,
} from "../../../services/captions/caption-translation";
import { loadChineseConverter, type ChineseScriptTarget } from "../../../services/captions/chinese-script";
import type { TimedWord } from "../../../services/captions/line-breaking";
import {
  SAFE_AREA_PLATFORM_IDS,
  SAFE_AREA_PRESETS,
  estimateCaptionBlockSize,
  isSafeAreaPlatformId,
  placeBlockInSafeArea,
} from "../../../services/captions/safe-area";
import { useSafeAreaGuideStore } from "../../../services/captions/safe-area-store";
import { CaptionToggle } from "./CaptionToggle";

interface CaptionToolsPanelProps {
  captions: readonly TextClip[];
  selectedIds: ReadonlySet<string>;
}

function wordsOf(clip: TextClip): TimedWord[] | null {
  const words = clip.metadata?.[CAPTION_WORDS_METADATA_KEY];
  return Array.isArray(words) ? (words as TimedWord[]) : null;
}

function defaultTarget(uiLanguage: string): TranslationTargetId {
  return uiLanguage.startsWith("zh") || uiLanguage === "ja" ? "en" : "zh-TW";
}

export const CaptionToolsPanel: React.FC<CaptionToolsPanelProps> = ({ captions, selectedIds }) => {
  const { t, i18n } = useTranslation();
  const project = useProjectStore((state) => state.project);
  const updateTextContent = useProjectStore((state) => state.updateTextContent);
  const updateTextMetadata = useProjectStore((state) => state.updateTextMetadata);
  const updateTextTransform = useProjectStore((state) => state.updateTextTransform);
  const platform = useSafeAreaGuideStore((state) => state.platform);
  const lastPlatform = useSafeAreaGuideStore((state) => state.lastPlatform);
  const setPlatform = useSafeAreaGuideStore((state) => state.setPlatform);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<TranslationTargetId>(() => defaultTarget(i18n.language));
  const [highlightColor, setHighlightColor] = useState(DEFAULT_HIGHLIGHT_COLOR);
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const bridge = getCaptionTranslationBridge();

  useEffect(() => {
    let active = true;
    if (!bridge) return;
    bridge
      .keyStatus?.()
      .then((result) => active && setKeyConfigured(result.configured))
      .catch(() => active && setKeyConfigured(false));
    return () => {
      active = false;
    };
  }, [bridge]);

  const targets = useMemo(
    () => (selectedIds.size > 0 ? captions.filter((clip) => selectedIds.has(clip.id)) : [...captions]),
    [captions, selectedIds],
  );
  const highlightOn = targets.some(
    (clip) => typeof clip.metadata?.[CAPTION_HIGHLIGHT_COLOR_METADATA_KEY] === "string",
  );
  const translationAvailable = Boolean(bridge) && keyConfigured !== false;
  const safePlatform = platform ?? lastPlatform;

  const inHistoryGroup = (label: string, apply: () => void) => {
    const history = useProjectStore.getState().actionExecutor.getHistory();
    history.beginGroup(label);
    try {
      apply();
    } finally {
      history.endGroup();
    }
  };

  const convertScript = async (script: ChineseScriptTarget) => {
    setBusy(true);
    try {
      const convert = await loadChineseConverter(script);
      let changed = 0;
      inHistoryGroup(t("captions.tools.convertHistory"), () => {
        for (const clip of targets) {
          const original = captionOriginalText(clip);
          const converted = convert(original);
          if (converted === original) continue;
          const next = withOriginalText(clip, converted);
          const spoken = clip.metadata?.[CAPTION_SPOKEN_TEXT_KEY];
          const words = wordsOf(clip);
          updateTextContent(clip.id, next.text);
          updateTextMetadata(clip.id, {
            ...next.metadata,
            ...(typeof spoken === "string" ? { [CAPTION_SPOKEN_TEXT_KEY]: convert(spoken) } : {}),
            ...(words
              ? { [CAPTION_WORDS_METADATA_KEY]: reconcileWords(converted, words, clip.duration, convert) }
              : {}),
          });
          changed += 1;
        }
      });
      setStatus(t("captions.tools.converted", { count: changed }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const setHighlight = (enabled: boolean, color = highlightColor) => {
    inHistoryGroup(t("captions.common.wordHighlight"), () => {
      for (const clip of targets) {
        updateTextMetadata(
          clip.id,
          withWordHighlight(clip, enabled ? color : null, captionOriginalText(clip)),
        );
      }
    });
  };

  const translate = async () => {
    if (!bridge) return;
    setBusy(true);
    setStatus(t("captions.tools.translating", { done: 0, total: targets.length }));
    try {
      const outcome = await translateCaptionLines(
        targets.map((clip) => ({ id: clip.id, text: captionOriginalText(clip) })),
        target,
        bridge,
        { onProgress: (done, total) => setStatus(t("captions.tools.translating", { done, total })) },
      );
      const byId = new Map(captions.map((clip) => [clip.id, clip]));
      inHistoryGroup(t("captions.tools.bilingual"), () => {
        for (const [id, translation] of outcome.translations) {
          const clip = byId.get(id);
          if (!clip) continue;
          const next = withTranslation(clip, translation, target);
          updateTextContent(id, next.text);
          updateTextMetadata(id, next.metadata);
        }
      });
      setStatus(
        outcome.failedIds.length > 0
          ? t("captions.tools.translateFailed", {
              count: outcome.failedIds.length,
              done: outcome.translations.size,
              error: outcome.firstError ?? "",
            })
          : t("captions.tools.translated", { count: outcome.translations.size }),
      );
    } finally {
      setBusy(false);
    }
  };

  const removeTranslations = () => {
    inHistoryGroup(t("captions.tools.removeTranslation"), () => {
      for (const clip of targets) {
        if (!hasTranslation(clip)) continue;
        const next = withoutTranslation(clip);
        updateTextContent(clip.id, next.text);
        updateTextMetadata(clip.id, next.metadata);
      }
    });
  };

  const placeInSafeArea = () => {
    const preset = SAFE_AREA_PRESETS[safePlatform];
    const frame = { width: project.settings.width, height: project.settings.height };
    let moved = 0;
    inHistoryGroup(t("captions.tools.placeSafe"), () => {
      for (const clip of targets) {
        const size = estimateCaptionBlockSize(
          clip.text,
          clip.style.fontSize * Math.abs(clip.transform.scale.y || 1),
          clip.style.lineHeight,
          frame,
        );
        const next = placeBlockInSafeArea(clip.transform.position, size, preset.safe);
        if (next.x === clip.transform.position.x && next.y === clip.transform.position.y) continue;
        updateTextTransform(clip.id, { position: next });
        moved += 1;
      }
    });
    if (!platform) setPlatform(safePlatform);
    setStatus(t("captions.tools.placed", { count: moved, platform: preset.label }));
  };

  const saveText = async (content: string, defaultName: string, extension: string) => {
    const fs = window.openreel?.fs;
    if (!fs) {
      setStatus(t("captions.tools.desktopOnly"));
      return;
    }
    try {
      const path = await fs.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
      });
      if (!path) return;
      await fs.writeFile(path, content);
      setStatus(t("captions.tools.saved", { path }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const baseName = (project.name || "captions").replace(/[\\/:*?"<>|]+/g, "_");
  const noCaptions = captions.length === 0;

  return (
    <Card variant="muted" padding={3} className="space-y-3 border border-border">
      <div className="flex items-center gap-1.5">
        <Subtitles size={14} className="text-accent" aria-hidden />
        <Text type="supporting" weight="bold" className="text-[11px] text-fg">
          {t("captions.tools.title")}
        </Text>
      </div>
      <Text type="supporting" color="secondary" className="block text-[9px]">
        {selectedIds.size > 0
          ? t("captions.tools.scopeSelected", { count: targets.length })
          : t("captions.tools.scopeAll", { count: targets.length })}
      </Text>

      <div className="grid grid-cols-2 gap-2">
        <Button
          label={t("captions.tools.toTraditional")}
          variant="secondary"
          size="sm"
          isDisabled={busy || noCaptions}
          onClick={() => void convertScript("traditional")}
          className="justify-center"
        />
        <Button
          label={t("captions.tools.toSimplified")}
          variant="secondary"
          size="sm"
          isDisabled={busy || noCaptions}
          onClick={() => void convertScript("simplified")}
          className="justify-center"
        />
      </div>

      <CaptionToggle
        label={t("captions.common.wordHighlight")}
        checked={highlightOn}
        disabled={busy || noCaptions}
        onChange={(enabled) => setHighlight(enabled)}
        color={highlightOn ? highlightColor : undefined}
        onColorChange={(color) => {
          setHighlightColor(color);
          setHighlight(true, color);
        }}
        colorLabel={t("captions.common.highlightColor")}
      />

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Languages size={13} className="text-fg-2" aria-hidden />
            <Text type="supporting" color="secondary" className="text-[10px]">
              {t("captions.tools.bilingual")}
            </Text>
          </div>
          <Selector
            label={t("captions.tools.secondLanguage")}
            isLabelHidden
            size="sm"
            width={112}
            value={target}
            onChange={(value) => setTarget(value as TranslationTargetId)}
            isDisabled={busy || !translationAvailable}
            options={TRANSLATION_TARGETS.map((entry) => ({ label: entry.label, value: entry.id }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            label={t("captions.tools.translate")}
            icon={busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : undefined}
            variant="secondary"
            size="sm"
            isDisabled={busy || noCaptions || !translationAvailable}
            onClick={() => void translate()}
            className="justify-center"
          />
          <Button
            label={t("captions.tools.removeTranslation")}
            variant="secondary"
            size="sm"
            isDisabled={busy || !targets.some(hasTranslation)}
            onClick={removeTranslations}
            className="justify-center"
          />
        </div>
        {!translationAvailable && (
          <Text type="supporting" color="secondary" className="block text-[9px]">
            {t("captions.tools.needsKey")}
          </Text>
        )}
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Smartphone size={13} className="text-fg-2" aria-hidden />
            <Text type="supporting" color="secondary" className="text-[10px]">
              {t("captions.safeArea.title")}
            </Text>
          </div>
          <Selector
            label={t("captions.safeArea.platform")}
            isLabelHidden
            size="sm"
            width={132}
            value={safePlatform}
            onChange={(value) => isSafeAreaPlatformId(value) && setPlatform(value)}
            options={SAFE_AREA_PLATFORM_IDS.map((id) => ({ label: SAFE_AREA_PRESETS[id].label, value: id }))}
          />
        </div>
        <Button
          label={t("captions.tools.placeSafe")}
          variant="secondary"
          size="sm"
          isDisabled={busy || noCaptions}
          onClick={placeInSafeArea}
          className="w-full justify-center"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
        <Button
          label={t("captions.tools.exportSrt")}
          icon={<FileText size={12} aria-hidden />}
          variant="secondary"
          size="sm"
          isDisabled={noCaptions}
          onClick={() => void saveText(captionsToSrt(captions), `${baseName}.srt`, "srt")}
          className="justify-center"
        />
        <Button
          label={t("captions.tools.exportTranscript")}
          icon={<FileText size={12} aria-hidden />}
          variant="secondary"
          size="sm"
          isDisabled={noCaptions}
          onClick={() => void saveText(captionsToTranscript(captions), `${baseName}.txt`, "txt")}
          className="justify-center"
        />
      </div>

      {status && (
        <Text type="supporting" color="secondary" role="status" className="block text-[9px]">
          {status}
        </Text>
      )}
    </Card>
  );
};
