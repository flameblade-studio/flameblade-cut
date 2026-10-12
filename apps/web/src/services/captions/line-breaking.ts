/**
 * Smart caption line breaking (斷句).
 *
 * Turns transcript segments (Whisper chunks, optionally with word-level
 * timestamps) into short, readable single-line caption cues:
 *
 * - A line holds at most `maxCharsCjk` wide characters (CJK, kana, Hangul,
 *   full-width punctuation). Narrow characters (Latin, digits, spaces) count
 *   `maxCharsCjk / maxCharsLatin` each, so a pure Latin line holds
 *   `maxCharsLatin` characters and mixed lines are weighted fairly.
 * - Lines prefer to end at punctuation (，。！？、；：,.!?;:) and otherwise at a
 *   word boundary. Han characters and kana are individual tokens; Latin and
 *   Hangul words are never split. A single word longer than a line gets a
 *   line of its own.
 * - Timing comes from word timestamps when present; otherwise each token's
 *   share of its segment is proportional to its spoken weight.
 * - Fragments that are too short (in characters or time) merge into a
 *   neighbour when the result still fits; every cue is then extended toward a
 *   minimum display duration without overlapping the next cue.
 * - `stripTrailingPunctuation` removes a line's final ，。、；：,.;: (What'sub
 *   style for Chinese); ？！?! and ellipses are kept because they carry tone.
 *
 * Pure: no React, no store, no I/O.
 */

export interface TimedWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface TranscriptSegment {
  readonly text: string;
  readonly startTime: number;
  readonly endTime: number;
  /** Word-level timestamps (absolute seconds) when the recogniser provides them. */
  readonly words?: readonly TimedWord[];
}

export interface CaptionCue {
  /** Display text (trailing punctuation removed when requested). */
  readonly text: string;
  /** Text as spoken, punctuation kept (for transcripts). */
  readonly spokenText: string;
  readonly startTime: number;
  readonly endTime: number;
  /** Per-word timing in absolute seconds; texts occur in `text` in order. */
  readonly words: readonly TimedWord[];
}

export interface LineBreakOptions {
  readonly maxCharsCjk: number;
  readonly maxCharsLatin: number;
  /** Minimum time a cue stays on screen, in seconds. */
  readonly minDuration: number;
  /** A silence longer than this always starts a new cue, in seconds. */
  readonly maxGap: number;
  readonly stripTrailingPunctuation: boolean;
}

export const DEFAULT_LINE_BREAK_OPTIONS: LineBreakOptions = {
  maxCharsCjk: 16,
  maxCharsLatin: 42,
  minDuration: 0.7,
  maxGap: 0.8,
  stripTrailingPunctuation: false,
};

const SPLIT_CHAR = /[぀-ヿ㐀-䶿一-鿿豈-﫿\u{20000}-\u{2fa1f}]/u;
const WIDE_CHAR =
  /[ᄀ-ᇿ⺀-〿぀-ヿ㄀-ㇿ㐀-䶿一-鿿가-힯豈-﫿＀-￯\u{20000}-\u{2fa1f}]/u;
const PUNCTUATION = /[\p{P}]/u;
const OPENING = /[「『（《〈【〔(["“‘]/u;
const STRONG_END = /[。！？!?…]$|[^.]\.$|^\.$/u;
const WEAK_END = /[，、；：,;:—]$/u;
const STRIPPABLE_END = /[，。、；：,.;:]+$/u;
const EDGE_PUNCTUATION = /^[\p{P}\s]+|[\p{P}\s]+$/gu;

interface Token {
  text: string;
  start: number;
  end: number;
  spaceBefore: boolean;
}

function chars(text: string): string[] {
  return Array.from(text);
}

function narrowUnit(options: LineBreakOptions): number {
  return options.maxCharsCjk / Math.max(1, options.maxCharsLatin);
}

function textUnits(text: string, options: LineBreakOptions): number {
  const narrow = narrowUnit(options);
  return chars(text).reduce((sum, ch) => sum + (WIDE_CHAR.test(ch) ? 1 : narrow), 0);
}

function lineUnits(tokens: readonly Token[], options: LineBreakOptions): number {
  const narrow = narrowUnit(options);
  return tokens.reduce(
    (sum, token, index) =>
      sum + textUnits(token.text, options) + (index > 0 && token.spaceBefore ? narrow : 0),
    0,
  );
}

/** Spoken weight used to share a segment's time when words have no timestamps. */
function spokenWeight(text: string): number {
  const weight = chars(text).reduce((sum, ch) => {
    if (PUNCTUATION.test(ch) || /\s/.test(ch)) return sum;
    return sum + (WIDE_CHAR.test(ch) ? 1 : 0.35);
  }, 0);
  return Math.max(weight, 0.05);
}

/** Splits text into tokens: Han/kana characters individually, other words whole. */
export function tokenizeCaptionText(text: string): { text: string; spaceBefore: boolean }[] {
  const tokens: { text: string; spaceBefore: boolean; kind: "split" | "word" | "open" }[] = [];
  let pendingSpace = false;
  for (const ch of chars(text)) {
    if (/\s/.test(ch)) {
      pendingSpace = true;
      continue;
    }
    const last = tokens[tokens.length - 1];
    const isSplit = SPLIT_CHAR.test(ch);
    if (last && last.kind === "open" && !pendingSpace) {
      last.text += ch;
      last.kind = isSplit ? "split" : OPENING.test(ch) ? "open" : "word";
    } else if (OPENING.test(ch)) {
      tokens.push({ text: ch, spaceBefore: pendingSpace, kind: "open" });
    } else if (isSplit) {
      tokens.push({ text: ch, spaceBefore: pendingSpace, kind: "split" });
    } else if (last && !pendingSpace && (last.kind === "word" || PUNCTUATION.test(ch))) {
      last.text += ch;
    } else {
      tokens.push({ text: ch, spaceBefore: pendingSpace, kind: "word" });
    }
    pendingSpace = false;
  }
  return tokens.map(({ text: tokenText, spaceBefore }) => ({ text: tokenText, spaceBefore }));
}

function tokensFromText(segment: TranscriptSegment): Token[] {
  const raw = tokenizeCaptionText(segment.text);
  if (raw.length === 0) return [];
  const start = segment.startTime;
  const duration = Math.max(0, segment.endTime - segment.startTime);
  const weights = raw.map((token) => spokenWeight(token.text));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let elapsed = 0;
  return raw.map((token, index) => {
    const tokenStart = start + (duration * elapsed) / total;
    elapsed += weights[index];
    return { ...token, start: tokenStart, end: start + (duration * elapsed) / total };
  });
}

function tokensFromWords(words: readonly TimedWord[]): Token[] {
  const tokens: Token[] = [];
  for (const word of words) {
    const spaceBefore = /^\s/.test(word.text);
    const text = word.text.trim();
    if (!text) continue;
    const end = Math.max(word.start, word.end);
    const last = tokens[tokens.length - 1];
    const punctuationOnly = chars(text).every((ch) => PUNCTUATION.test(ch));
    if (last && punctuationOnly && !OPENING.test(text)) {
      last.text += text;
      continue;
    }
    // Whisper may return a multi-character Han "word"; keep it as one token.
    tokens.push({ text, start: word.start, end, spaceBefore });
  }
  return tokens;
}

function breakTokens(tokens: readonly Token[], options: LineBreakOptions): Token[][] {
  const limit = Math.max(1, options.maxCharsCjk);
  const lines: Token[][] = [];
  let current: Token[] = [];

  const flush = (count = current.length) => {
    if (count <= 0) return;
    lines.push(current.slice(0, count));
    current = current.slice(count);
  };

  for (const token of tokens) {
    const previous = current[current.length - 1];
    const gapBreak = previous !== undefined && token.start - previous.end > options.maxGap;
    if (gapBreak) {
      flush();
    } else if (current.length > 0 && lineUnits([...current, token], options) > limit) {
      let punctuationBreak = -1;
      for (let index = current.length - 2; index >= 0; index--) {
        const ending = current[index].text;
        if (
          (STRONG_END.test(ending) || WEAK_END.test(ending)) &&
          lineUnits(current.slice(0, index + 1), options) >= limit * 0.3
        ) {
          punctuationBreak = index;
          break;
        }
      }
      flush(punctuationBreak >= 0 ? punctuationBreak + 1 : current.length);
      if (current.length > 0 && lineUnits([...current, token], options) > limit) flush();
    }
    current.push(token);
    const width = lineUnits(current, options);
    if (STRONG_END.test(token.text) && width >= Math.min(4, limit / 3)) flush();
    else if (WEAK_END.test(token.text) && width >= limit * 0.5) flush();
  }
  flush();
  return rebalanceOrphan(lines, options);
}

/**
 * Avoids a tiny last line ("orphan") by re-splitting the last two lines of a
 * segment where their widths are most even, both within the limit.
 */
function rebalanceOrphan(lines: Token[][], options: LineBreakOptions): Token[][] {
  const limit = Math.max(1, options.maxCharsCjk);
  if (lines.length < 2) return lines;
  const last = lines[lines.length - 1];
  const previous = lines[lines.length - 2];
  if (lineUnits(last, options) >= limit * 0.35) return lines;
  if (STRONG_END.test(previous[previous.length - 1].text)) return lines;
  if (last[0].start - previous[previous.length - 1].end > options.maxGap) return lines;
  const combined = [...previous, ...last];
  let best = previous.length;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let split = 1; split < combined.length; split++) {
    const left = lineUnits(combined.slice(0, split), options);
    const right = lineUnits(combined.slice(split), options);
    if (left > limit || right > limit) continue;
    const punctuationBonus = WEAK_END.test(combined[split - 1].text) ? limit * 0.25 : 0;
    const score = Math.abs(left - right) - punctuationBonus;
    if (score < bestScore) {
      bestScore = score;
      best = split;
    }
  }
  return [...lines.slice(0, -2), combined.slice(0, best), combined.slice(best)];
}

function joinTokens(tokens: readonly Token[]): string {
  return tokens
    .map((token, index) => (index > 0 && token.spaceBefore ? ` ${token.text}` : token.text))
    .join("");
}

function mergeShortFragments(lines: Token[][], options: LineBreakOptions): Token[][] {
  const limit = Math.max(1, options.maxCharsCjk);
  const isShort = (line: Token[]) =>
    lineUnits(line, options) < 2 ||
    line[line.length - 1].end - line[0].start < options.minDuration * 0.5;
  // Never merge across a sentence end ("好。" + "下一句").
  const fits = (left: Token[], right: Token[]) =>
    !STRONG_END.test(left[left.length - 1].text) &&
    lineUnits([...left, ...right], options) <= limit &&
    right[0].start - left[left.length - 1].end <= options.maxGap;

  const result = [...lines];
  for (let index = 0; index < result.length; index++) {
    const line = result[index];
    if (!isShort(line)) continue;
    const before = result[index - 1];
    const after = result[index + 1];
    if (before && fits(before, line)) {
      result.splice(index - 1, 2, [...before, ...line]);
      index -= 2;
    } else if (after && fits(line, after)) {
      result.splice(index, 2, [...line, ...after]);
      index -= 1;
    }
  }
  return result;
}

/** Breaks transcript segments into single-line, readable caption cues. */
export function breakCaptionSegments(
  segments: readonly TranscriptSegment[],
  overrides: Partial<LineBreakOptions> = {},
): CaptionCue[] {
  const options: LineBreakOptions = { ...DEFAULT_LINE_BREAK_OPTIONS, ...overrides };
  const lines = mergeShortFragments(
    segments.flatMap((segment) =>
      breakTokens(
        segment.words && segment.words.length > 0
          ? tokensFromWords(segment.words)
          : tokensFromText(segment),
        options,
      ),
    ),
    options,
  ).sort((left, right) => left[0].start - right[0].start);

  return lines.map((line, index) => {
    const spokenText = joinTokens(line);
    const text = options.stripTrailingPunctuation
      ? spokenText.replace(STRIPPABLE_END, "")
      : spokenText;
    const startTime = line[0].start;
    const nextStart = lines[index + 1]?.[0].start ?? Number.POSITIVE_INFINITY;
    const spokenEnd = Math.max(line[line.length - 1].end, startTime + 0.05);
    const endTime = Math.max(
      Math.min(spokenEnd, nextStart),
      Math.min(startTime + options.minDuration, nextStart),
    );
    const words = line
      .map((token) => ({
        text: token.text.replace(EDGE_PUNCTUATION, ""),
        start: token.start,
        end: token.end,
      }))
      .filter((word) => word.text.length > 0);
    return { text: text || spokenText, spokenText, startTime, endTime, words };
  });
}

/** Default characters-per-line for a Whisper language code. */
export function defaultMaxCharsForLanguage(code: string): number {
  return ["zh", "yue", "ja", "ko"].includes(code)
    ? DEFAULT_LINE_BREAK_OPTIONS.maxCharsCjk
    : DEFAULT_LINE_BREAK_OPTIONS.maxCharsLatin;
}

/**
 * Estimated per-word timing for `text` spread over [start, end] by spoken
 * weight; used when the recogniser gave no word timestamps (e.g. imported
 * SRT, or after a script conversion changed the text length).
 */
export function estimateWordTimings(text: string, start: number, end: number): TimedWord[] {
  return tokensFromText({ text, startTime: start, endTime: end })
    .map((token) => ({
      text: token.text.replace(EDGE_PUNCTUATION, ""),
      start: token.start,
      end: token.end,
    }))
    .filter((word) => word.text.length > 0);
}
