import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ToolcraftSliderControl } from "@openreel/ui";
import { i18next as i18n } from "./index";
import { TranslatedUiStrings } from "./TranslatedUiStrings";

describe("TranslatedUiStrings", () => {
  const initial = i18n.language;
  afterEach(async () => {
    await act(() => i18n.changeLanguage(initial));
  });

  it("gives the shared slider control its text in the current UI language", async () => {
    render(
      <TranslatedUiStrings>
        <ToolcraftSliderControl label="Opacity" value={50} onChange={() => undefined} />
      </TranslatedUiStrings>,
    );
    await act(() => i18n.changeLanguage("zh-TW"));
    expect(screen.getByRole("button", { name: "編輯Opacity數值" }).getAttribute("title")).toBe("點一下即可輸入數值");

    await act(() => i18n.changeLanguage("en"));
    expect(screen.getByRole("button", { name: "Edit Opacity value" }).getAttribute("title")).toBe("Click to edit");
  });
});
