import { describe, expect, it } from "vitest";
import {
  layoutReferenceSheet,
  positionName,
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

/** The owner's 2026-10-12 ref2v set: 2 wide design boards, 2 portrait posters, 3 character sheets. */
const OWNER_SET: ImageSize[] = [
  { width: 1536, height: 1024 },
  { width: 1536, height: 1024 },
  { width: 1024, height: 1536 },
  { width: 1024, height: 1536 },
  { width: 1536, height: 1024 },
  { width: 1536, height: 1024 },
  { width: 1536, height: 1024 },
];

function overlaps(a: SheetCell, b: SheetCell): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function coverage(layout: ReferenceSheetLayout): number {
  const used = layout.cells.reduce((sum, cell) => sum + cell.drawW * cell.drawH, 0);
  return used / (layout.canvasWidth * layout.canvasHeight);
}

function expectWellFormed(layout: ReferenceSheetLayout, images: readonly ImageSize[]): void {
  expect(layout.cells).toHaveLength(images.length);
  expect(layout.positions).toHaveLength(images.length);
  expect(layout.rowSizes.reduce((sum, size) => sum + size, 0)).toBe(images.length);
  layout.cells.forEach((cell, i) => {
    // Inside the canvas, at least one gutter from every edge.
    expect(cell.x).toBeGreaterThanOrEqual(layout.gutter);
    expect(cell.y).toBeGreaterThanOrEqual(layout.gutter);
    expect(cell.x + cell.w).toBeLessThanOrEqual(layout.canvasWidth - layout.gutter);
    expect(cell.y + cell.h).toBeLessThanOrEqual(layout.canvasHeight - layout.gutter);
    expect([cell.drawX, cell.drawY, cell.drawW, cell.drawH]).toEqual([cell.x, cell.y, cell.w, cell.h]);
    for (const n of [cell.x, cell.y, cell.w, cell.h]) expect(Number.isInteger(n)).toBe(true);
    // Aspect ratio kept within one pixel of rounding.
    const image = images[i] as ImageSize;
    expect(Math.abs(cell.w - (image.width / image.height) * cell.h)).toBeLessThanOrEqual(1);
    layout.cells.slice(i + 1).forEach((other) => expect(overlaps(cell, other)).toBe(false));
  });
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

  it("keeps the input order in reading order (rows top to bottom, left to right)", () => {
    const layout = layoutReferenceSheet(OWNER_SET, "16:9");
    for (let i = 1; i < layout.cells.length; i += 1) {
      const previous = layout.cells[i - 1] as SheetCell;
      const cell = layout.cells[i] as SheetCell;
      expect(cell.y > previous.y || (cell.y === previous.y && cell.x > previous.x)).toBe(true);
    }
  });

  it("fills most of the sheet with the owner's 7 mixed references", () => {
    const layout = layoutReferenceSheet(OWNER_SET, "16:9");
    expectWellFormed(layout, OWNER_SET);
    expect(coverage(layout)).toBeGreaterThan(0.75);
  });

  it("is deterministic", () => {
    const images = [PORTRAIT, LANDSCAPE, SQUARE, TALL, SQUARE];
    expect(layoutReferenceSheet(images, "16:9")).toEqual(layoutReferenceSheet(images, "16:9"));
  });

  it("fills the sheet with a single image of the same shape", () => {
    const layout = layoutReferenceSheet([{ width: 1920, height: 1088 }], "16:9");
    expect(layout.rowSizes).toEqual([1]);
    expect(coverage(layout)).toBeGreaterThan(0.95);
    expect(layout.positions).toEqual(["Full Sheet"]);
  });

  it("names four squares on 1:1 by row and side", () => {
    const layout = layoutReferenceSheet([SQUARE, SQUARE, SQUARE, SQUARE], "1:1");
    expect(layout.rowSizes).toEqual([2, 2]);
    expect(layout.positions).toEqual(["Top Row Left", "Top Row Right", "Bottom Row Left", "Bottom Row Right"]);
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

describe("positionName", () => {
  it.each([
    [0, 1, 0, 1, "Full Sheet"],
    [0, 1, 1, 3, "Middle"],
    [0, 2, 0, 1, "Top Row"],
    [1, 3, 2, 3, "Middle Row Right"],
    [2, 3, 0, 2, "Bottom Row Left"],
    [0, 2, 1, 4, "Top Row, 2nd from Left"],
    [3, 4, 0, 1, "Row 4"],
  ])("row %i of %i, column %i of %i → %s", (row, rowCount, column, rowSize, name) => {
    expect(positionName(row, rowCount, column, rowSize)).toBe(name);
  });
});
