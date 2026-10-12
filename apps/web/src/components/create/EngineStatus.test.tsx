import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { i18next } from "../../i18n";
import { EngineStatus } from "./EngineStatus";

describe("EngineStatus", () => {
  it("closes the engine settings with Esc without saving", () => {
    render(<EngineStatus />);
    const title = i18next.t("create.settings.title");
    fireEvent.click(screen.getByRole("button", { name: i18next.t("create.engine.settings") }));
    expect(screen.getByRole("dialog", { name: title })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: title })).toBeNull();
  });
});
