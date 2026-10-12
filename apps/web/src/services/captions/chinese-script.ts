/**
 * Simplified ⇄ Traditional Chinese conversion for captions (opencc-js,
 * Apache-2.0).
 *
 * - `toTraditional` = OpenCC `cn → twp` (Simplified → Traditional with Taiwan
 *   phrases: 视频→影片, 软件→軟體, 鼠标→滑鼠, 内存→記憶體 …).
 * - `toSimplified` = OpenCC `twp → cn` (the reverse, Taiwan phrases included).
 *
 * OpenCC keeps a few words that Taiwanese creators phrase differently
 * (质量→質量, 点赞→點贊, 账号→賬號, 发布→釋出). `TAIWAN_CREATOR_PHRASES` maps
 * those from their *Simplified* spelling before OpenCC runs, so text that is
 * already Traditional is never touched by the supplement (质量 is read as
 * "quality", the caption sense; physics "mass" is out of scope).
 *
 * The OpenCC dictionaries are large, so they are loaded lazily on first use.
 */
export type ChineseScriptTarget = "traditional" | "simplified";

export type ChineseConverter = (text: string) => string;

/** Simplified-only spellings → Taiwan wording, applied before OpenCC. */
export const TAIWAN_CREATOR_PHRASES: Readonly<Record<string, string>> = {
  质量: "品質",
  点赞: "按讚",
  账号: "帳號",
  账户: "帳戶",
  发布: "發布",
};

const converters = new Map<ChineseScriptTarget, Promise<ChineseConverter>>();

function applyPhrases(text: string, phrases: Readonly<Record<string, string>>): string {
  let result = text;
  for (const [from, to] of Object.entries(phrases)) {
    result = result.split(from).join(to);
  }
  return result;
}

async function createConverter(target: ChineseScriptTarget): Promise<ChineseConverter> {
  const OpenCC = await import("opencc-js");
  if (target === "traditional") {
    const convert = OpenCC.Converter({ from: "cn", to: "twp" });
    return (text) => convert(applyPhrases(text, TAIWAN_CREATOR_PHRASES));
  }
  return OpenCC.Converter({ from: "twp", to: "cn" });
}

/** Returns a cached converter for `target`. */
export function loadChineseConverter(target: ChineseScriptTarget): Promise<ChineseConverter> {
  let converter = converters.get(target);
  if (!converter) {
    converter = createConverter(target);
    converters.set(target, converter);
    converter.catch(() => converters.delete(target));
  }
  return converter;
}

export async function convertChineseScript(
  text: string,
  target: ChineseScriptTarget,
): Promise<string> {
  const convert = await loadChineseConverter(target);
  return convert(text);
}

/** Whisper language codes whose output can be Simplified Chinese. */
export function isChineseLanguage(code: string): boolean {
  return code === "zh" || code.startsWith("zh-") || code === "yue";
}
