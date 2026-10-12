/**
 * Voiceover (配音) panel: engine choice, voice picker, script, preview,
 * "add at playhead" and "voice all subtitles". Synthesis runs in the
 * desktop main process; cloud keys never reach this component.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Cloud,
  Loader2,
  Mic,
  Monitor,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
} from "@/icons/lucide-compat";
import {
  ToolcraftButton as Button,
  ToolcraftCard as Card,
  ToolcraftIconButton as IconButton,
  ToolcraftSelectControl as Selector,
  ToolcraftSliderControl as Slider,
  ToolcraftText as Text,
  ToolcraftTextAreaControl as TextArea,
  ToolcraftTextInputControl as TextInput,
} from "@openreel/ui";
import { toast } from "../../../stores/notification-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { TextToSpeechPanel } from "../inspector/TextToSpeechPanel";
import {
  VOICE_KEY_IDS,
  chooseVoice,
  getVoiceBridge,
  groupVoices,
  keyStatus as fetchKeyStatus,
  listVoices,
  maxTextChars,
  synthesize,
  type CloudVoiceEngine,
  type SynthesizeResult,
  type VoiceEngine,
  type VoiceInfo,
} from "../../../services/voiceover/voiceover-client";
import { placeVoiceover, voiceoverFileName } from "../../../services/voiceover/place-voiceover";
import type { SubtitleLine } from "../../../services/voiceover/subtitle-voiceover";
import { useVoiceoverSettings } from "../../../services/voiceover/voiceover-settings";
import { VoiceKeySetup } from "./VoiceKeySetup";
import { SubtitleVoiceoverSection } from "./SubtitleVoiceoverSection";
import { formatSeconds, languageLabel, voiceErrorText } from "./voice-ui-helpers";

type PanelEngine = VoiceEngine | "elevenlabs";

const ENGINE_OPTIONS: readonly { id: PanelEngine; icon: React.ElementType; free: boolean }[] = [
  { id: "windows", icon: Monitor, free: true },
  { id: "azure", icon: Cloud, free: false },
  { id: "openai", icon: Sparkles, free: false },
  { id: "elevenlabs", icon: Mic, free: false },
];

function isCloud(engine: VoiceEngine): engine is CloudVoiceEngine {
  return engine === "azure" || engine === "openai";
}

const EngineChooser: React.FC<{ value: PanelEngine; onChange(engine: PanelEngine): void; disabled: boolean }> = ({
  value,
  onChange,
  disabled,
}) => {
  const { t } = useTranslation();
  return (
    // One engine per row: the assets column is too narrow for two labelled columns in CJK.
    <div role="radiogroup" aria-label={t("voice.panel.engine")} className="grid grid-cols-1 gap-1.5">
      {ENGINE_OPTIONS.map(({ id, icon: Icon, free }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(id)}
            className={`flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
              active ? "border-accent/60 bg-accent/10 text-fg ring-1 ring-accent/30" : "border-border bg-bg-1 text-fg-2 hover:border-border-strong hover:bg-bg-2"
            }`}
          >
            <Icon size={14} className={active ? "shrink-0 text-accent" : "shrink-0 text-fg-3"} aria-hidden />
            <span className="min-w-0 truncate text-[11px] font-semibold">{t(`voice.panel.engines.${id}`)}</span>
            {free && !active && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-status-success" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
};

function resultSignature(parts: { engine: VoiceEngine; voice: string; text: string; rate?: number; instructions?: string; region?: string }): string {
  return JSON.stringify(parts);
}

export const VoiceoverPanel: React.FC = () => {
  const { t, i18n } = useTranslation();
  const bridgeAvailable = getVoiceBridge() !== null;
  const engine = useVoiceoverSettings((s) => s.engine);
  const setEngine = useVoiceoverSettings((s) => s.setEngine);
  const voiceByEngine = useVoiceoverSettings((s) => s.voiceByEngine);
  const setVoice = useVoiceoverSettings((s) => s.setVoice);
  const azureRegion = useVoiceoverSettings((s) => s.azureRegion);
  const instructions = useVoiceoverSettings((s) => s.openaiInstructions);
  const setInstructions = useVoiceoverSettings((s) => s.setOpenaiInstructions);
  const addConfiguredService = useSettingsStore((s) => s.addConfiguredService);
  const removeConfiguredService = useSettingsStore((s) => s.removeConfiguredService);

  // "elevenlabs" keeps the original OpenReel panel reachable; it is a view choice, not a main-process engine.
  const [showElevenLabs, setShowElevenLabs] = useState(false);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<CloudVoiceEngine, boolean>>({ azure: false, openai: false });
  const [text, setText] = useState("");
  const [rate, setRate] = useState(1);
  const [busy, setBusy] = useState<"preview" | "insert" | "subtitles" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [last, setLast] = useState<{ signature: string; result: SynthesizeResult } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const voice = voiceByEngine[engine] ?? null;
  const cloudReady = !isCloud(engine) || (keys[engine] && (engine !== "azure" || azureRegion.length > 0));
  const maxChars = maxTextChars(engine);

  const refreshKeys = useCallback(async () => {
    if (!bridgeAvailable) return;
    const status = await fetchKeyStatus();
    setKeys(status);
    for (const cloud of ["azure", "openai"] as const) {
      if (status[cloud]) addConfiguredService(VOICE_KEY_IDS[cloud]);
      else removeConfiguredService(VOICE_KEY_IDS[cloud]);
    }
  }, [bridgeAvailable, addConfiguredService, removeConfiguredService]);

  useEffect(() => {
    void refreshKeys().catch(() => undefined);
  }, [refreshKeys]);

  const loadVoices = useCallback(async () => {
    if (!bridgeAvailable) return;
    if (isCloud(engine) && !cloudReady) {
      setVoices([]);
      return;
    }
    setLoadingVoices(true);
    setVoiceError(null);
    try {
      const list = await listVoices(engine, engine === "azure" ? azureRegion : undefined);
      setVoices(list);
      const chosen = chooseVoice(engine, list, useVoiceoverSettings.getState().voiceByEngine[engine]);
      if (chosen) setVoice(engine, chosen);
    } catch (caught) {
      setVoices([]);
      setVoiceError(voiceErrorText(t, caught));
    } finally {
      setLoadingVoices(false);
    }
  }, [bridgeAvailable, engine, cloudReady, azureRegion, setVoice, t]);

  useEffect(() => {
    void loadVoices();
  }, [loadVoices]);

  const stopPreview = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const voiceOptions = useMemo(
    () =>
      groupVoices(voices, i18n.language).map((group) => ({
        type: "section" as const,
        title: languageLabel(group.language, i18n.language, t("voice.panel.multilingual")),
        options: group.voices.map((item) => ({
          value: item.id,
          label: item.name !== item.id ? `${item.name} · ${item.id}` : item.name,
        })),
      })),
    [voices, i18n.language, t],
  );

  const request = useMemo(
    () => ({
      engine,
      voice: voice ?? "",
      text: text.trim(),
      rate: rate === 1 ? undefined : rate,
      instructions: engine === "openai" && instructions.trim() ? instructions.trim() : undefined,
      azureRegion: engine === "azure" ? azureRegion : undefined,
    }),
    [engine, voice, text, rate, instructions, azureRegion],
  );
  const signature = resultSignature({ ...request, region: request.azureRegion });
  const canSynthesize = bridgeAvailable && cloudReady && Boolean(voice) && request.text.length > 0 && request.text.length <= maxChars;

  /** Reuses the last result when nothing changed (no second cloud charge). */
  const obtain = async (): Promise<SynthesizeResult> => {
    if (last?.signature === signature) return last.result;
    const result = await synthesize(request);
    setLast({ signature, result });
    return result;
  };

  const preview = async () => {
    if (playing) {
      stopPreview();
      return;
    }
    setBusy("preview");
    setError(null);
    try {
      const result = await obtain();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: "audio/wav" }));
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.src = urlRef.current;
      audio.onended = () => setPlaying(false);
      await audio.play();
      setPlaying(true);
    } catch (caught) {
      setError(voiceErrorText(t, caught));
    } finally {
      setBusy(null);
    }
  };

  const insert = async () => {
    setBusy("insert");
    setError(null);
    try {
      const result = await obtain();
      const start = useTimelineStore.getState().playheadPosition;
      await placeVoiceover(
        {
          bytes: result.bytes,
          name: voiceoverFileName(request.text, t("voice.panel.clipPrefix")),
          startSeconds: start,
          durationSec: result.durationSec,
        },
        { trackName: t("voice.panel.trackName") },
      );
      toast.success(t("voice.panel.inserted", { time: formatSeconds(start) }));
    } catch (caught) {
      setError(voiceErrorText(t, caught));
    } finally {
      setBusy(null);
    }
  };

  const voiceLine = useCallback(
    async (line: SubtitleLine) => {
      const result = await synthesize({ ...request, text: line.text });
      await placeVoiceover(
        {
          bytes: result.bytes,
          name: voiceoverFileName(line.text, t("voice.panel.clipPrefix")),
          startSeconds: line.startTime,
          durationSec: result.durationSec,
        },
        { trackName: t("voice.panel.trackName") },
      );
    },
    [request, t],
  );

  const changeEngine = (next: PanelEngine) => {
    stopPreview();
    setError(null);
    setShowElevenLabs(next === "elevenlabs");
    if (next !== "elevenlabs") setEngine(next);
  };

  const panelEngine: PanelEngine = showElevenLabs ? "elevenlabs" : engine;

  return (
    <div className="w-full min-w-0 max-w-full space-y-3">
      <Card variant="green" padding={2} className="flex items-center gap-2.5 border border-primary/30">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15">
          <Mic size={16} className="text-primary" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <Text type="body" color="primary" weight="bold" display="block" className="text-[12px]">
            {t("voice.panel.title")}
          </Text>
          <Text type="supporting" color="secondary" display="block" className="text-[9px]">
            {t("voice.panel.subtitle")}
          </Text>
        </div>
      </Card>

      <div className="space-y-1.5">
        <Text type="supporting" color="secondary" weight="bold" className="px-0.5 text-[10px]">
          {t("voice.panel.engine")}
        </Text>
        <EngineChooser value={panelEngine} onChange={changeEngine} disabled={busy !== null} />
        <Text type="supporting" color="secondary" display="block" className="px-0.5 text-[9px] leading-relaxed">
          {t(`voice.panel.engineHints.${panelEngine}`)}
        </Text>
      </div>

      {showElevenLabs ? (
        <TextToSpeechPanel />
      ) : !bridgeAvailable ? (
        <Card variant="yellow" padding={2} className="border border-amber-500/30">
          <Text type="supporting" className="text-[10px] text-amber-400">
            {t("voice.panel.desktopOnly")}
          </Text>
        </Card>
      ) : (
        <>
          {isCloud(engine) && <VoiceKeySetup engine={engine} configured={keys[engine]} onChanged={() => void refreshKeys()} />}

          <div className="space-y-1">
            <div className="flex items-end gap-1.5">
              <div className="min-w-0 flex-1">
                <Selector
                  label={t("voice.panel.voice")}
                  value={voice ?? ""}
                  onChange={(value) => setVoice(engine, value)}
                  options={voiceOptions}
                  hasSearch={voices.length > 8}
                  searchPlaceholder={t("voice.panel.searchVoices")}
                  placeholder={loadingVoices ? t("voice.panel.loadingVoices") : t("voice.panel.voicePlaceholder")}
                  isDisabled={loadingVoices || voices.length === 0}
                  size="sm"
                  width="100%"
                />
              </div>
              <IconButton
                label={t("voice.panel.refreshVoices")}
                icon={loadingVoices ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <RefreshCw size={13} aria-hidden />}
                variant="ghost"
                size="sm"
                isDisabled={loadingVoices || !cloudReady}
                onClick={() => void loadVoices()}
              />
            </div>
            {!loadingVoices && cloudReady && voices.length === 0 && (
              <Text type="supporting" display="block" className="text-[9px] text-status-warning">
                {voiceError ?? t("voice.panel.noVoices")}
              </Text>
            )}
          </div>

          <div className="space-y-1">
            <TextArea
              label={t("voice.panel.text")}
              value={text}
              onChange={setText}
              placeholder={t("voice.panel.textPlaceholder")}
              maxLength={maxChars}
              rows={5}
              width="100%"
            />
            <div className="flex justify-end">
              <Text type="supporting" className={`text-[9px] tabular-nums ${text.length > maxChars * 0.9 ? "text-status-error" : "text-fg-3"}`}>
                {text.length}/{maxChars}
              </Text>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Text type="supporting" color="secondary" weight="bold" className="text-[10px]">
                {t("voice.panel.rate")}
              </Text>
              {rate !== 1 ? (
                <button type="button" className="text-[9px] text-accent hover:underline" onClick={() => setRate(1)}>
                  {t("voice.panel.rateNatural")}
                </button>
              ) : (
                <Text type="supporting" className="text-[9px] text-fg-3">
                  {t("voice.panel.rateNatural")}
                </Text>
              )}
            </div>
            <Slider
              ariaLabel={t("voice.panel.rate")}
              isLabelHidden
              value={rate}
              onChange={(value) => setRate(Math.round(value * 20) / 20)}
              min={0.5}
              max={2}
              step={0.05}
              formatValue={(value) => `${value.toFixed(2)}×`}
              width="100%"
            />
          </div>

          {engine === "openai" && (
            <TextInput
              label={t("voice.panel.instructions")}
              value={instructions}
              onChange={setInstructions}
              placeholder={t("voice.panel.instructionsPlaceholder")}
              maxLength={1000}
              size="sm"
              width="100%"
            />
          )}

          {error && (
            <Card variant="red" padding={2} className="border border-red-500/30" role="alert">
              <Text type="supporting" className="text-[10px] text-red-400">
                {error}
              </Text>
            </Card>
          )}

          <div className="grid grid-cols-[auto_1fr] gap-1.5">
            <Button
              label={busy === "preview" ? t("voice.panel.generating") : playing ? t("voice.panel.stopPreview") : t("voice.panel.preview")}
              icon={
                busy === "preview" ? (
                  <Loader2 size={13} className="animate-spin" aria-hidden />
                ) : playing ? (
                  <Square size={12} aria-hidden />
                ) : (
                  <Play size={13} aria-hidden />
                )
              }
              variant="secondary"
              isDisabled={busy !== null || (!playing && !canSynthesize)}
              onClick={() => void preview()}
            />
            <Button
              label={busy === "insert" ? t("voice.panel.generating") : t("voice.panel.insert")}
              icon={busy === "insert" ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Plus size={13} aria-hidden />}
              variant="primary"
              isDisabled={busy !== null || !canSynthesize}
              onClick={() => void insert()}
            />
          </div>
          {last?.signature === signature && (
            <Text type="supporting" color="secondary" display="block" className="text-right text-[9px] tabular-nums">
              {last.result.voice} · {t("voice.panel.duration", { seconds: last.result.durationSec.toFixed(1) })}
            </Text>
          )}

          <SubtitleVoiceoverSection
            enabled={busy === null && cloudReady && Boolean(voice)}
            voiceLine={voiceLine}
            onBusyChange={(running) => setBusy(running ? "subtitles" : null)}
          />
        </>
      )}
    </div>
  );
};

export default VoiceoverPanel;
