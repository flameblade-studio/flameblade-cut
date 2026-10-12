import { describe, expect, it } from "vitest";
import {
  layoutReferenceSheet,
  REFERENCE_SHEET_CANVAS,
  REFERENCE_SHEET_SHORT_SIDE,
  ReferenceSheetError,
  type ImageSize,
  type ReferenceSheetLayout,
  type SheetCell,
} from "./reference-sheet";
import { GENERATION_ASPECTS } from "./types";

const SQUARE: ImageSize = { width: 1024, height: 1024 };
const PORTRAIT: ImageSize = { width: 768, height: 1344 };
const LANDSCAPE: ImageSize = { width: 1344, height: 768 };
const TALL: ImageSize = { width: 250, height: 700 };

function overlaps(a: SheetCell, b: SheetCell): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function expectWellFormed(layout: ReferenceSheetLayout, images: readonly ImageSize[]): void {
  expect(layout.cells).toHaveLength(images.length);
  expect(layout.rows * layout.cols).toBeGreaterThanOrEqual(images.length);
  layout.cells.forEach((cell, i) => {
    // Cell inside the canvas, at least one gutter from every edge.
    expect(cell.x).toBeGreaterThanOrEqual(layout.gutter);
    expect(cell.y).toBeGreaterThanOrEqual(layout.gutter);
    expect(cell.x + cell.w).toBeLessThanOrEqual(layout.canvasWidth - layout.gutter);
    expect(cell.y + cell.h).toBeLessThanOrEqual(layout.canvasHeight - layout.gutter);
    // Image inside its cell, integer pixels, aspect ratio kept within rounding.
    expect(cell.drawX).toBeGreaterThanOrEqual(cell.x);
    expect(cell.drawY).toBeGreaterThanOrEqual(cell.y);
    expect(cell.drawX + cell.drawW).toBeLessThanOrEqual(cell.x + cell.w);
    expect(cell.drawY + cell.drawH).toBeLessThanOrEqual(cell.y + cell.h);
    for (const n of [cell.x, cell.y, cell.w, cell.h, cell.drawX, cell.drawY, cell.drawW, cell.drawH]) {
      expect(Number.isInteger(n)).toBe(true);
    }
    // "contain": one side fills the cell.
    expect(cell.drawW === cell.w || cell.drawH === cell.h).toBe(true);
    const image = images[i] as ImageSize;
    expect(Math.abs(cell.drawW / cell.drawH - image.width / image.height)).toBeLessThan(
      (image.width / image.height) * (2 / Math.min(cell.drawW, cell.drawH)) + 1e-9,
    );
    layout.cells.slice(i + 1).forEach((other) => expect(overlaps(cell, other)).toBe(false));
  });
}

function minArea(layout: ReferenceSheetLayout): number {
  return Math.min(...layout.cells.map((c) => c.drawW * c.drawH));
}

describe("REFERENCE_SHEET_CANVAS", () => {
  it.each(GENERATION_ASPECTS)("%s resizes to a 544 shorter side with both sides multiples of 32", (aspect) => {
    const { width, height } = REFERENCE_SHEET_CANVAS[aspect];
    const scale = REFERENCE_SHEET_SHORT_SIDE / Math.min(width, height);
    expect((width * scale) % 32).toBe(0);
    expect((height * scale) % 32).toBe(0);
  });
});

describe("layoutReferenceSheet", () => {
  it.each(GENERATION_ASPECTS)("packs 1–12 square images without overlap on %s", (aspect) => {
    for (let count = 1; count <= 12; count += 1) {
      const images = Array.from({ length: count }, () => SQUARE);
      const layout = layoutReferenceSheet(images, aspect);
      expect(layout.canvasWidth).toBe(REFERENCE_SHEET_CANVAS[aspect].width);
      expect(layout.canvasHeight).toBe(REFERENCE_SHEET_CANVAS[aspect].height);
      expectWellFormed(layout, images);
    }
  });

  it.each(GENERATION_ASPECTS)("packs 1–12 mixed portrait/landscape images on %s", (aspect) => {
    const pool = [PORTRAIT, LANDSCAPE, SQUARE, TALL];
    for (let count = 1; count <= 12; count += 1) {
      const images = Array.from({ length: count }, (_, i) => pool[i % pool.length] as ImageSize);
      expectWellFormed(layoutReferenceSheet(images, aspect), images);
    }
  });

  it("is deterministic", () => {
    const images = [PORTRAIT, LANDSCAPE, SQUARE, TALL, SQUARE];
    expect(layoutReferenceSheet(images, "16:9")).toEqual(layoutReferenceSheet(images, "16:9"));
  });

  it("uses a ~2% gutter and fills a single image edge to edge within it", () => {
    const layout = layoutReferenceSheet([LANDSCAPE], "16:9");
    expect(layout.gutter).toBe(22);
    expect(layout).toMatchObject({ rows: 1, cols: 1 });
    expect(layout.cells[0]).toMatchObject({ x: 22, y: 22, w: 1876, h: 1044 });
  });

  it.each([
    ["16:9", 2, 4],
    ["9:16", 4, 2],
    ["1:1", 3, 3],
  ] as const)("lays 8 square images on %s as %i×%i", (aspect, rows, cols) => {
    const images = Array.from({ length: 8 }, () => SQUARE);
    const layout = layoutReferenceSheet(images, aspect);
    expect(layout).toMatchObject({ rows, cols });
    // Every panel stays usable after the workflow's 544 resize (≥ 150 px on its short side).
    const scale = REFERENCE_SHEET_SHORT_SIDE / Math.min(layout.canvasWidth, layout.canvasHeight);
    for (const cell of layout.cells) expect(Math.min(cell.drawW, cell.drawH) * scale).toBeGreaterThanOrEqual(150);
  });

  it("puts 8 tall character views in one row on 16:9", () => {
    const images = Array.from({ length: 8 }, () => TALL);
    expect(layoutReferenceSheet(images, "16:9")).toMatchObject({ rows: 1, cols: 8 });
  });

  it("chooses the grid with the largest smallest image", () => {
    const images = [SQUARE, SQUARE, SQUARE, LANDSCAPE, PORTRAIT, TALL, SQUARE, SQUARE];
    for (const aspect of GENERATION_ASPECTS) {
      const chosen = layoutReferenceSheet(images, aspect);
      // Brute force over every rows×cols that fits, uniform cells, same gutter.
      const { width, height } = REFERENCE_SHEET_CANVAS[aspect];
      const g = chosen.gutter;
      let best = 0;
      for (let rows = 1; rows <= 8; rows += 1) {
        for (let cols = 1; cols <= 8; cols += 1) {
          if (rows * cols < images.length) continue;
          const cw = Math.floor((width - (cols + 1) * g) / cols);
          const ch = Math.floor((height - (rows + 1) * g) / rows);
          const smallest = Math.min(
            ...images.map((im) => {
              const s = Math.min(cw / im.width, ch / im.height);
              return Math.min(cw, Math.round(im.width * s)) * Math.min(ch, Math.round(im.height * s));
            }),
          );
          best = Math.max(best, smallest);
        }
      }
      expect(minArea(chosen)).toBe(best);
    }
  });

  it("centres an incomplete last row", () => {
    const layout = layoutReferenceSheet(Array.from({ length: 5 }, () => SQUARE), "16:9");
    expect(layout).toMatchObject({ rows: 2, cols: 3 });
    const lastRow = layout.cells.slice(3);
    const left = (lastRow[0] as SheetCell).x;
    const right = layout.canvasWidth - ((lastRow[1] as SheetCell).x + (lastRow[1] as SheetCell).w);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it.each([0, 13])("refuses %i images", (count) => {
    const images = Array.from({ length: count }, () => SQUARE);
    expect(() => layoutReferenceSheet(images, "16:9")).toThrow(ReferenceSheetError);
    expect(() => layoutReferenceSheet(images, "16:9")).toThrow(`needs 1–12 images, got ${count}`);
  });

  it("refuses images with no size", () => {
    expect(() => layoutReferenceSheet([SQUARE, { width: 0, height: 10 }], "1:1")).toThrow(
      "Reference image 2 has an invalid size 0×10",
    );
  });
});
