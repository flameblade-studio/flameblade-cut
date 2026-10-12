import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeClip {
  mediaId: string;
  startTime: number;
  duration: number;
}

const calls: string[] = [];

const state = {
  hasOpenProject: false,
  createdWith: null as null | { name: string; settings: Record<string, unknown> },
  project: {
    mediaLibrary: { items: [] as Array<{ id: string }> },
    timeline: { tracks: [] as Array<{ id: string; type: string; locked: boolean; clips: FakeClip[] }> },
  },
  initializeAutoSave: vi.fn(async () => {
    calls.push("initializeAutoSave");
  }),
  createNewProject: vi.fn((name: string, settings: Record<string, unknown>) => {
    calls.push("createNewProject");
    state.createdWith = { name, settings };
    state.hasOpenProject = true;
    state.project.timeline.tracks.push({ id: "v1", type: "video", locked: false, clips: [] });
  }),
  setCanvasBackground: vi.fn(async () => undefined),
  importMedia: vi.fn(async (file: File) => {
    state.project.mediaLibrary.items.push({ id: `media-${file.name}` });
    return { success: true };
  }),
  placeMediaClip: vi.fn(async (mediaId: string, trackId: string | undefined, startTime: number) => {
    state.project.timeline.tracks.find((track) => track.id === trackId)!.clips.push({ mediaId, startTime, duration: 5 });
    return { success: true };
  }),
};

vi.mock("../../stores/project-store", () => ({
  useProjectStore: { getState: () => state },
}));

const { sendToEditor } = await import("./send-to-editor");

beforeEach(() => {
  calls.length = 0;
  state.hasOpenProject = false;
  state.createdWith = null;
  state.project.mediaLibrary.items = [];
  state.project.timeline.tracks = [];
  vi.clearAllMocks();
});

describe("sendToEditor", () => {
  const readBytes = vi.fn(async () => new Uint8Array(8));

  it("starts auto-save before it creates the project, so the new project is saved", async () => {
    await sendToEditor([{ path: "C:/a.mp4", name: "a.mp4" }], "9:16", readBytes);
    expect(calls.slice(0, 2)).toEqual(["initializeAutoSave", "createNewProject"]);
    expect(state.createdWith?.settings).toMatchObject({ width: 1080, height: 1920, frameRate: 24 });
  });

  it("appends every clip end to end on the first video track", async () => {
    const placed = await sendToEditor(
      [
        { path: "C:/a.mp4", name: "a.mp4" },
        { path: "C:/b.mp4", name: "b.mp4" },
      ],
      "16:9",
      readBytes,
    );
    expect(placed).toBe(2);
    expect(state.project.timeline.tracks[0].clips.map((clip) => [clip.mediaId, clip.startTime])).toEqual([
      ["media-a.mp4", 0],
      ["media-b.mp4", 5],
    ]);
  });

  it("adds to the open project without creating a new one", async () => {
    state.hasOpenProject = true;
    state.project.timeline.tracks.push({ id: "v1", type: "video", locked: false, clips: [] });
    await sendToEditor([{ path: "C:/a.mp4", name: "a.mp4" }], "16:9", readBytes);
    expect(state.createNewProject).not.toHaveBeenCalled();
    expect(state.initializeAutoSave).toHaveBeenCalledTimes(1);
  });
});
