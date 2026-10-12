/**
 * The one place that assembles translation resources. `locales/*.json` hold
 * the editor strings; each feature area keeps its own folder under
 * `locales/<area>/` and appears under the top-level `<area>` key. To add an
 * area: import its four files here and list them in `AREAS`. Both the runtime
 * (`index.ts`) and the four-language gate test read from this module.
 */
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";
import createEn from "./locales/create/en.json";
import createJa from "./locales/create/ja.json";
import createZhCN from "./locales/create/zh-CN.json";
import createZhTW from "./locales/create/zh-TW.json";
import captionsEn from "./locales/captions/en.json";
import captionsJa from "./locales/captions/ja.json";
import captionsZhCN from "./locales/captions/zh-CN.json";
import captionsZhTW from "./locales/captions/zh-TW.json";
import highlightsEn from "./locales/highlights/en.json";
import highlightsJa from "./locales/highlights/ja.json";
import highlightsZhCN from "./locales/highlights/zh-CN.json";
import highlightsZhTW from "./locales/highlights/zh-TW.json";
import voiceEn from "./locales/voice/en.json";
import voiceJa from "./locales/voice/ja.json";
import voiceZhCN from "./locales/voice/zh-CN.json";
import voiceZhTW from "./locales/voice/zh-TW.json";
import advancedEn from "./locales/advanced/en.json";
import advancedJa from "./locales/advanced/ja.json";
import advancedZhCN from "./locales/advanced/zh-CN.json";
import advancedZhTW from "./locales/advanced/zh-TW.json";
import toolsEn from "./locales/tools/en.json";
import toolsJa from "./locales/tools/ja.json";
import toolsZhCN from "./locales/tools/zh-CN.json";
import toolsZhTW from "./locales/tools/zh-TW.json";
import visualEn from "./locales/visual/en.json";
import visualJa from "./locales/visual/ja.json";
import visualZhCN from "./locales/visual/zh-CN.json";
import visualZhTW from "./locales/visual/zh-TW.json";

export const RESOURCE_LANGUAGES = ["zh-TW", "zh-CN", "en", "ja"] as const;
export type ResourceLanguage = (typeof RESOURCE_LANGUAGES)[number];

type Strings = Record<string, unknown>;

const BASE: Record<ResourceLanguage, Strings> = { "zh-TW": zhTW, "zh-CN": zhCN, en, ja };

/** Feature areas, each mounted under its own top-level key. */
const AREAS: Record<string, Record<ResourceLanguage, Strings>> = {
  create: { "zh-TW": createZhTW, "zh-CN": createZhCN, en: createEn, ja: createJa },
  voice: { "zh-TW": voiceZhTW, "zh-CN": voiceZhCN, en: voiceEn, ja: voiceJa },
  captions: { "zh-TW": captionsZhTW, "zh-CN": captionsZhCN, en: captionsEn, ja: captionsJa },
  highlights: { "zh-TW": highlightsZhTW, "zh-CN": highlightsZhCN, en: highlightsEn, ja: highlightsJa },
  advanced: { "zh-TW": advancedZhTW, "zh-CN": advancedZhCN, en: advancedEn, ja: advancedJa },
  tools: { "zh-TW": toolsZhTW, "zh-CN": toolsZhCN, en: toolsEn, ja: toolsJa },
  visual: { "zh-TW": visualZhTW, "zh-CN": visualZhCN, en: visualEn, ja: visualJa },
};

/** Area keys; each must differ from every top-level key of the base strings. */
export const AREA_NAMES: readonly string[] = Object.keys(AREAS);

/** All strings of one language, base editor strings plus every feature area. */
export function stringsFor(language: ResourceLanguage): Strings {
  const areas = Object.fromEntries(Object.entries(AREAS).map(([key, perLanguage]) => [key, perLanguage[language]]));
  return { ...BASE[language], ...areas };
}

export function buildResources(): Record<ResourceLanguage, { translation: Strings }> {
  return Object.fromEntries(RESOURCE_LANGUAGES.map((language) => [language, { translation: stringsFor(language) }])) as Record<
    ResourceLanguage,
    { translation: Strings }
  >;
}
