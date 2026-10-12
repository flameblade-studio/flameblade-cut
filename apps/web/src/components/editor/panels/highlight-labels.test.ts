import { afterEach, describe, expect, it } from "vitest";
import { i18next } from "../../../i18n";
import { RESOURCE_LANGUAGES, stringsFor } from "../../../i18n/resources";
import { autoReframeStageKey, autoReframeProgressMessage } from "../inspector/auto-reframe-progress";
import { translateServiceMessage } from "../../../services/service-message";
import {
  highlightPhaseKey,
  highlightPhaseLabel,
  highlightReasonKey,
  highlightReasonLabel,
  highlightTitleLabel,
  type HighlightPhase,
} from "./highlight-labels";

function lookup(strings: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], strings);
}

const PHASES: HighlightPhase[] = ["decode", "analyze", "rank", "done"];
const REFRAME_STAGES = ["initializing", "ready", "analyzing", "analyzing-frame", "analysis-complete"] as const;

describe("highlight and auto-reframe progress labels", () => {
  const initial = i18next.language;
  afterEach(async () => {
    await i18next.changeLanguage(initial);
  });

  it.each(RESOURCE_LANGUAGES)("%s defines every stage, reason and title", (language) => {
    const keys = [
      ...PHASES.map(highlightPhaseKey),
      highlightReasonKey("energy"),
      highlightReasonKey("energy-speech"),
      "tools.serviceMessages.highlights.title",
      ...REFRAME_STAGES.map(autoReframeStageKey),
      "tools.serviceMessages.autoReframe.engineUnavailable",
    ];
    const missing = keys.filter((key) => typeof lookup(stringsFor(language), key) !== "string");
    expect(missing).toEqual([]);
  });

  it("keeps English output identical to the service text", async () => {
    await i18next.changeLanguage("en");
    expect(highlightPhaseLabel(i18next.t, "analyze")).toBe("Analyzing audio energy...");
    expect(highlightPhaseLabel(i18next.t, null)).toBe("");
    expect(highlightTitleLabel(i18next.t, { title: "Highlight 2", number: 2 })).toBe("Highlight 2");
    expect(
      highlightReasonLabel(i18next.t, { reason: "Strong local audio energy", reasonCode: "energy" }),
    ).toBe("Strong local audio energy");
    const frame = autoReframeProgressMessage("Analyzing frame 3/10", {
      stage: "analyzing-frame",
      frame: 3,
      frameCount: 10,
    });
    expect(translateServiceMessage(i18next.t, frame)).toBe("Analyzing frame 3/10");
  });

  it("follows the UI language and keeps raw text when core sends no stage", async () => {
    await i18next.changeLanguage("zh-TW");
    expect(highlightTitleLabel(i18next.t, { title: "Highlight 4", number: 4 })).toBe("精華 4");
    const frame = autoReframeProgressMessage("Analyzing frame 3/10", {
      stage: "analyzing-frame",
      frame: 3,
      frameCount: 10,
    });
    expect(translateServiceMessage(i18next.t, frame)).toBe("正在分析第 3/10 格畫面");
    expect(autoReframeProgressMessage("legacy text", undefined)).toBe("legacy text");
  });
});
