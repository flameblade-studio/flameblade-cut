/**
 * Reference sheet for reference-to-video (`ref2v`, LTX-2.5 IC-LoRA
 * "Ingredients"): several reference images (character views, props, a
 * scene) packed into one black-background composite.
 *
 * The Ingredients workflow resizes the sheet so its shorter side is 544 px
 * and takes the VIDEO SIZE from the resized sheet, so the canvas sizes below
 * are chosen to resize to 960×544 / 544×960 / 544×544 (all multiples of 32).
 * Panels carry no text (the owner's notes: text on the sheet hurts), and
 * bigger panels reconstruct better, so the layout maximises the smallest
 * displayed image.
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

/** One grid cell and where its image is drawn inside it ("contain" fit, centred). */
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
  rows: number;
  cols: number;
  /** Gap between cells and around the grid, in canvas pixels. */
  gutter: number;
  /** One cell per input image, in input order (row-major). */
  cells: SheetCell[];
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
const GUTTER_FRACTION = 0.02;

export class ReferenceSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceSheetError";
  }
}

interface Candidate {
  rows: number;
  cols: number;
  cellW: number;
  cellH: number;
  minArea: number;
  totalArea: number;
}

function fitContain(image: ImageSize, cellW: number, cellH: number): { w: number; h: number } {
  const scale = Math.min(cellW / image.width, cellH / image.height);
  return {
    w: Math.min(cellW, Math.max(1, Math.round(image.width * scale))),
    h: Math.min(cellH, Math.max(1, Math.round(image.height * scale))),
  };
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

function evaluate(images: readonly ImageSize[], rows: number, cols: number, canvas: ImageSize, gutter: number): Candidate {
  const cellW = Math.floor((canvas.width - (cols + 1) * gutter) / cols);
  const cellH = Math.floor((canvas.height - (rows + 1) * gutter) / rows);
  let minArea = Number.POSITIVE_INFINITY;
  let totalArea = 0;
  for (const image of images) {
    const { w, h } = fitContain(image, cellW, cellH);
    minArea = Math.min(minArea, w * h);
    totalArea += w * h;
  }
  return { rows, cols, cellW, cellH, minArea, totalArea };
}

/** Strictly better: larger smallest image, then larger total image area. Ties keep the earlier (fewer rows). */
function isBetter(candidate: Candidate, best: Candidate | null): boolean {
  if (best === null) return true;
  if (candidate.minArea !== best.minArea) return candidate.minArea > best.minArea;
  return candidate.totalArea > best.totalArea;
}

/**
 * Packs 1–12 images into a uniform grid on a black canvas, choosing the
 * rows×cols that maximises the smallest displayed image (then the total
 * displayed area). Images keep their aspect ratio ("contain"), are centred
 * in their cells, an incomplete last row is centred, and the grid is centred
 * on the canvas. Deterministic.
 */
export function layoutReferenceSheet(images: readonly ImageSize[], aspect: GenerationAspect): ReferenceSheetLayout {
  validateSizes(images);
  const canvas = REFERENCE_SHEET_CANVAS[aspect];
  const gutter = Math.round(GUTTER_FRACTION * Math.min(canvas.width, canvas.height));
  const count = images.length;

  let best: Candidate | null = null;
  for (let rows = 1; rows <= count; rows += 1) {
    const cols = Math.ceil(count / rows);
    // A grid whose last row would be empty is a duplicate of a smaller one.
    if (Math.ceil(count / cols) !== rows) continue;
    const candidate = evaluate(images, rows, cols, canvas, gutter);
    if (isBetter(candidate, best)) best = candidate;
  }
  // count >= 1 guarantees rows = 1 was evaluated.
  const { rows, cols, cellW, cellH } = best as Candidate;

  const gridW = cols * cellW + (cols - 1) * gutter;
  const gridH = rows * cellH + (rows - 1) * gutter;
  const originX = Math.floor((canvas.width - gridW) / 2);
  const originY = Math.floor((canvas.height - gridH) / 2);

  const cells = images.map((image, index): SheetCell => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const inRow = Math.min(cols, count - row * cols);
    const rowShift = Math.floor(((cols - inRow) * (cellW + gutter)) / 2);
    const x = originX + rowShift + col * (cellW + gutter);
    const y = originY + row * (cellH + gutter);
    const { w, h } = fitContain(image, cellW, cellH);
    return {
      x,
      y,
      w: cellW,
      h: cellH,
      drawX: x + Math.floor((cellW - w) / 2),
      drawY: y + Math.floor((cellH - h) / 2),
      drawW: w,
      drawH: h,
    };
  });

  return { canvasWidth: canvas.width, canvasHeight: canvas.height, rows, cols, gutter, cells };
}

// ---- browser renderer ------------------------------------------------------

/** Draws the bitmaps into `layout` on black and encodes PNG (OffscreenCanvas). */
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
  context.fillStyle = "#000000";
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

/** Decodes, lays out and renders a reference sheet; injected into `GenerationRunner`. */
export type ReferenceSheetComposer = (
  sources: readonly ReferenceSheetSource[],
  aspect: GenerationAspect,
) => Promise<Uint8Array<ArrayBuffer>>;

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
    return await renderReferenceSheet(bitmaps, layout);
  } finally {
    for (const bitmap of bitmaps) bitmap.close();
  }
};
