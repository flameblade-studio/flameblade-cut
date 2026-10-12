/**
 * Which top-level workspace the desktop app shows: the AI generation page
 * ("create", the default landing page), the AI highlights finder ("highlights")
 * or the timeline editor ("edit").
 */
import { create } from "zustand";

export type WorkspaceMode = "create" | "highlights" | "edit";

interface WorkspaceModeState {
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;
}

export const useWorkspaceMode = create<WorkspaceModeState>()((set) => ({
  mode: "create",
  setMode: (mode) => {
    set({ mode });
  },
}));
