import { describe, expect, it } from "vitest";
import { RESOURCE_LANGUAGES, stringsFor } from "./resources";
import { matchLanguage } from "./index";

function flatKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

const LOCALES = Object.fromEntries(RESOURCE_LANGUAGES.map((language) => [language, stringsFor(language)]));

describe("locales", () => {
  const reference = new Set(Object.values(LOCALES).flatMap((locale) => flatKeys(locale)));

  for (const [name, locale] of Object.entries(LOCALES)) {
    it(`${name} defines every key`, () => {
      const keys = new Set(flatKeys(locale));
      const missing = [...reference].filter((key) => !keys.has(key));
      expect(missing).toEqual([]);
    });

    it(`${name} has no empty strings`, () => {
      const empty = flatKeys(locale).filter((key) => {
        const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], locale);
        return typeof value === "string" && value.trim() === "";
      });
      expect(empty).toEqual([]);
    });
  }

  it("maps browser languages", () => {
    expect(matchLanguage("zh-TW")).toBe("zh-TW");
    expect(matchLanguage("zh-HK")).toBe("zh-TW");
    expect(matchLanguage("zh-CN")).toBe("zh-CN");
    expect(matchLanguage("ja-JP")).toBe("ja");
    expect(matchLanguage("en-US")).toBe("en");
    expect(matchLanguage("fr-FR")).toBe("zh-TW");
  });
});
