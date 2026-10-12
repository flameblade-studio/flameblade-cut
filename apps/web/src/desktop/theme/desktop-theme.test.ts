import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("./desktop-theme.css", import.meta.url)), "utf8");

/** The declarations inside the first rule whose selector is exactly `selector`. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing rule ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
}

function tokenNames(declarations: string): string[] {
  return [...declarations.matchAll(/(--[\w-]+):/g)].map((match) => match[1]).sort();
}

const light = block(".openreel-desktop");
const dark = block('[data-theme="dark"] .openreel-desktop');

describe("desktop-theme.css", () => {
  it("is light by default: warm white surfaces, ink-navy text", () => {
    expect(light).toContain("color-scheme: light;");
    expect(light).toMatch(/--bg:\s*oklch\(0\.9[5-9]/);
    expect(light).toMatch(/--fg:\s*oklch\(0\.2[0-9]/);
  });

  it("keeps the dark palette under data-theme=dark", () => {
    expect(dark).toContain("color-scheme: dark;");
    expect(dark).toMatch(/--bg:\s*oklch\(0\.1[0-9]/);
  });

  it("retints the accent to Flameblade vermilion in both themes", () => {
    for (const declarations of [light, dark]) {
      expect(declarations).toMatch(/--accent:\s*oklch\([^)]*\s3[0-9]\)/);
    }
  });

  it("defines the same tokens in both themes", () => {
    expect(tokenNames(dark)).toEqual(tokenNames(light));
    for (const token of ["--bg", "--bg-1", "--bg-2", "--bg-3", "--border", "--accent", "--accent-strong", "--ok", "--error"]) {
      expect(tokenNames(light)).toContain(token);
    }
  });
});
