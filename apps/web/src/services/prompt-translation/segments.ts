/**
 * Splits a mixed Chinese/English prompt so only the Chinese is translated.
 *
 * A *CJK run* starts and ends with a Han character and may contain digits,
 * whitespace and CJK punctuation, but no Latin letters. Everything between
 * runs is kept verbatim. When the prompt is mostly Chinese (Latin letters are
 * at most `MOSTLY_CHINESE_LATIN_RATIO` of all letters), the whole prompt is
 * one translatable segment, so the model sees the full context and passes the
 * few Latin tokens through.
 */
export interface PromptSegment {
  readonly text: string;
  readonly translate: boolean;
}

const HAN = /\p{Script=Han}/u;
const HAN_GLOBAL = /\p{Script=Han}/gu;
const LATIN_GLOBAL = /\p{Script=Latin}/gu;
/** Han, digits, whitespace and CJK/full-width punctuation, starting with Han (or a number) and ending with Han. */
const CJK_RUN =
  /(?:\p{N}+\s*)?\p{Script=Han}(?:[\p{Script=Han}\p{N}\s\u3000-\u303F\uFF00-\uFF20\u2018-\u201D、，。！？；：「」『』（）…—～·]*\p{Script=Han})?[，。！？；：」』）…]*/gu;

export const MOSTLY_CHINESE_LATIN_RATIO = 0.15;

export function containsChinese(text: string): boolean {
  return HAN.test(text);
}

export function isMostlyChinese(text: string): boolean {
  const han = text.match(HAN_GLOBAL)?.length ?? 0;
  const latin = text.match(LATIN_GLOBAL)?.length ?? 0;
  return han > 0 && latin <= MOSTLY_CHINESE_LATIN_RATIO * (han + latin);
}

export function splitPromptSegments(text: string): PromptSegment[] {
  if (!containsChinese(text)) return text ? [{ text, translate: false }] : [];
  if (isMostlyChinese(text)) return [{ text, translate: true }];
  const segments: PromptSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CJK_RUN)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), translate: false });
    segments.push({ text: match[0], translate: true });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), translate: false });
  return segments;
}

/**
 * Joins segments after translation: translated English is trimmed and
 * separated from neighbouring kept text by exactly one space unless that
 * text already has whitespace or punctuation at the seam.
 */
export function joinTranslatedSegments(parts: readonly PromptSegment[]): string {
  let result = "";
  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;
    // A sentence-final period inside a longer prompt would read "station., shallow".
    const translated = part.text.trim();
    const piece = !part.translate ? part.text : isLast ? translated : translated.replace(/[.。]+$/, "");
    if (!piece) return;
    const needsSpace = result !== "" && !/\s$/.test(result) && !/^[\s,.;:!?)]/.test(piece);
    result += needsSpace ? ` ${piece}` : piece;
  });
  return result.trim();
}

/**
 * Splits Chinese text after 。！？； and line breaks (punctuation stays with
 * its sentence) so each model input stays short; empty pieces are dropped.
 */
export function splitSentences(text: string): string[] {
  return (text.match(/[^。！？；\n]+[。！？；]*/gu) ?? []).map((s) => s.trim()).filter((s) => s !== "");
}
