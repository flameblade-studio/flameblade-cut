import { describe, expect, it } from "vitest";
import t2vJson from "./workflows/ltx25-t2v.api.json";
import ref2vJson from "./workflows/ltx25-ref2v.api.json";
import {
  bindTemplate,
  buildComfyPrompt,
  DEFAULT_NEGATIVE_PROMPT,
  estimateSeconds,
  ref2vResolution,
  resolutionFor,
  samplerNodeIds,
  WorkflowBindingError,
  type ComfyApiNode,
  type ComfyApiPrompt,
} from "./workflow-binder";
import type { ComfyFileRef, GenerationRequest } from "./types";

const FIRST: ComfyFileRef = { filename: "rec-1-first.png", subfolder: "flameblade-cut", type: "input" };
const LAST: ComfyFileRef = { filename: "rec-1-last.png", subfolder: "flameblade-cut", type: "input" };

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    mode: "t2v",
    prompt: "A red paper lantern swaying gently",
    promptOriginal: null,
    aspect: "16:9",
    quality: "720p",
    durationSec: 8,
    seed: 2 ** 48 - 1,
    firstImage: null,
    lastImage: null,
    referenceImages: [],
    extendFromRecordId: null,
    enhancePrompt: true,
    ...overrides,
  };
}

function byTitle(prompt: ComfyApiPrompt, classType: string, title: string): ComfyApiNode {
  const nodes = Object.values(prompt).filter(
    (n) => n.class_type === classType && n._meta?.title?.toLowerCase() === title.toLowerCase(),
  );
  expect(nodes).toHaveLength(1);
  return nodes[0];
}

function ofClass(prompt: ComfyApiPrompt, classType: string): ComfyApiNode[] {
  return Object.values(prompt).filter((n) => n.class_type === classType);
}

const SHEET: ComfyFileRef = { filename: "rec-1-sheet.png", subfolder: "flameblade-cut", type: "input" };
const inputs = { recordId: "rec-1", firstImage: FIRST, lastImage: LAST };
const REFS = Array.from({ length: 8 }, (_, i) => ({ path: `D:/refs/${i}.png`, name: `${i}.png` }));

function ref2vRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return request({ mode: "ref2v", enhancePrompt: false, durationSec: 5, referenceImages: REFS, ...overrides });
}

describe("resolutionFor", () => {
  it.each([
    ["16:9", "480p", 832, 448],
    ["16:9", "720p", 1280, 704],
    ["9:16", "480p", 448, 832],
    ["9:16", "720p", 704, 1280],
    ["1:1", "480p", 640, 640],
    ["1:1", "720p", 960, 960],
  ] as const)("%s %s → %ix%i (multiples of 64)", (aspect, quality, width, height) => {
    const size = resolutionFor(aspect, quality);
    expect(size).toEqual({ width, height });
    expect(size.width % 64).toBe(0);
    expect(size.height % 64).toBe(0);
  });
});

describe("ref2vResolution", () => {
  it.each([
    ["16:9", 960, 544],
    ["9:16", 544, 960],
    ["1:1", 544, 544],
  ] as const)("%s → %ix%i (the sheet scaled to a 544 shorter side)", (aspect, width, height) => {
    const size = ref2vResolution(aspect);
    expect(size).toEqual({ width, height });
    expect(size.width % 32).toBe(0);
    expect(size.height % 32).toBe(0);
  });
});

describe("estimateSeconds", () => {
  it("matches the measured warm points (5 s and 15 s)", () => {
    expect(estimateSeconds({ quality: "720p", durationSec: 5 }, { warm: true })).toBe(50);
    expect(estimateSeconds({ quality: "480p", durationSec: 5 }, { warm: true })).toBe(36);
    expect(estimateSeconds({ quality: "720p", durationSec: 15 }, { warm: true })).toBe(138);
    expect(estimateSeconds({ quality: "480p", durationSec: 15 }, { warm: true })).toBe(54);
  });

  it("interpolates between the measured points and adds a cold start", () => {
    expect(estimateSeconds({ quality: "720p", durationSec: 10 }, { warm: true })).toBe(94);
    expect(estimateSeconds({ quality: "480p", durationSec: 10 }, { warm: true })).toBe(45);
    expect(estimateSeconds({ quality: "720p", durationSec: 5 }, { warm: false })).toBe(90);
  });

  it("estimates ref2v from its own measurement, ignoring quality", () => {
    const fiveSec = estimateSeconds({ mode: "ref2v", quality: "480p", durationSec: 5 }, { warm: true });
    expect(fiveSec).toBe(160); // measured warm: 156 s (4 panels), 162 s (8 panels)
    expect(estimateSeconds({ mode: "ref2v", quality: "720p", durationSec: 5 }, { warm: true })).toBe(fiveSec);
    expect(estimateSeconds({ mode: "ref2v", quality: "720p", durationSec: 5 }, { warm: false })).toBe(fiveSec + 40);
    expect(estimateSeconds({ mode: "ref2v", quality: "720p", durationSec: 10 }, { warm: true })).toBeGreaterThan(fiveSec);
  });
});

describe("buildComfyPrompt", () => {
  it("binds every t2v input by class and title", () => {
    const prompt = buildComfyPrompt(request(), inputs);
    expect(byTitle(prompt, "PrimitiveStringMultiline", "Prompt").inputs.value).toBe("A red paper lantern swaying gently");
    expect(byTitle(prompt, "PrimitiveInt", "Duration").inputs.value).toBe(8);
    expect(byTitle(prompt, "PrimitiveInt", "Frame Rate").inputs.value).toBe(24);
    expect(byTitle(prompt, "PrimitiveInt", "Width").inputs.value).toBe(1280);
    expect(byTitle(prompt, "PrimitiveInt", "Height").inputs.value).toBe(704);
    expect(byTitle(prompt, "PrimitiveBoolean", "Boolean (Enable Prompt Enhance)").inputs.value).toBe(true);
    const noises = ofClass(prompt, "RandomNoise");
    expect(noises).toHaveLength(2);
    for (const noise of noises) expect(noise.inputs.noise_seed).toBe(2 ** 48 - 1);
    expect(ofClass(prompt, "SaveVideo")[0].inputs.filename_prefix).toBe("flameblade-cut/rec-1");
    expect(ofClass(prompt, "LoadImage")).toHaveLength(0);
    // The resolution selector stays in place; only the Width/Height links are replaced.
    expect(ofClass(prompt, "ResolutionSelector")).toHaveLength(1);
  });

  it.each(["i2v", "extend"] as const)("binds the first frame for %s with the i2v template", (mode) => {
    const prompt = buildComfyPrompt(request({ mode, aspect: "9:16", quality: "480p" }), inputs);
    expect(byTitle(prompt, "LoadImage", "Load First Frame").inputs.image).toBe("flameblade-cut/rec-1-first.png");
    expect(byTitle(prompt, "PrimitiveInt", "Width").inputs.value).toBe(448);
    expect(byTitle(prompt, "PrimitiveInt", "Height").inputs.value).toBe(832);
    expect(ofClass(prompt, "LTXVImgToVideoInplace").length).toBeGreaterThan(0);
    expect(ofClass(prompt, "RandomNoise").every((n) => n.inputs.noise_seed === 2 ** 48 - 1)).toBe(true);
  });

  it("binds both frames, lowercase height and Frame Rate(int) for flf2v", () => {
    const prompt = buildComfyPrompt(request({ mode: "flf2v", aspect: "1:1", quality: "720p", durationSec: 3 }), inputs);
    expect(byTitle(prompt, "LoadImage", "Load First Frame").inputs.image).toBe("flameblade-cut/rec-1-first.png");
    expect(byTitle(prompt, "LoadImage", "Load Last Frame").inputs.image).toBe("flameblade-cut/rec-1-last.png");
    expect(byTitle(prompt, "PrimitiveInt", "Width").inputs.value).toBe(960);
    expect(byTitle(prompt, "PrimitiveInt", "height").inputs.value).toBe(960);
    expect(byTitle(prompt, "PrimitiveInt", "Frame Rate(int)").inputs.value).toBe(24);
    expect(byTitle(prompt, "PrimitiveInt", "Duration").inputs.value).toBe(3);
  });

  it("uses a bare filename when the upload has no subfolder", () => {
    const prompt = buildComfyPrompt(request({ mode: "i2v" }), {
      ...inputs,
      firstImage: { filename: "a.png", subfolder: "", type: "input" },
    });
    expect(byTitle(prompt, "LoadImage", "Load First Frame").inputs.image).toBe("a.png");
  });

  it("does not mutate the template and returns independent copies", () => {
    const before = JSON.stringify(t2vJson);
    const a = buildComfyPrompt(request({ prompt: "first" }), inputs);
    const b = buildComfyPrompt(request({ prompt: "second" }), inputs);
    expect(JSON.stringify(t2vJson)).toBe(before);
    expect(byTitle(a, "PrimitiveStringMultiline", "Prompt").inputs.value).toBe("first");
    expect(byTitle(b, "PrimitiveStringMultiline", "Prompt").inputs.value).toBe("second");
  });

  it("fails closed when an image the mode needs was not uploaded", () => {
    expect(() => buildComfyPrompt(request({ mode: "flf2v" }), { recordId: "r", firstImage: FIRST, lastImage: null })).toThrow(
      WorkflowBindingError,
    );
    try {
      buildComfyPrompt(request({ mode: "i2v" }), { recordId: "r", firstImage: null, lastImage: null });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowBindingError);
      expect((error as WorkflowBindingError).missing).toEqual(["uploaded first-frame image"]);
    }
  });

  it("lists every missing binding when a template lacks nodes", () => {
    const mangled = structuredClone(t2vJson) as unknown as ComfyApiPrompt;
    for (const node of Object.values(mangled)) {
      if (node._meta?.title === "Duration") node._meta.title = "Length";
      if (node.class_type === "SaveVideo") node.class_type = "SaveAnimatedWEBP";
    }
    try {
      bindTemplate(mangled, "mangled", request(), inputs);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowBindingError);
      expect((error as WorkflowBindingError).missing).toEqual(['PrimitiveInt "Duration"', "SaveVideo"]);
      expect((error as Error).message).toContain('Workflow "mangled" cannot be bound');
    }
  });

  it("rejects ambiguous single bindings", () => {
    const doubled = structuredClone(t2vJson) as unknown as ComfyApiPrompt;
    doubled["extra"] = { class_type: "PrimitiveStringMultiline", inputs: { value: "" }, _meta: { title: "prompt" } };
    expect(() => bindTemplate(doubled, "doubled", request(), inputs)).toThrow(/ambiguous: 2 matches/);
  });

  it("binds the ref2v template: prompt, negative, frame rate, duration, seed, sheet, output name", () => {
    const prompt = buildComfyPrompt(ref2vRequest(), { ...inputs, referenceSheet: SHEET });
    expect(byTitle(prompt, "PrimitiveStringMultiline", "Prompt").inputs.value).toBe("A red paper lantern swaying gently");
    expect(byTitle(prompt, "PrimitiveStringMultiline", "Negative prompt").inputs.value).toBe(DEFAULT_NEGATIVE_PROMPT);
    expect(byTitle(prompt, "PrimitiveFloat", "Frame rate").inputs.value).toBe(24);
    expect(byTitle(prompt, "PrimitiveFloat", "Duration").inputs.value).toBe(5);
    const loaders = ofClass(prompt, "LoadImage");
    expect(loaders).toHaveLength(1);
    expect(loaders[0].inputs.image).toBe("flameblade-cut/rec-1-sheet.png");
    expect(ofClass(prompt, "RandomNoise").map((n) => n.inputs.noise_seed)).toEqual([2 ** 48 - 1]);
    expect(ofClass(prompt, "SaveVideo")[0].inputs.filename_prefix).toBe("flameblade-cut/rec-1");
    expect(samplerNodeIds(prompt)).toEqual(["ref.sample"]);
  });

  it("has no hosted text-encoder path in the ref2v template (prompts stay local)", () => {
    const classes = Object.values(ref2vJson as unknown as ComfyApiPrompt).map((node) => node.class_type);
    expect(classes).not.toContain("GemmaAPITextEncode");
    expect(classes).not.toContain("StringContains");
    expect(classes.filter((name) => name === "CLIPTextEncode")).toHaveLength(2);
  });

  it("fails closed for ref2v without an uploaded sheet or with prompt enhance", () => {
    try {
      buildComfyPrompt(ref2vRequest({ enhancePrompt: true }), inputs);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowBindingError);
      expect((error as WorkflowBindingError).missing).toEqual([
        "prompt enhancer (not available for reference-to-video)",
        "uploaded reference sheet",
      ]);
    }
  });

  it("does not mutate the ref2v template", () => {
    const before = JSON.stringify(ref2vJson);
    buildComfyPrompt(ref2vRequest(), { ...inputs, referenceSheet: SHEET });
    expect(JSON.stringify(ref2vJson)).toBe(before);
  });

  it("reports the two LTX sampler passes for progress", () => {
    expect(samplerNodeIds(buildComfyPrompt(request(), inputs)).sort()).toEqual(["405:344", "405:368"]);
  });
});
