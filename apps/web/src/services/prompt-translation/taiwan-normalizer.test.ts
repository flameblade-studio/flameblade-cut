import * as OpenCC from "opencc-js";
import { describe, expect, it } from "vitest";
import { normaliseDurativeZhe, normaliseForMainlandMt, TAIWAN_MT_SUPPLEMENT } from "./taiwan-normalizer";

const toMainland = OpenCC.Converter({ from: "twp", to: "cn" });

describe("OpenCC twp → cn alone", () => {
  // Each supplement entry exists because OpenCC keeps the Taiwan word; if an
  // OpenCC upgrade starts converting one, this test says the entry can go.
  it.each(Object.keys(TAIWAN_MT_SUPPLEMENT))("keeps Taiwan wording for %s", (word) => {
    const converted = toMainland(word);
    expect(converted).not.toBe(toMainland(TAIWAN_MT_SUPPLEMENT[word]));
  });

  it("already converts Taiwan phrases such as 腳踏車, 計程車 and 影片", () => {
    expect(toMainland("腳踏車")).toBe("自行车");
    expect(toMainland("計程車")).toBe("出租车");
    expect(toMainland("影片")).toBe("视频");
  });
});

describe("normaliseForMainlandMt", () => {
  it("rewrites Taiwan vocabulary the mainland-trained model misreads", () => {
    expect(normaliseForMainlandMt("一輛紅色機車緩緩駛過", toMainland)).toBe("一辆红色摩托车缓缓驶过");
    expect(normaliseForMainlandMt("捷運列車駛進月台", toMainland)).toBe("地铁列车驶进月台");
    expect(normaliseForMainlandMt("路邊攤冒著白色熱氣", toMainland)).toBe("路边小吃摊冒着白色蒸汽");
    expect(normaliseForMainlandMt("騎樓下的公車站", toMainland)).toBe("骑楼走廊下的公交车站");
  });

  it("keeps counts, colours and English untouched", () => {
    expect(normaliseForMainlandMt("三隻橘色的貓 cinematic", toMainland)).toBe("三只橘色的猫 cinematic");
  });
});

describe("normaliseDurativeZhe", () => {
  it("turns the durative particle 著 into 着 but keeps 著名 and 显著", () => {
    expect(normaliseDurativeZhe("冒著烟，撑著伞")).toBe("冒着烟，撑着伞");
    expect(normaliseDurativeZhe("著名的庙，显著的招牌")).toBe("著名的庙，显著的招牌");
  });
});
