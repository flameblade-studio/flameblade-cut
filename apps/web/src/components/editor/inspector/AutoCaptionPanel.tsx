import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { SUBTITLE_STYLE_PRESETS } from "@openreel/core";
import {
  ToolcraftButton as Button,
  ToolcraftCard as Card,
  ToolcraftSelectControl as Selector,
  ToolcraftText as Text,
} from "@openreel/ui";
import {
  AlertCircle,
  Check,
  Download,
  Languages,
  Loader2,
  Sparkles,
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { loadAudioBuffer } from "../../../utils/load-audio-buffer";
import { audioBufferToWhisperSamples } from "../../../utils/whisper-audio";
import {
  DEFAULT_WHISPER_MODEL,
  WHISPER_MODELS,
  isWhisperModelKey,
  type WhisperModelKey,
} from "../../../workers/whisper-models";
import {
  isChineseLanguage,
  loadChineseConverter,
} from "../../../services/captions/chinese-script";
import {
  buildCaptionCues,
  cueClipMetadata,
  DEFAULT_HIGHLIGHT_COLOR,
} from "../../../services/captions/caption-pipeline";
import {
  DEFAULT_LINE_BREAK_OPTIONS,
  defaultMaxCharsForLanguage,
  type CaptionCue,
  type TranscriptSegment,
} from "../../../services/captions/line-breaking";
import { CaptionToggle } from "./CaptionToggle";

const CAPTION_STYLE_PRESETS = [
  "default",
  "modern",
  "bold",
  "cinematic",
  "minimal",
] as const;
const WHISPER_LANGUAGES = [
  "en",
  "fr",
  "de",
  "es",
  "it",
  "pt",
  "hi",
  "ja",
  "ko",
  "zh",
  "ru",
  "tr",
  "pl",
  "vi",
] as const;
const CJK_LANGUAGES = new Set(["zh", "ja", "ko"]);

/** Whisper language that matches the UI language, so captions default sensibly. */
function defaultCaptionLanguage(uiLanguage: string): string {
  if (uiLanguage.startsWith("zh")) return "zh";
  if (uiLanguage.startsWith("ja")) return "ja";
  return "en";
}

interface AutoCaptionPanelProps {
  clipId?: string;
  maxWordsPerLine?: number;
}

interface WorkerChunk {
  text: string;
  timestamp: [number | null, number | null];
}

interface WorkerResult {
  text?: string;
  chunks?: WorkerChunk[];
  granularity?: "word" | "segment";
}

type WorkerState = "idle" | "loading" | "ready";

export const AutoCaptionPanel: React.FC<AutoCaptionPanelProps> = ({
  clipId,
  maxWordsPerLine = 5,
}) => {
  const { t, i18n } = useTranslation();
  const getClip = useProjectStore((state) => state.getClip);
  const getMediaItem = useProjectStore((state) => state.getMediaItem);
  const addSubtitle = useProjectStore((state) => state.addSubtitle);
  const workerRef = useRef<Worker | null>(null);
  const [workerState, setWorkerState] = useState<WorkerState>("idle");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState(() =>
    defaultCaptionLanguage(i18n.language),
  );
  const [traditionalOutput, setTraditionalOutput] = useState(
    () => i18n.language === "zh-TW",
  );
  const [maxChars, setMaxChars] = useState(() =>
    defaultMaxCharsForLanguage(defaultCaptionLanguage(i18n.language)),
  );
  const [stripPunctuation, setStripPunctuation] = useState(
    () => defaultCaptionLanguage(i18n.language) === "zh",
  );
  const [wordHighlight, setWordHighlight] = useState(false);
  const [highlightColor, setHighlightColor] = useState(DEFAULT_HIGHLIGHT_COLOR);
  const [selectedStyle, setSelectedStyle] = useState<string>("default");
  const [selectedModel, setSelectedModel] = useState<WhisperModelKey>(
    DEFAULT_WHISPER_MODEL,
  );
  const [readyModels, setReadyModels] = useState<Set<WhisperModelKey>>(
    () => new Set(),
  );
  const [modelBackends, setModelBackends] = useState<
    Partial<Record<WhisperModelKey, "webgpu" | "wasm">>
  >({});
  const [segments, setSegments] = useState<CaptionCue[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selectedItems = useUIStore((state) => state.selectedItems);
  const resolvedClipId =
    clipId ?? selectedItems.find((item) => item.type === "clip")?.id ?? "";
  const clip = getClip(resolvedClipId);
  const mediaItem = clip ? getMediaItem(clip.mediaId) : undefined;
  const canTranscribe = Boolean(
    clip &&
    mediaItem &&
    (mediaItem.type === "video" || mediaItem.type === "audio"),
  );

  useEffect(() => {
    const worker = new Worker(
      new URL("../../../workers/whisper-worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const runWorker = useCallback(
    (
      type: "load" | "transcribe",
      audio?: Float32Array,
    ): Promise<WorkerResult> => {
      const worker = workerRef.current;
      if (!worker)
        return Promise.reject(new Error(t("captions.auto.workerNotReady")));
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const handleMessage = (
          event: MessageEvent<Record<string, unknown>>,
        ) => {
          if (event.data.requestId !== requestId) return;
          const messageType = event.data.type;
          if (messageType === "model-progress") {
            setWorkerState("loading");
            const rawProgress = Number(event.data.progress ?? 0);
            setProgress(rawProgress > 1 ? rawProgress / 100 : rawProgress);
            const file = String(event.data.file ?? "caption model")
              .split("/")
              .pop();
            setProgressMessage(
              t("captions.auto.downloading", {
                file: file || t("captions.auto.captionModel"),
              }),
            );
          } else if (messageType === "transcription-progress") {
            setWorkerState("ready");
            setProgress(Number(event.data.progress ?? 0));
            setProgressMessage(t("captions.auto.transcribingClip"));
          } else if (messageType === "ready") {
            worker.removeEventListener("message", handleMessage);
            setWorkerState("ready");
            setReadyModels((current) => new Set(current).add(selectedModel));
            const backend = event.data.backend;
            if (backend === "webgpu" || backend === "wasm") {
              setModelBackends((current) => ({
                ...current,
                [selectedModel]: backend,
              }));
            }
            setProgress(1);
            setProgressMessage(t("captions.auto.modelReady"));
            resolve({});
          } else if (messageType === "result") {
            worker.removeEventListener("message", handleMessage);
            setWorkerState("ready");
            setReadyModels((current) => new Set(current).add(selectedModel));
            const backend = event.data.backend;
            if (backend === "webgpu" || backend === "wasm") {
              setModelBackends((current) => ({
                ...current,
                [selectedModel]: backend,
              }));
            }
            setProgress(1);
            resolve({
              text: String(event.data.text ?? ""),
              chunks: (event.data.chunks ?? []) as WorkerChunk[],
              granularity:
                event.data.granularity === "word" ? "word" : "segment",
            });
          } else if (messageType === "error") {
            worker.removeEventListener("message", handleMessage);
            reject(
              new Error(
                String(event.data.message ?? t("captions.auto.failed")),
              ),
            );
          }
        };
        worker.addEventListener("message", handleMessage);
        if (audio) {
          worker.postMessage(
            {
              requestId,
              type,
              audio,
              language: selectedLanguage,
              model: selectedModel,
              wordTimestamps: true,
            },
            [audio.buffer],
          );
        } else {
          worker.postMessage({
            requestId,
            type,
            language: selectedLanguage,
            model: selectedModel,
          });
        }
      });
    },
    [selectedLanguage, selectedModel, t],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      if (!isWhisperModelKey(value)) return;
      setSelectedModel(value);
      setSegments([]);
      setError(null);
      setProgress(readyModels.has(value) ? 1 : 0);
      setProgressMessage(
        readyModels.has(value) ? t("captions.auto.modelReady") : "",
      );
      setWorkerState(readyModels.has(value) ? "ready" : "idle");
    },
    [readyModels, t],
  );

  const handleLanguageChange = useCallback((value: string) => {
    setSelectedLanguage(value);
    setMaxChars(defaultMaxCharsForLanguage(value));
    setStripPunctuation(value === "zh");
    setSegments([]);
  }, []);

  const handlePrepareModel = useCallback(async () => {
    setError(null);
    setWorkerState("loading");
    setProgress(0);
    setProgressMessage(t("captions.auto.preparing"));
    try {
      await runWorker("load");
    } catch (reason) {
      setWorkerState("idle");
      setError(
        reason instanceof Error
          ? reason.message
          : t("captions.auto.modelDownloadFailed"),
      );
    }
  }, [runWorker, t]);

  const handleTranscribe = useCallback(async () => {
    if (!clip || !mediaItem) return;
    setError(null);
    setSegments([]);
    setIsTranscribing(true);
    setProgress(0);
    setProgressMessage(t("captions.auto.extracting"));

    let audioContext: AudioContext | null = null;
    try {
      const sourceBlob =
        mediaItem.blob ??
        (mediaItem.fileHandle ? await mediaItem.fileHandle.getFile() : null);
      if (!sourceBlob) {
        throw new Error(t("captions.auto.reconnect"));
      }
      audioContext = new AudioContext();
      const audioBuffer = await loadAudioBuffer(audioContext, sourceBlob, {
        audioTrackIndex: clip.audioTrackIndex,
        onProgress: (next) => {
          setProgress(next.progress * 0.18);
          setProgressMessage(next.message);
        },
      });
      if (!audioBuffer) throw new Error(t("captions.auto.decodeFailed"));

      const sourceStart = Math.max(0, clip.inPoint ?? 0);
      const sourceEnd = Math.min(
        audioBuffer.duration,
        clip.outPoint > sourceStart
          ? clip.outPoint
          : sourceStart + clip.duration * Math.max(clip.speed ?? 1, 0.01),
      );
      const samples = audioBufferToWhisperSamples(
        audioBuffer,
        sourceStart,
        sourceEnd,
      );
      setProgress(0.2);
      setProgressMessage(
        workerState === "ready"
          ? t("captions.auto.transcribingWith", {
              model: WHISPER_MODELS[selectedModel].shortLabel,
            })
          : t("captions.auto.downloadingThenTranscribing", {
              model: WHISPER_MODELS[selectedModel].shortLabel,
            }),
      );
      const result = await runWorker("transcribe", samples);
      const sourceDuration = Math.max(0.1, sourceEnd - sourceStart);
      const playbackSpeed = Math.max(clip.speed ?? 1, 0.01);
      const clipEndTime = clip.startTime + clip.duration;
      const toTimeline = (sourceSeconds: number) =>
        Math.min(clipEndTime, clip.startTime + sourceSeconds / playbackSpeed);
      const timedChunks = (result.chunks ?? [])
        .map((chunk) => {
          const start = Math.max(0, chunk.timestamp?.[0] ?? 0);
          const end = Math.min(
            sourceDuration,
            chunk.timestamp?.[1] ?? Math.min(sourceDuration, start + 3),
          );
          return {
            text: chunk.text,
            startTime: toTimeline(start),
            endTime: toTimeline(Math.max(start + 0.05, end)),
          };
        })
        .filter(
          (chunk) =>
            chunk.text.trim().length > 0 && chunk.endTime > chunk.startTime,
        );
      const transcript: TranscriptSegment[] =
        result.granularity === "word" && timedChunks.length > 0
          ? [
              {
                text: timedChunks.map((chunk) => chunk.text).join(""),
                startTime: timedChunks[0].startTime,
                endTime: timedChunks[timedChunks.length - 1].endTime,
                words: timedChunks.map((chunk) => ({
                  text: chunk.text,
                  start: chunk.startTime,
                  end: chunk.endTime,
                })),
              },
            ]
          : timedChunks;
      if (transcript.length === 0 && result.text?.trim()) {
        transcript.push({
          text: result.text.trim(),
          startTime: clip.startTime,
          endTime: clipEndTime,
        });
      }
      const convert =
        traditionalOutput && isChineseLanguage(selectedLanguage)
          ? await loadChineseConverter("traditional")
          : null;
      const latin = !CJK_LANGUAGES.has(selectedLanguage);
      const nextSegments = buildCaptionCues(transcript, {
        maxCharsCjk: latin ? DEFAULT_LINE_BREAK_OPTIONS.maxCharsCjk : maxChars,
        maxCharsLatin: latin
          ? maxChars
          : DEFAULT_LINE_BREAK_OPTIONS.maxCharsLatin,
        stripTrailingPunctuation: stripPunctuation,
        convert,
      }).map((cue) => ({
        ...cue,
        endTime: Math.min(cue.endTime, clipEndTime),
      }));
      if (nextSegments.length === 0) {
        throw new Error(t("captions.auto.noSpeech"));
      }
      setSegments(nextSegments);
      setProgressMessage(t("captions.auto.captionsReady"));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("captions.auto.failed"),
      );
    } finally {
      await audioContext?.close().catch(() => undefined);
      setIsTranscribing(false);
    }
  }, [
    clip,
    maxChars,
    mediaItem,
    runWorker,
    selectedLanguage,
    selectedModel,
    stripPunctuation,
    t,
    traditionalOutput,
    workerState,
  ]);

  const handleAddToTimeline = useCallback(async () => {
    if (!clip || segments.length === 0) return;
    const style =
      SUBTITLE_STYLE_PRESETS[selectedStyle] ?? SUBTITLE_STYLE_PRESETS.default;
    let addedCount = 0;
    for (const cue of segments) {
      await addSubtitle(
        {
          id: `whisper-${crypto.randomUUID()}`,
          text: cue.text,
          startTime: cue.startTime,
          endTime: cue.endTime,
          style,
        },
        {
          captionSource: "whisper",
          captionSourceClipId: clip.id,
          captionMaxWordsPerLine: maxWordsPerLine,
          captionMaxCharsPerLine: maxChars,
          captionWhisperModel: selectedModel,
          ...cueClipMetadata(cue, wordHighlight ? highlightColor : null),
        },
      );
      addedCount += 1;
    }
    setSegments([]);
    setProgressMessage(t("captions.auto.added", { count: addedCount }));
  }, [
    addSubtitle,
    clip,
    highlightColor,
    maxChars,
    maxWordsPerLine,
    segments,
    selectedModel,
    selectedStyle,
    t,
    wordHighlight,
  ]);

  const modelStatus = useMemo(() => {
    const model = WHISPER_MODELS[selectedModel];
    if (workerState === "ready") {
      const backend = modelBackends[selectedModel];
      return `${t("captions.auto.cached")}${backend ? ` · ${backend === "webgpu" ? "GPU" : "CPU"}` : ""}`;
    }
    if (workerState === "loading")
      return progressMessage || t("captions.auto.downloadingModel");
    return `${t(`whisper.models.${selectedModel}.downloadSize`, { defaultValue: model.downloadSize })} · ${t(`whisper.models.${selectedModel}.description`, { defaultValue: model.description })}`;
  }, [modelBackends, progressMessage, selectedModel, t, workerState]);

  return (
    <div className="w-full min-w-0 space-y-3">
      <Card
        variant="muted"
        padding={3}
        className="space-y-2 border border-primary/30 bg-primary/5"
      >
        <div className="flex items-center justify-between gap-2">
          <Text type="supporting" color="secondary" className="text-[10px]">
            {t("captions.auto.modelQuality")}
          </Text>
          <Selector
            label={t("captions.auto.modelLabel")}
            isLabelHidden
            size="sm"
            width={176}
            value={selectedModel}
            onChange={handleModelChange}
            isDisabled={workerState === "loading" || isTranscribing}
            options={(
              Object.entries(WHISPER_MODELS) as Array<
                [WhisperModelKey, (typeof WHISPER_MODELS)[WhisperModelKey]]
              >
            ).map(([value, model]) => ({
              label: t(`whisper.models.${value}.label`, { defaultValue: model.label }),
              value,
            }))}
          />
        </div>
        <div className="flex items-start gap-2">
          {workerState === "ready" ? (
            <Check size={15} className="mt-0.5 text-primary" aria-hidden />
          ) : (
            <Download size={15} className="mt-0.5 text-primary" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <Text
              type="supporting"
              weight="bold"
              className="block text-[11px] text-fg"
            >
              {WHISPER_MODELS[selectedModel].shortLabel}
            </Text>
            <Text
              type="supporting"
              color="secondary"
              className="block text-[9px]"
            >
              {modelStatus}
            </Text>
          </div>
        </div>
        {workerState === "loading" && (
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-2">
            <div
              className="h-full bg-primary transition-[width]"
              style={{
                width: `${Math.max(3, Math.min(100, progress * 100))}%`,
              }}
            />
          </div>
        )}
        {workerState === "idle" && (
          <Button
            label={t("captions.auto.download", {
              model: WHISPER_MODELS[selectedModel].shortLabel,
            })}
            icon={<Download size={13} aria-hidden />}
            variant="secondary"
            size="sm"
            onClick={handlePrepareModel}
            className="w-full justify-center"
          />
        )}
        <Text
          type="supporting"
          color="secondary"
          className="block text-[9px] leading-relaxed"
        >
          {t("captions.auto.storedNote")}
        </Text>
      </Card>

      <Card variant="muted" padding={3} className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Languages size={14} className="text-fg-2" aria-hidden />
            <Text type="supporting" color="secondary" className="text-[10px]">
              {t("captions.auto.language")}
            </Text>
          </div>
          <Selector
            label={t("captions.auto.languageLabel")}
            isLabelHidden
            size="sm"
            width={132}
            value={selectedLanguage}
            onChange={handleLanguageChange}
            isDisabled={isTranscribing}
            options={WHISPER_LANGUAGES.map((code) => ({
              label: t(`captions.languages.${code}`),
              value: code,
            }))}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Text type="supporting" color="secondary" className="text-[10px]">
            {t("captions.auto.style")}
          </Text>
          <Selector
            label={t("captions.auto.style")}
            isLabelHidden
            size="sm"
            width={132}
            value={selectedStyle}
            onChange={setSelectedStyle}
            isDisabled={isTranscribing}
            options={CAPTION_STYLE_PRESETS.map((preset) => ({
              label: t(`captions.styles.${preset}`),
              value: preset,
            }))}
          />
        </div>
      </Card>

      <Card variant="muted" padding={3} className="space-y-2.5">
        {isChineseLanguage(selectedLanguage) && (
          <CaptionToggle
            label={t("captions.auto.traditional")}
            checked={traditionalOutput}
            onChange={setTraditionalOutput}
            disabled={isTranscribing}
          />
        )}
        <div className="flex items-center justify-between gap-2">
          <Text type="supporting" color="secondary" className="text-[10px]">
            {t("captions.auto.maxChars")}
          </Text>
          <input
            type="number"
            aria-label={t("captions.auto.maxChars")}
            min={4}
            max={80}
            value={maxChars}
            disabled={isTranscribing}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value))
                setMaxChars(Math.min(80, Math.max(4, Math.round(value))));
            }}
            className="h-7 w-16 rounded-md border border-border bg-bg-1 px-2 text-right text-[11px] text-fg outline-none focus:border-accent"
          />
        </div>
        <CaptionToggle
          label={t("captions.auto.stripPunctuation")}
          checked={stripPunctuation}
          onChange={setStripPunctuation}
          disabled={isTranscribing}
        />
        <CaptionToggle
          label={t("captions.common.wordHighlight")}
          checked={wordHighlight}
          onChange={setWordHighlight}
          color={wordHighlight ? highlightColor : undefined}
          onColorChange={setHighlightColor}
          colorLabel={t("captions.common.highlightColor")}
        />
      </Card>

      {error && (
        <Card
          variant="muted"
          padding={2}
          className="flex items-start gap-2 border border-red-500/30 bg-red-500/10"
        >
          <AlertCircle
            size={14}
            className="mt-0.5 shrink-0 text-red-400"
            aria-hidden
          />
          <Text type="supporting" className="text-[10px] text-red-400">
            {error}
          </Text>
        </Card>
      )}

      {isTranscribing && (
        <Card variant="muted" padding={3} className="flex items-center gap-2">
          <Loader2
            size={14}
            className="animate-spin text-primary"
            aria-hidden
          />
          <Text type="supporting" color="secondary" className="text-[10px]">
            {progressMessage}
          </Text>
        </Card>
      )}

      {segments.length > 0 && (
        <div className="space-y-2">
          <div className="max-h-36 space-y-1 overflow-y-auto">
            {segments.map((segment, index) => (
              <Card
                key={`${segment.startTime}-${index}`}
                variant="muted"
                padding={2}
                className="text-[10px]"
              >
                <span className="font-mono text-fg-muted">
                  {segment.startTime.toFixed(1)}s
                </span>
                <span className="ml-2 text-fg">{segment.text}</span>
              </Card>
            ))}
          </div>
          <Button
            label={t("captions.auto.add", { count: segments.length })}
            variant="primary"
            size="sm"
            onClick={handleAddToTimeline}
            className="w-full justify-center"
          />
        </div>
      )}

      <Button
        label={
          isTranscribing
            ? t("captions.auto.transcribing")
            : t("captions.auto.transcribe")
        }
        icon={
          isTranscribing ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <Sparkles size={14} aria-hidden />
          )
        }
        variant="primary"
        size="md"
        onClick={handleTranscribe}
        isDisabled={!canTranscribe || isTranscribing}
        className="w-full justify-center"
      />
      {!canTranscribe && (
        <Text
          type="supporting"
          color="secondary"
          className="block text-center text-[9px]"
        >
          {t("captions.auto.selectClip")}
        </Text>
      )}
    </div>
  );
};

export default AutoCaptionPanel;
