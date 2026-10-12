import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AutoReframeEngine,
  DEFAULT_REFRAME_SETTINGS,
  type AutoReframeProgressDetail,
} from "./auto-reframe-engine";

class FakeOffscreenCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  getContext(): object {
    return {};
  }
}

describe("AutoReframeEngine progress codes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports a stable stage code with each English initialize message", async () => {
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    const calls: Array<[number, string, AutoReframeProgressDetail]> = [];

    await new AutoReframeEngine().initialize((progress, message, detail) => {
      calls.push([progress, message, detail]);
    });

    expect(calls).toEqual([
      [10, "Initializing auto-reframe engine...", { stage: "initializing" }],
      [100, "Auto-reframe engine ready", { stage: "ready" }],
    ]);
  });

  it("keeps the English message and adds an error code when not initialized", async () => {
    const result = await new AutoReframeEngine().analyzeClip([], 30, DEFAULT_REFRAME_SETTINGS);

    expect(result.success).toBe(false);
    expect(result.message).toBe("Engine not initialized");
    expect(result.errorCode).toBe("engine-not-initialized");
  });
});
