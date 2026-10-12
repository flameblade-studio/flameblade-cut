/**
 * Localization (Flameblade Cut). Four complete locales are a release gate:
 * zh-TW (default), zh-CN, en, ja. `locales.test.ts` fails when any locale is
 * missing a key that another locale has.
 *
 * Usage in components: `const { t } = useTranslation(); t("editor.export")`.
 * Outside React: `import { t } from "@/i18n"`.
 */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { buildResources, RESOURCE_LANGUAGES } from "./resources";

export const SUPPORTED_LANGUAGES = RESOURCE_LANGUAGES;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = "flameblade.language";

export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  "zh-TW": "繁體中文",
  "zh-CN": "简体中文",
  en: "English",
  ja: "日本語",
};

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** Maps a BCP 47 tag (e.g. navigator.language) to the closest supported language. */
export function matchLanguage(tag: string | undefined): AppLanguage {
  const lower = (tag ?? "").toLowerCase();
  if (lower.startsWith("zh")) {
    return /(-cn|-sg|hans)/.test(lower) ? "zh-CN" : "zh-TW";
  }
  if (lower.startsWith("ja")) return "ja";
  if (lower.startsWith("en")) return "en";
  return "zh-TW";
}

function storedLanguage(): AppLanguage | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isAppLanguage(value) ? value : null;
  } catch {
    // Storage can be unavailable (private mode, tests); fall back to detection.
    return null;
  }
}

export function initialLanguage(): AppLanguage {
  return storedLanguage() ?? matchLanguage(typeof navigator === "undefined" ? undefined : navigator.language);
}

void i18next.use(initReactI18next).init({
  resources: buildResources(),
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLanguage(language: AppLanguage): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Persisting is best-effort; the switch still applies for this session.
  }
  void i18next.changeLanguage(language);
  document.documentElement.lang = language;
}

export const t = i18next.t.bind(i18next);
export { i18next };
