import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { i18next } from "../../../i18n";
import { RESOURCE_LANGUAGES, stringsFor } from "../../../i18n/resources";
import { historyActionKey, historyActionLabel } from "./history-labels";

// Vitest runs from apps/web.
const coreSource = readFileSync(resolve(process.cwd(), "../../packages/core/src/actions/action-history.ts"), "utf8");
/** Action types core describes in ACTION_DESCRIPTIONS ("clip/add", ...). */
const CORE_TYPES = [...coreSource.matchAll(/^\s+"([a-z]+\/[A-Za-z]+)":/gmu)].map((match) => match[1] as string);

function lookup(strings: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], strings);
}

describe("history labels", () => {
  const initial = i18next.language;
  afterEach(async () => {
    await i18next.changeLanguage(initial);
  });

  it("finds the action types core describes", () => {
    expect(CORE_TYPES.length).toBeGreaterThan(40);
    expect(CORE_TYPES).toContain("clip/add");
  });

  it.each(RESOURCE_LANGUAGES)("%s names every core action type", (language) => {
    const missing = CORE_TYPES.filter((type) => typeof lookup(stringsFor(language), historyActionKey(type)) !== "string");
    expect(missing).toEqual([]);
  });

  it("translates the step and its track type", async () => {
    await i18next.changeLanguage("zh-TW");
    const t = i18next.t.bind(i18next);
    expect(historyActionLabel(t, { type: "clip/move" }, "Move clip")).toBe("移動片段");
    expect(historyActionLabel(t, { type: "track/add", params: { trackType: "audio" } }, "Add audio track")).toBe("新增音訊軌道");
  });

  it("falls back to core's English for an unknown action type", async () => {
    await i18next.changeLanguage("zh-TW");
    expect(historyActionLabel(i18next.t.bind(i18next), { type: "future/thing" }, "future: thing")).toBe("future: thing");
  });
});
