import { describe, expect, it, vi } from "vitest";
import { cropPixels } from "../reference-sheet";
import { buildPanelGraph, buildShotGraph, createGemmaShotPlanner, GEMMA_PLANNER_MODEL } from "./gemma-planner";
import { cleanSentence, openAiInstructions, parseOpenAiPlan, sanitizeCrop, shotUserPrompt } from "./instructions";
import { createOpenAiShotPlanner } from "./openai-planner";
import { ShotPlanError, type ShotPlanInput } from "./types";

const signal = new AbortController().signal;

function input(overrides: Partial<ShotPlanInput> = {}): ShotPlanInput {
  return { mode: "t2v", request: "林可芸站在傍晚的高雄港邊", durationSec: 10, references: [], ...overrides };
}

const refs = [0, 1].map((i) => ({
  image: { path: `C:/r${i}.png`, name: `r${i}.png`, ...(i === 0 ? { description: "林可芸的設定圖" } : {}) },
  bytes: new Uint8Array([i]),
}));

describe("instructions", () => {
  it("cleans the prefixes and quotes a small model adds", () => {
    expect(cleanSentence('  PANEL 2: "A man in a blue jacket."  ')).toBe("A man in a blue jacket.");
    expect(cleanSentence("SHOT： She waves.")).toBe("She waves.");
    expect(cleanSentence("A woman with long hair.")).toBe("A woman with long hair.");
  });

  it("keeps a sensible crop, clamps it into the image, and drops useless ones", () => {
    expect(sanitizeCrop({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 })).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
    expect(sanitizeCrop({ x: -0.2, y: 0.5, width: 0.7, height: 0.8 })).toEqual({ x: 0, y: 0.5, width: 0.5, height: 0.5 });
    expect(sanitizeCrop({ x: 0.4, y: 0.4, width: 0.05, height: 0.5 })).toBeNull();
    expect(sanitizeCrop({ x: 0, y: 0, width: 1, height: 1 })).toBeNull();
    expect(sanitizeCrop(null)).toBeNull();
    expect(sanitizeCrop({ x: "0", y: 0, width: 1, height: 1 })).toBeNull();
  });

  it("reads the OpenAI plan and refuses a panel count that does not match", () => {
    const json = JSON.stringify({ shot: " She smiles. ", panels: [{ description: "A woman.", crop: null }] });
    expect(parseOpenAiPlan(json, 1)).toEqual({ shot: "She smiles.", panels: [{ description: "A woman.", crop: null }] });
    expect(() => parseOpenAiPlan(json, 2)).toThrow(/expected 2/);
    expect(() => parseOpenAiPlan(JSON.stringify({ shot: "", panels: [] }), 0)).toThrow(/no shot/);
  });

  it("asks for names in English and lists the panels for the shot", () => {
    const text = shotUserPrompt("ref2v", "劇本", ["A woman.", "A man."]);
    expect(text).toContain("1. A woman.");
    expect(text).toContain("2. A man.");
    expect(text.endsWith("User request:\n劇本")).toBe(true);
    expect(openAiInstructions("ref2v", 10, 2)).toContain("Lin Keyun");
    expect(openAiInstructions("t2v", 10, 0)).not.toContain("crop");
  });
});

describe("cropPixels", () => {
  it("turns a 0..1 box into whole pixels inside the image", () => {
    expect(cropPixels({ x: 0.1, y: 0.2, width: 0.5, height: 0.5 }, 1000, 800)).toEqual({ sx: 100, sy: 160, sw: 500, sh: 400 });
    expect(cropPixels({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, 100, 100)).toEqual({ sx: 90, sy: 90, sw: 10, sh: 10 });
  });
});

describe("Gemma planner", () => {
  it("builds one look per reference image, then a text-only shot job", () => {
    const panels = buildPanelGraph(
      [
        { filename: "a.png", subfolder: "flameblade-cut", type: "input" },
        { filename: "b.png", subfolder: "", type: "input" },
      ],
      ["林可芸", undefined],
    );
    expect(panels["plan.model"]?.inputs.clip_name).toBe(GEMMA_PLANNER_MODEL);
    expect(panels["plan.image.0"]?.inputs.image).toBe("flameblade-cut/a.png");
    expect(panels["plan.image.1"]?.inputs.image).toBe("b.png");
    expect(String(panels["plan.describe.0"]?.inputs.prompt)).toContain("林可芸");
    expect(panels["plan.text.1"]?.class_type).toBe("PreviewAny");
    const shot = buildShotGraph(input(), []);
    expect(Object.values(shot).some((node) => node.class_type === "LoadImage")).toBe(false);
    expect(shot["plan.write"]?.inputs.sampling_mode).toBe("off");
  });

  it("plans a ref2v shot with one description per reference and no crops", async () => {
    const runTextJob = vi.fn(async (prompt: Record<string, unknown>): Promise<Record<string, string>> =>
      "plan.text.shot" in prompt ? { "plan.text.shot": "SHOT: They meet." } : { "plan.text.0": "A woman.", "plan.text.1": "A man." },
    );
    const uploadImage = vi.fn(async (_bytes: Uint8Array, filename: string) => ({ filename, subfolder: "", type: "input" }));
    const plan = await createGemmaShotPlanner({ runTextJob, uploadImage }, "rec-1").plan(input({ mode: "ref2v", references: refs }), signal);
    expect(uploadImage.mock.calls.map((call) => call[1])).toEqual(["rec-1-ref-1.png", "rec-1-ref-2.png"]);
    expect(plan).toEqual({
      shot: "They meet.",
      panels: [
        { description: "A woman.", crop: null },
        { description: "A man.", crop: null },
      ],
    });
  });

  it("fails when the model leaves a reference undescribed", async () => {
    const jobs = {
      runTextJob: async () => ({ "plan.text.0": "A woman." }),
      uploadImage: async (_bytes: Uint8Array, filename: string) => ({ filename, subfolder: "", type: "input" }),
    };
    await expect(createGemmaShotPlanner(jobs, "rec-1").plan(input({ mode: "ref2v", references: refs }), signal)).rejects.toThrow(ShotPlanError);
  });
});

describe("OpenAI planner", () => {
  it("sends every reference image with the user's notes and reads the plan", async () => {
    const chat = vi.fn(async (_args: unknown) => ({
      model: "gpt-6.1-sol",
      text: JSON.stringify({
        shot: "Lin Keyun smiles.",
        panels: [
          { description: "A woman.", crop: { x: 0.1, y: 0.1, width: 0.4, height: 0.8 } },
          { description: "A man.", crop: null },
        ],
      }),
    }));
    const encode = vi.fn(async (bytes: Uint8Array) => `data:image/jpeg;base64,${bytes[0]}`);
    const plan = await createOpenAiShotPlanner({ chat }, encode).plan(input({ mode: "ref2v", references: refs }), signal);
    const args = chat.mock.calls[0]?.[0] as unknown as { images: { dataUrl: string }[]; input: string };
    expect(args.images.map((image) => image.dataUrl)).toEqual(["data:image/jpeg;base64,0", "data:image/jpeg;base64,1"]);
    expect(args.input).toContain("Image 1 (user's note): 林可芸的設定圖");
    expect(plan.panels[0]?.crop).toEqual({ x: 0.1, y: 0.1, width: 0.4, height: 0.8 });
  });

  it("sends no images for a text-only shot and reports errors as plan errors", async () => {
    const chat = vi.fn(async (_args: unknown): Promise<{ text: string; model: string }> => Promise.reject(new Error("openai-text:http: 401")));
    await expect(createOpenAiShotPlanner({ chat }, vi.fn()).plan(input(), signal)).rejects.toThrow(/shot-plan:openai/);
    expect(chat.mock.calls[0]?.[0]).not.toHaveProperty("images");
  });
});
