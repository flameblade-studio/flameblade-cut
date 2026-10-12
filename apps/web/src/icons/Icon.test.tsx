import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { Icon, hasIcon } from "./Icon";

describe("Icon", () => {
  it("renders an svg for a known curated icon name", () => {
    const { container } = render(<Icon name="square.and.arrow.up" size={20} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("20");
    expect(svg?.getAttribute("height")).toBe("20");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
  });

  it("returns null for an unknown icon name", () => {
    const { container } = render(<Icon name="not.a.real.icon" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("reports availability of curated icons", () => {
    expect(hasIcon("xmark")).toBe(true);
    expect(hasIcon("definitely-missing")).toBe(false);
  });

  it("hides an unlabeled icon from screen readers instead of announcing its glyph name", () => {
    const { container } = render(<Icon name="xmark" />);
    const span = container.firstElementChild as HTMLElement;
    expect(span.getAttribute("aria-hidden")).toBe("true");
    expect(span.getAttribute("aria-label")).toBeNull();
    expect(span.getAttribute("role")).toBeNull();
  });

  it("exposes a labeled icon as an image with that label", () => {
    const { getByRole } = render(<Icon name="xmark" ariaLabel="關閉" />);
    expect(getByRole("img", { name: "關閉" })).toBeTruthy();
  });
});
