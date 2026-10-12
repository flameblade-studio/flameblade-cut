import { describe, expect, it } from "vitest";
import { containsChinese, isMostlyChinese, joinTranslatedSegments, splitPromptSegments, splitSentences } from "./segments";

describe("splitPromptSegments", () => {
  it("leaves text without Chinese as one kept segment", () => {
    expect(containsChinese("A red scooter at dusk")).toBe(false);
    expect(splitPromptSegments("A red scooter at dusk")).toEqual([{ text: "A red scooter at dusk", translate: false }]);
    expect(splitPromptSegments("")).toEqual([]);
  });

  it("translates a mostly Chinese prompt as a whole", () => {
    const text = "三隻橘色的貓在騎樓下，4K";
    expect(isMostlyChinese(text)).toBe(true);
    expect(splitPromptSegments(text)).toEqual([{ text, translate: true }]);
  });

  it("translates only the Chinese runs of a mixed prompt", () => {
    const text = "cinematic, 35mm film, 一位女孩在捷運站等車, shallow depth of field";
    expect(isMostlyChinese(text)).toBe(false);
    expect(splitPromptSegments(text)).toEqual([
      { text: "cinematic, 35mm film, ", translate: false },
      { text: "一位女孩在捷運站等車", translate: true },
      { text: ", shallow depth of field", translate: false },
    ]);
  });

  it("keeps digits and Chinese punctuation inside a run", () => {
    const segments = splitPromptSegments("wide shot of 3隻貓，2隻狗。 golden hour light");
    expect(segments.filter((s) => s.translate).map((s) => s.text)).toEqual(["3隻貓，2隻狗。"]);
  });
});

describe("joinTranslatedSegments", () => {
  it("drops a translated sentence's period before kept text and spaces the seams", () => {
    expect(
      joinTranslatedSegments([
        { text: "cinematic, 35mm film, ", translate: false },
        { text: "A girl waiting at the MRT station.", translate: true },
        { text: ", shallow depth of field", translate: false },
      ]),
    ).toBe("cinematic, 35mm film, A girl waiting at the MRT station, shallow depth of field");
    expect(
      joinTranslatedSegments([
        { text: "wide shot of", translate: false },
        { text: " three cats. ", translate: true },
      ]),
    ).toBe("wide shot of three cats.");
  });
});

describe("splitSentences", () => {
  it("splits after full stops and line breaks, keeping the punctuation", () => {
    expect(splitSentences("黄昏的街头。一辆摩托车驶过！\n镜头推进")).toEqual(["黄昏的街头。", "一辆摩托车驶过！", "镜头推进"]);
    expect(splitSentences("  \n ")).toEqual([]);
  });
});
