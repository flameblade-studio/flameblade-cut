import { describe, expect, it } from "vitest";
import { draftProblem, draftToRequest, promptPatch, type CreateDraft } from "./draft-store";

const REFS = Array.from({ length: 8 }, (_, i) => ({ path: `D:/refs/${i}.png`, name: `${i}.png` }));

function draft(overrides: Partial<CreateDraft> = {}): CreateDraft {
  return {
    tab: "ref2v",
    prompt: "Reference sheet: a girl in red. Generated video: she walks.",
    aspect: "16:9",
    quality: "720p",
    durationSec: 5,
    firstImage: { path: "D:/first.png", name: "first.png" },
    lastImage: null,
    referenceImages: REFS,
    extendFromRecordId: null,
    enhancePrompt: true,
    fixedSeed: 42,
    autoTranslate: true,
    translationEngine: "local",
    ...overrides,
  };
}

describe("draft-store ref2v", () => {
  it("builds a ref2v request with the reference images and no frames or enhancer", () => {
    const request = draftToRequest(draft(), "ref2v");
    expect(request).toMatchObject({ mode: "ref2v", referenceImages: REFS, firstImage: null, enhancePrompt: false, seed: 42 });
    expect(request.referenceImages).not.toBe(REFS);
  });

  it("leaves reference images out of every other mode", () => {
    for (const mode of ["t2v", "i2v", "flf2v", "extend"] as const) {
      expect(draftToRequest(draft(), mode).referenceImages).toEqual([]);
    }
  });

  it("reports missing or too many reference images", () => {
    expect(draftProblem(draft({ referenceImages: [] }))).toBe("needReferences");
    const thirteen = Array.from({ length: 13 }, (_, i) => ({ path: `D:/${i}.png`, name: `${i}.png` }));
    expect(draftProblem(draft({ referenceImages: thirteen }))).toBe("tooManyReferences");
    expect(draftProblem(draft())).toBeNull();
    expect(draftProblem(draft({ tab: "t2v", referenceImages: [] }))).toBeNull();
  });
});

describe("shot planning", () => {
  const zh = "一輛紅色機車";

  it("sends the prompt as written and asks for the chosen planner when AI tidying is on", () => {
    const request = draftToRequest(draft({ tab: "t2v", prompt: zh, translationEngine: "openai" }), "t2v");
    expect(request).toMatchObject({ prompt: zh, promptOriginal: null, autoPlan: "openai" });
  });

  it("asks for no planner when AI tidying is off", () => {
    expect(draftToRequest(draft({ tab: "t2v", prompt: zh, autoTranslate: false }), "t2v").autoPlan).toBeNull();
  });

  it("puts a prompt back into the form", () => {
    expect(promptPatch(zh)).toEqual({ prompt: zh });
  });
});
