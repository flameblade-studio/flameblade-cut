/**
 * Which social safe-area guide the preview shows (null = none). Shared by
 * the preview toolbar/overlay and the caption tools' "place in safe area".
 */
import { create } from "zustand";
import type { SafeAreaPlatformId } from "./safe-area";

interface SafeAreaGuideState {
  platform: SafeAreaPlatformId | null;
  /** Last platform chosen, used by "place in safe area" when the guide is hidden. */
  lastPlatform: SafeAreaPlatformId;
  setPlatform(platform: SafeAreaPlatformId | null): void;
}

export const useSafeAreaGuideStore = create<SafeAreaGuideState>((set) => ({
  platform: null,
  lastPlatform: "tiktok",
  setPlatform: (platform) =>
    set((state) => ({ platform, lastPlatform: platform ?? state.lastPlatform })),
}));
