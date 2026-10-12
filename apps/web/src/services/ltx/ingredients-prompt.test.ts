import { describe, expect, it } from "vitest";
import { buildIngredientsPrompt, isIngredientsPrompt, UNDESCRIBED_PANEL } from "./ingredients-prompt";

const images = [
  { path: "C:/a.png", name: "a.png", description: "Character: a young woman with long brown hair in a white shirt." },
  { path: "C:/b.png", name: "b.png" },
];

describe("buildIngredientsPrompt", () => {
  it("names every panel by its sheet position, then the shot", () => {
    expect(buildIngredientsPrompt("She waves at the camera.", images, ["Top Row", "Bottom Row"])).toBe(
      [
        "### Reference Sheet Description",
        "**Top Row:** Character: a young woman with long brown hair in a white shirt.",
        `**Bottom Row:** ${UNDESCRIBED_PANEL}`,
        "### Target Description",
        "She waves at the camera.",
      ].join("\n"),
    );
  });

  it("sends a prompt the user already wrote in this format unchanged", () => {
    const written = "### Reference Sheet Description\n**Left:** x\n### Target Description\ny";
    expect(isIngredientsPrompt(written)).toBe(true);
    expect(buildIngredientsPrompt(written, images, ["Left", "Right"])).toBe(written);
  });

  it("refuses positions that do not match the images", () => {
    expect(() => buildIngredientsPrompt("shot", images, ["Left"])).toThrow(/2 sheet positions/);
  });
});
