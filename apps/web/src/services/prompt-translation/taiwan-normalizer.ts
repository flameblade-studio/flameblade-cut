/**
 * Taiwan Mandarin → mainland Simplified normalisation for the local MT model.
 *
 * The local zh→en model was trained on mainland text, so Taiwan words are
 * misread ("機車" becomes a bus or tram, "捷運" an unknown name). Before
 * translating, the prompt is rewritten with mainland vocabulary:
 *
 * 1. `TAIWAN_MT_SUPPLEMENT` — Taiwan words OpenCC `twp → cn` keeps as-is
 *    (each one is pinned by a test), replaced on the Traditional text.
 * 2. OpenCC `twp → cn` (injected as `toMainland`, so this module stays pure).
 * 3. The durative particle 著 → 着: OpenCC leaves "冒著", "撐著" untouched,
 *    which the model reads as "famous/writing". Words where Simplified also
 *    writes 著 (著名, 显著 …) are kept.
 *
 * The user's original text is never changed; this only feeds the MT model.
 */
export type ChineseConverter = (text: string) => string;

/** Taiwan wording → mainland wording, applied before OpenCC (longest keys first). */
export const TAIWAN_MT_SUPPLEMENT: Readonly<Record<string, string>> = {
  機車: "摩托車",
  捷運: "地鐵",
  騎樓: "騎樓走廊",
  路邊攤: "路邊小吃攤",
  熱氣: "蒸汽",
  公車: "公交車",
  廟口: "廟前廣場",
  雞排: "炸雞排",
  阿伯: "老大爺",
  便當: "盒飯",
};

/** Simplified words that keep 著 (zhù: "famous, writing, notable"). */
const ZHU_WORDS = ["著名", "著作", "著称", "著者", "显著", "土著", "名著", "巨著", "编著", "原著", "论著", "专著", "拙著", "昭著", "卓著"];
const ZHU_PLACEHOLDER = "\u{F8FF}";

function applySupplement(text: string): string {
  const keys = Object.keys(TAIWAN_MT_SUPPLEMENT).sort((a, b) => b.length - a.length);
  let result = text;
  for (const key of keys) result = result.split(key).join(TAIWAN_MT_SUPPLEMENT[key]);
  return result;
}

/** 著 → 着 except inside `ZHU_WORDS`. */
export function normaliseDurativeZhe(text: string): string {
  let result = text;
  for (const word of ZHU_WORDS) result = result.split(word).join(word.replace("著", ZHU_PLACEHOLDER));
  return result.split("著").join("着").split(ZHU_PLACEHOLDER).join("著");
}

/** Rewrites Taiwan Mandarin into mainland Simplified for the local MT model. */
export function normaliseForMainlandMt(text: string, toMainland: ChineseConverter): string {
  return normaliseDurativeZhe(toMainland(applySupplement(text)));
}
