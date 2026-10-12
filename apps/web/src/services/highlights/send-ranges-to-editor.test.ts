import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeClip {
  id: string;
  mediaId: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
}

const calls: string[] = [];

const state = {
  hasOpenProject: false,
  initializeAutoSave: vi.fn(async () => {
    calls.push("initializeAutoSave");
  }),
  createdWith: null as null | { name: string; settings: Record<string, unknown> },
  project: {
    mediaLibrary: { items: [] as Array<{ id: string; metadata: { duration: number } }> },
    timeline: { tracks: [] as Array<{ id: string; type: string; locked: boolean; clips: FakeClip[] }> },
  },
  importMedia: vi.fn(async (_file: File) => {
    state.project.mediaLibrary.items.push({ id: "media-1", metadata: { duration: 600 } });
    return { success: true };
  }),
  createNewProject: vi.fn((name: string, settings: Record<string, unknown>) => {
    calls.push("createNewProject");
    state.createdWith = { name, settings };
    state.hasOpenProject = true;
    state.project.timeline.tracks.push({ id: "v1", type: "video", locked: false, clips: [] });
  }),
  placeMediaClip: vi.fn(async (mediaId: string, trackId: string | undefined, startTime: number) => {
    const track = state.project.timeline.tracks.find((candidate) => candidate.id === trackId)!;
    track.clips.push({ id: `clip-${track.clips.length}`, mediaId, startTime, duration: 600, inPoint: 0, outPoint: 600 });
    return { success: true };
  }),
  trimClip: vi.fn(async (clipId: string, inPoint: number, outPoint: number) => {
    const clip = state.project.timeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId)!;
    Object.assign(clip, { inPoint, outPoint, duration: outPoint - inPoint });
    return { success: true };
  }),
};

vi.mock("../../stores/project-store", () => ({
  useProjectStore: { getState: () => state },
}));

const { sendRangesToEditor, VERTICAL_FORMAT } = await import("./send-ranges-to-editor");

beforeEach(() => {
  calls.length = 0;
  state.hasOpenProject = false;
  state.createdWith = null;
  state.project.mediaLibrary.items = [];
  state.project.timeline.tracks = [];
  vi.clearAllMocks();
});

describe("sendRangesToEditor", () => {
  it("creates a vertical project, imports once and lays the trimmed ranges end to end", async () => {
    const readBytes = vi.fn(async () => new Uint8Array(8));
    const placed = await sendRangesToEditor(
      { path: "C:/talk.mp4", name: "talk.mp4" },
      [
        { start: 60, end: 80 },
        { start: 300, end: 315 },
      ],
      { newProjectFormat: VERTICAL_FORMAT, projectName: "精華" },
      readBytes,
    );
    expect(placed).toBe(2);
    // Auto-save must observe the new project, or it is lost when the app quits.
    expect(calls.slice(0, 2)).toEqual(["initializeAutoSave", "createNewProject"]);
    expect(readBytes).toHaveBeenCalledTimes(1);
    expect(state.importMedia).toHaveBeenCalledTimes(1);
    expect(state.createdWith?.settings).toMatchObject({ width: 1080, height: 1920 });
    const clips = state.project.timeline.tracks[0].clips;
    expect(clips.map((clip) => [clip.startTime, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      [0, 60, 80, 20],
      [20, 300, 315, 15],
    ]);
  });

  it("does nothing for an empty selection and surfaces import failures", async () => {
    const readBytes = vi.fn(async () => new Uint8Array(8));
    await expect(sendRangesToEditor({ path: "a", name: "a.mp4" }, [], { newProjectFormat: VERTICAL_FORMAT, projectName: "x" }, readBytes)).resolves.toBe(0);
    expect(readBytes).not.toHaveBeenCalled();
    state.importMedia.mockResolvedValueOnce({ success: false, error: { message: "codec" } } as never);
    await expect(
      sendRangesToEditor({ path: "a", name: "a.mp4" }, [{ start: 0, end: 5 }], { newProjectFormat: VERTICAL_FORMAT, projectName: "x" }, readBytes),
    ).rejects.toThrow("codec");
  });
});
