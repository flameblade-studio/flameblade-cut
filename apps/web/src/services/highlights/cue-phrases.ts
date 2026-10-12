/**
 * Cue phrases that tend to introduce a worthwhile moment ("the key point is",
 * "here's the secret", "実は"). Chinese entries list Traditional and
 * Simplified forms; English entries match whole words, case-insensitively.
 */

export const CJK_CUE_PHRASES: readonly string[] = [
  // Traditional Chinese
  "重點", "最重要", "關鍵", "秘訣", "祕訣", "千萬", "你知道嗎", "一定要", "注意", "記住", "其實", "原來", "竟然",
  "告訴你", "絕對", "必須", "小技巧", "訣竅", "真相", "結論", "第一", "最好", "沒想到",
  // Simplified Chinese
  "重点", "关键", "秘诀", "千万", "你知道吗", "记住", "其实", "原来", "告诉你", "绝对", "必须", "诀窍", "结论",
  "没想到",
  // Japanese
  "重要", "ポイント", "コツ", "絶対", "実は", "知ってます", "知っていますか", "大事", "必ず", "秘密", "気をつけ",
  "まさか", "結論",
];

export const LATIN_CUE_PHRASES: readonly string[] = [
  "important", "secret", "tip", "tips", "key", "never", "always", "must", "actually", "the truth", "here's why",
  "mistake", "mistakes", "surprising", "number one", "best", "remember", "trick", "you know what", "the point",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CJK_BY_LENGTH = [...CJK_CUE_PHRASES].sort((left, right) => right.length - left.length || (left < right ? -1 : left > right ? 1 : 0));
const LATIN_PATTERN = new RegExp(`\\b(?:${LATIN_CUE_PHRASES.map(escapeRegExp).join("|")})\\b`, "gi");

function countOccurrences(text: string, phrase: string): number {
  let count = 0;
  let from = text.indexOf(phrase);
  while (from !== -1) {
    count += 1;
    from = text.indexOf(phrase, from + phrase.length);
  }
  return count;
}

/**
 * Number of cue-phrase hits in `text`. Overlapping CJK phrases are counted
 * once per longest match ("最重要" does not also count "重要").
 */
export function countCuePhrases(text: string): number {
  let remaining = text;
  let count = 0;
  for (const phrase of CJK_BY_LENGTH) {
    const hits = countOccurrences(remaining, phrase);
    if (hits > 0) {
      count += hits;
      remaining = remaining.split(phrase).join("\u0000");
    }
  }
  return count + (remaining.match(LATIN_PATTERN)?.length ?? 0);
}

const QUESTION_MARKS = /[?？]/g;
const EXCLAMATION_MARKS = /[!！]/g;
const UNPUNCTUATED_QUESTION = /(?:嗎|吗|呢|ですか|ますか)\s*$/u;

export function countQuestions(text: string): number {
  const marks = text.match(QUESTION_MARKS)?.length ?? 0;
  return marks > 0 ? marks : UNPUNCTUATED_QUESTION.test(text) ? 1 : 0;
}

export function countExclamations(text: string): number {
  return text.match(EXCLAMATION_MARKS)?.length ?? 0;
}

const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const LATIN_WORD = /[A-Za-z0-9]+(?:'[A-Za-z]+)?/g;

/** Speech "units": one per CJK character plus one per Latin word. */
export function speechUnits(text: string): number {
  return (text.match(CJK_CHAR)?.length ?? 0) + (text.match(LATIN_WORD)?.length ?? 0);
}
