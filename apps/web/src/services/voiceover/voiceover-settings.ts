/**
 * Non-secret voiceover preferences (engine, chosen voice per engine, Azure
 * region, OpenAI style instructions), persisted in localStorage. Keys are
 * NOT here: they live only in the main-process encrypted KeyStore.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { VoiceEngine } from "./voiceover-client";

export interface VoiceoverSettingsState {
  engine: VoiceEngine;
  voiceByEngine: Partial<Record<VoiceEngine, string>>;
  azureRegion: string;
  openaiInstructions: string;
  setEngine(engine: VoiceEngine): void;
  setVoice(engine: VoiceEngine, voiceId: string): void;
  setAzureRegion(region: string): void;
  setOpenaiInstructions(instructions: string): void;
}

export const useVoiceoverSettings = create<VoiceoverSettingsState>()(
  persist(
    (set) => ({
      engine: "windows",
      voiceByEngine: {},
      azureRegion: "",
      openaiInstructions: "",
      setEngine: (engine) => set({ engine }),
      setVoice: (engine, voiceId) => set((state) => ({ voiceByEngine: { ...state.voiceByEngine, [engine]: voiceId } })),
      setAzureRegion: (azureRegion) => set({ azureRegion: azureRegion.trim().toLowerCase() }),
      setOpenaiInstructions: (openaiInstructions) => set({ openaiInstructions }),
    }),
    {
      name: "flameblade.voiceover-settings",
      version: 1,
      partialize: (state) => ({
        engine: state.engine,
        voiceByEngine: state.voiceByEngine,
        azureRegion: state.azureRegion,
        openaiInstructions: state.openaiInstructions,
      }),
    },
  ),
);
