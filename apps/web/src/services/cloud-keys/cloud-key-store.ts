/**
 * Which cloud keys (Azure Speech, OpenAI) are saved in the desktop app's
 * OS-encrypted KeyStore. One shared store so that saving a key in Settings
 * updates the voiceover panel, prompt translation and AI highlights at once.
 * Only the configured/not-configured status lives here; key values go
 * straight from the input to the KeyStore and are never kept in the renderer.
 */
import { useEffect } from "react";
import { create } from "zustand";
import {
  deleteCloudKey,
  getVoiceBridge,
  keyStatus,
  saveCloudKey,
  type CloudVoiceEngine,
} from "../voiceover/voiceover-client";

export type CloudKeyStatus = Record<CloudVoiceEngine, boolean>;

/** Talks to the KeyStore; replaced in tests. */
export interface CloudKeyBackend {
  status(): Promise<CloudKeyStatus>;
  save(engine: CloudVoiceEngine, value: string): Promise<void>;
  remove(engine: CloudVoiceEngine): Promise<void>;
}

export const desktopKeyBackend: CloudKeyBackend = {
  status: keyStatus,
  save: saveCloudKey,
  remove: deleteCloudKey,
};

interface CloudKeyState {
  /** `null` until the first successful check, and always outside the desktop app. */
  status: CloudKeyStatus | null;
  refresh(): Promise<void>;
  save(engine: CloudVoiceEngine, value: string): Promise<void>;
  remove(engine: CloudVoiceEngine): Promise<void>;
}

export function createCloudKeyStore(backend: CloudKeyBackend, available: () => boolean) {
  return create<CloudKeyState>((set) => {
    const refresh = async (): Promise<void> => {
      if (!available()) return;
      set({ status: await backend.status() });
    };
    return {
      status: null,
      refresh,
      save: async (engine, value) => {
        await backend.save(engine, value);
        await refresh();
      },
      remove: async (engine) => {
        await backend.remove(engine);
        await refresh();
      },
    };
  });
}

export const useCloudKeyStore = createCloudKeyStore(desktopKeyBackend, () => getVoiceBridge() !== null);

/** The current key status, checked once per mount so a fresh page is never stale. */
export function useCloudKeyStatus(): CloudKeyStatus | null {
  const status = useCloudKeyStore((state) => state.status);
  const refresh = useCloudKeyStore((state) => state.refresh);
  useEffect(() => {
    refresh().catch((error: unknown) => console.warn("[cloud-keys] status check failed", error));
  }, [refresh]);
  return status;
}
