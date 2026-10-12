import React from "react";
import { useProjectStore } from "../../../../stores/project-store";
import {
  AutoCutSilenceSection,
  AudioTextSyncPanel,
  NoiseReductionSection,
  AudioEffectsSection,
  AudioDuckingSection,
} from "../";
import { VoiceOverPanel } from "../VoiceOverPanel";
import { InspectorSection } from "../shell/InspectorSection";
import { PropertySlider } from "../shell/PropertySlider";
import { useTranslation } from "react-i18next";

export interface AudioTabProps {
  clipId: string;
  clipType: string | null;
  showAudioEffects: boolean;
  noiseReductionSectionTitle: string;
  selectedNoiseReductionEffect: unknown;
}

export const AudioTab: React.FC<AudioTabProps> = ({
  clipId,
  clipType,
  showAudioEffects,
  noiseReductionSectionTitle,
  selectedNoiseReductionEffect,
}) => {
  const { t } = useTranslation();
  const clip = useProjectStore((state) =>
    state.project.timeline.tracks
      .flatMap((track) => track.clips)
      .find((candidate) => candidate.id === clipId),
  );

  const updateAudio = React.useCallback(
    (type: "audio/setVolume" | "audio/setFade", params: Record<string, unknown>) => {
      void useProjectStore.getState().executeAction({
        type,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { clipId, ...params },
      });
    },
    [clipId],
  );

  return (
    <>
      {showAudioEffects && (
        <InspectorSection title={t("inspector.sections.voiceOver")} sectionId="voice-over" defaultOpen={false}>
          <VoiceOverPanel />
        </InspectorSection>
      )}
      {showAudioEffects && clip && (
        <InspectorSection title={t("inspector.sections.clipAudio")} sectionId="clip-audio" defaultOpen>
          <div className="space-y-4">
            <PropertySlider
              label={t("inspector.sections.volume")}
              value={clip.volume * 100}
              onChange={(value) => updateAudio("audio/setVolume", { volume: value / 100 })}
              min={0}
              max={400}
              step={1}
              formatValue={(value) => `${Math.round(value)}%`}
            />
            <PropertySlider
              label={t("inspector.sections.fadeIn")}
              value={clip.fade?.fadeIn ?? 0}
              onChange={(fadeIn) => updateAudio("audio/setFade", { fadeIn })}
              min={0}
              max={Math.max(0, clip.duration / 2)}
              step={0.1}
              formatValue={(value) => `${value.toFixed(1)}s`}
            />
            <PropertySlider
              label={t("inspector.sections.fadeOut")}
              value={clip.fade?.fadeOut ?? 0}
              onChange={(fadeOut) => updateAudio("audio/setFade", { fadeOut })}
              min={0}
              max={Math.max(0, clip.duration / 2)}
              step={0.1}
              formatValue={(value) => `${value.toFixed(1)}s`}
            />
          </div>
        </InspectorSection>
      )}
      {showAudioEffects && (
        <InspectorSection
          title={t("inspector.sections.autoCutSilence")}
          sectionId="auto-cut-silence"
          defaultOpen={false}
        >
          <AutoCutSilenceSection clipId={clipId} />
        </InspectorSection>
      )}
      {clipType === "audio" && (
        <InspectorSection title={t("inspector.sections.beatSync")} sectionId="beat-sync" defaultOpen={false}>
          <AudioTextSyncPanel clipId={clipId} />
        </InspectorSection>
      )}
      {showAudioEffects && (
        <InspectorSection
          title={noiseReductionSectionTitle}
          sectionId="background-noise-removal"
          defaultOpen={Boolean(selectedNoiseReductionEffect)}
        >
          <NoiseReductionSection clipId={clipId} />
        </InspectorSection>
      )}
      {showAudioEffects && (
        <>
          <InspectorSection
            title={t("inspector.sections.audioEffects")}
            sectionId="audio-effects"
            defaultOpen={false}
          >
            <AudioEffectsSection clipId={clipId} />
          </InspectorSection>
        </>
      )}
      {showAudioEffects && (
        <InspectorSection
          title={t("inspector.sections.audioDucking")}
          sectionId="audio-ducking"
          defaultOpen={false}
        >
          <AudioDuckingSection clipId={clipId} />
        </InspectorSection>
      )}
    </>
  );
};
