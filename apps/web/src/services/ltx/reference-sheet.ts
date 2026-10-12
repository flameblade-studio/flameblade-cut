/**
 * Reference sheet for reference-to-video (`ref2v`, LTX-2.5 IC-LoRA
 * "Ingredients"): several reference images (character views, props, a
 * scene) packed into one composite, like the official example sheets: the
 * panels fill the canvas in rows and are named by position ("Top Row Left")
 * so the prompt can describe each one (see `ingredients-prompt.ts`).
 *
 * The Ingredients workflow resizes the sheet so its shorter side is 544 px
 * and takes the VIDEO SIZE from the resized sheet, so the canvas sizes below
 * are chosen to resize to 960×544 / 544×960 / 544×544 (all multiples of 32).
 * Panels carry no text (text on the sheet hurts), and bigger panels
 * reconstruct better, so the layout maximises the smallest displayed image.
 *
 * `layoutReferenceSheet` is pure and unit-tested. `renderReferenceSheet` and
 * `composeReferenceSheetPng` are the thin browser renderer (OffscreenCanvas,
 * createImageBitmap) injected into the generation runner.
 */
import {
  MAX_REFERENCE_IMAGES,
  MIN_REFERENCE_IMAGES,
  type GenerationAspect,
  type ImageInput,
} from "./types";

export interface ImageSize {
  width: number;
  height: number;
}

/** Where one image is drawn on the sheet (its panel is exactly the drawn image). */
export interface SheetCell {
  x: number;
  y: number;
  w: number;
  h: number;
  drawX: number;
  drawY: number;
  drawW: number;
  drawH: number;
}

export interface ReferenceSheetLayout {
  canvasWidth: number;
  canvasHeight: number;
  /** Number of images in each row, top to bottom (images keep their input order). */
  rowSizes: number[];
  /** Gap between panels and around the sheet, in canvas pixels. */
  gutter: number;
  /** One cell per input image, in input order. */
  cells: SheetCell[];
  /** Each image's position in the words Ingredients prompts use ("Top Row Left"), in input order. */
  positions: string[];
}

/** Sheet canvas per aspect; the workflow scales the shorter side to 544. */
export const REFERENCE_SHEET_CANVAS: Readonly<Record<GenerationAspect, ImageSize>> = {
  "16:9": { width: 1920, height: 1088 },
  "9:16": { width: 1088, height: 1920 },
  "1:1": { width: 1088, height: 1088 },
};

/** Shorter side of the sheet after the workflow's `ResizeImageMaskNode`. */
export const REFERENCE_SHEET_SHORT_SIDE = 544;

/** Gutter as a fraction of the canvas's shorter side. */
const GUTTER_FRACTION = 0.012;

/** Sheet background: the dark grey of the official example sheets' gutters. */
const SHEET_BACKGROUND = "#141414";

export class ReferenceSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceSheetError";
  }
}

function validateSizes(images: readonly ImageSize[]): void {
  if (images.length < MIN_REFERENCE_IMAGES || images.length > MAX_REFERENCE_IMAGES) {
    throw new ReferenceSheetError(
      `A reference sheet needs ${MIN_REFERENCE_IMAGES}–${MAX_REFERENCE_IMAGES} images, got ${images.length}`,
    );
  }
  images.forEach((image, index) => {
    const valid = (n: number) => Number.isFinite(n) && n > 0;
    if (!valid(image.width) || !valid(image.height)) {
      throw new ReferenceSheetError(`Reference image ${index + 1} has an invalid size ${image.width}×${image.height}`);
    }
  });
}

/** Every way to cut `count` ordered images into consecutive rows (2^(count-1) ways, 2048 at most). */
function rowPartitions(count: number): number[][] {
  const partitions: number[][] = [];
  for (let mask = 0; mask < 1 << (count - 1); mask += 1) {
    const rows: number[] = [];
    let size = 1;
    for (let i = 0; i < count - 1; i += 1) {
      if (mask & (1 << i)) {
        rows.push(size);
        size = 1;
      } else {
        size += 1;
      }
    }
    rows.push(size);
    partitions.push(rows);
  }
  return partitions;
}

interface Packing {
  rowSizes: number[];
  rowHeights: number[];
  widths: number[];
  minArea: number;
  totalArea: number;
}

/**
 * Justified rows: every image in a row gets the same height and the row
 * spans the canvas width; if the rows are then too tall, every row shrinks
 * by the same factor (and is centred horizontally).
 */
function pack(images: readonly ImageSize[], rowSizes: number[], canvas: ImageSize, gutter: number): Packing | null {
  const aspects = images.map((image) => image.width / image.height);
  const idealHeights: number[] = [];
  let index = 0;
  for (const size of rowSizes) {
    const rowAspect = aspects.slice(index, index + size).reduce((sum, aspect) => sum + aspect, 0);
    idealHeights.push((canvas.width - (size + 1) * gutter) / rowAspect);
    index += size;
  }
  const available = canvas.height - (rowSizes.length + 1) * gutter;
  const idealTotal = idealHeights.reduce((sum, height) => sum + height, 0);
  if (available <= 0 || idealTotal <= 0) return null;
  const scale = Math.min(1, available / idealTotal);
  const rowHeights = idealHeights.map((height) => Math.floor(height * scale));
  if (rowHeights.some((height) => height < 1)) return null;

  const widths: number[] = [];
  let minArea = Number.POSITIVE_INFINITY;
  let totalArea = 0;
  index = 0;
  rowSizes.forEach((size, row) => {
    const height = rowHeights[row] as number;
    for (let i = 0; i < size; i += 1) {
      const width = Math.max(1, Math.floor((aspects[index] as number) * height));
      widths.push(width);
      minArea = Math.min(minArea, width * height);
      totalArea += width * height;
      index += 1;
    }
  });
  return { rowSizes, rowHeights, widths, minArea, totalArea };
}

/** Strictly better: larger smallest image, then more of the sheet covered. Ties keep the earlier split. */
function isBetter(candidate: Packing, best: Packing | null): boolean {
  if (best === null) return true;
  if (candidate.minArea !== best.minArea) return candidate.minArea > best.minArea;
  return candidate.totalArea > best.totalArea;
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"];

function rowName(row: number, rowCount: number): string {
  if (rowCount === 1) return "";
  if (rowCount === 2) return row === 0 ? "Top Row" : "Bottom Row";
  if (rowCount === 3) return ["Top Row", "Middle Row", "Bottom Row"][row] as string;
  return `Row ${row + 1}`;
}

function columnName(column: number, rowSize: number): string {
  if (rowSize === 1) return "";
  if (rowSize === 2) return column === 0 ? "Left" : "Right";
  if (rowSize === 3) return ["Left", "Middle", "Right"][column] as string;
  return `${ORDINALS[column]} from Left`;
}

/** "Top Row Left", "Bottom Row", "Middle", "Row 4, 2nd from Left", or "Full Sheet". */
export function positionName(row: number, rowCount: number, column: number, rowSize: number): string {
  const rowPart = rowName(row, rowCount);
  const columnPart = columnName(column, rowSize);
  if (rowPart === "" && columnPart === "") return "Full Sheet";
  if (rowPart === "") return columnPart;
  if (columnPart === "") return rowPart;
  return rowSize > 3 ? `${rowPart}, ${columnPart}` : `${rowPart} ${columnPart}`;
}

/**
 * Packs 1–12 images, in order, into justified rows on the sheet canvas,
 * choosing the row split that maximises the smallest displayed image (then
 * the covered area), so little of the sheet is left empty. Images keep their
 * aspect ratio; each row and the whole block are centred. Deterministic.
 */
export function layoutReferenceSheet(images: readonly ImageSize[], aspect: GenerationAspect): ReferenceSheetLayout {
  validateSizes(images);
  const canvas = REFERENCE_SHEET_CANVAS[aspect];
  const gutter = Math.round(GUTTER_FRACTION * Math.min(canvas.width, canvas.height));

  let best: Packing | null = null;
  for (const rowSizes of rowPartitions(images.length)) {
    const candidate = pack(images, rowSizes, canvas, gutter);
    if (candidate !== null && isBetter(candidate, best)) best = candidate;
  }
  if (best === null) throw new ReferenceSheetError("The reference images do not fit on the sheet");
  const { rowSizes, rowHeights, widths } = best;

  const blockHeight = rowHeights.reduce((sum, height) => sum + height, 0) + (rowSizes.length - 1) * gutter;
  let y = Math.floor((canvas.height - blockHeight) / 2);
  const cells: SheetCell[] = [];
  const positions: string[] = [];
  let index = 0;
  rowSizes.forEach((size, row) => {
    const height = rowHeights[row] as number;
    const rowWidths = widths.slice(index, index + size);
    const rowWidth = rowWidths.reduce((sum, width) => sum + width, 0) + (size - 1) * gutter;
    let x = Math.floor((canvas.width - rowWidth) / 2);
    rowWidths.forEach((width, column) => {
      cells.push({ x, y, w: width, h: height, drawX: x, drawY: y, drawW: width, drawH: height });
      positions.push(positionName(row, rowSizes.length, column, size));
      x += width + gutter;
      index += 1;
    });
    y += height + gutter;
  });

  return { canvasWidth: canvas.width, canvasHeight: canvas.height, rowSizes, gutter, cells, positions };
}

// ---- browser renderer ------------------------------------------------------

/** Draws the bitmaps into `layout` and encodes PNG (OffscreenCanvas). */
export async function renderReferenceSheet(
  bitmaps: readonly ImageBitmap[],
  layout: ReferenceSheetLayout,
): Promise<Uint8Array<ArrayBuffer>> {
  if (bitmaps.length !== layout.cells.length) {
    throw new ReferenceSheetError(`Layout has ${layout.cells.length} cells but ${bitmaps.length} images were given`);
  }
  const canvas = new OffscreenCanvas(layout.canvasWidth, layout.canvasHeight);
  const context = canvas.getContext("2d");
  if (context === null) throw new ReferenceSheetError("This system cannot draw the reference sheet (no 2D canvas)");
  context.fillStyle = SHEET_BACKGROUND;
  context.fillRect(0, 0, layout.canvasWidth, layout.canvasHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  layout.cells.forEach((cell, index) => {
    context.drawImage(bitmaps[index] as ImageBitmap, cell.drawX, cell.drawY, cell.drawW, cell.drawH);
  });
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

/** A reference image's file contents plus its display name (for error messages). */
export interface ReferenceSheetSource {
  image: ImageInput;
  bytes: Uint8Array<ArrayBuffer>;
}

/** The composed sheet and where each reference image landed on it. */
export interface ComposedReferenceSheet {
  png: Uint8Array<ArrayBuffer>;
  /** Position name per reference image, in request order (see `positionName`). */
  positions: string[];
}

/** Decodes, lays out and renders a reference sheet; injected into `GenerationRunner`. */
export type ReferenceSheetComposer = (
  sources: readonly ReferenceSheetSource[],
  aspect: GenerationAspect,
) => Promise<ComposedReferenceSheet>;

/** Browser implementation of `ReferenceSheetComposer` (createImageBitmap + OffscreenCanvas). */
export const composeReferenceSheetPng: ReferenceSheetComposer = async (sources, aspect) => {
  const bitmaps: ImageBitmap[] = [];
  try {
    for (const source of sources) {
      try {
        bitmaps.push(await createImageBitmap(new Blob([source.bytes])));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new ReferenceSheetError(`Could not read reference image "${source.image.name}": ${reason}`);
      }
    }
    const layout = layoutReferenceSheet(
      bitmaps.map((bitmap) => ({ width: bitmap.width, height: bitmap.height })),
      aspect,
    );
    return { png: await renderReferenceSheet(bitmaps, layout), positions: layout.positions };
  } finally {
    for (const bitmap of bitmaps) bitmap.close();
  }
};
