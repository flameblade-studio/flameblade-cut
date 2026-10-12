import { describe, expect, it } from "vitest";
import { draftProblem, draftToRequest, promptPatch, translationPlan, type CreateDraft } from "./draft-store";

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
    englishPreview: null,
    englishPreviewSource: null,
    englishEdited: false,
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

describe("translationPlan", () => {
  const zh = "一輛紅色機車";

  it("sends text as written when translation is off or there is no Chinese", () => {
    expect(translationPlan(draft({ prompt: zh, autoTranslate: false }))).toEqual({ kind: "none" });
    expect(translationPlan(draft({ prompt: "A red scooter" }))).toEqual({ kind: "none" });
  });

  it("translates when there is no preview or the prompt changed since the preview", () => {
    expect(translationPlan(draft({ prompt: zh }))).toEqual({ kind: "translate" });
    expect(translationPlan(draft({ prompt: `${zh}駛過`, englishPreview: "A red scooter", englishPreviewSource: zh, englishEdited: true }))).toEqual({
      kind: "translate",
    });
    expect(translationPlan(draft({ prompt: zh, englishPreview: "   ", englishPreviewSource: zh }))).toEqual({ kind: "translate" });
  });

  it("sends the (possibly edited) preview made for this exact prompt", () => {
    expect(translationPlan(draft({ prompt: ` ${zh} `, englishPreview: " A red scooter ", englishPreviewSource: zh, englishEdited: true }))).toEqual({
      kind: "use",
      english: "A red scooter",
    });
  });

  it("requests carry no original until translated, and restoring a prompt drops the preview", () => {
    expect(draftToRequest(draft({ tab: "t2v", prompt: zh }), "t2v").promptOriginal).toBeNull();
    expect(promptPatch(zh)).toEqual({ prompt: zh, englishPreview: null, englishPreviewSource: null, englishEdited: false });
  });
});
