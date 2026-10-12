/**
 * Social-platform safe areas (安全框) for caption placement.
 *
 * All geometry is normalised to the frame (0..1, origin top-left). Each
 * preset lists the regions the platform's own UI typically covers; the safe
 * rectangle is what remains. Values are conservative approximations of the
 * platforms' published creator guidance and common 1080×1920 / 1920×1080
 * templates (checked 2026-10); platforms change their UI, so treat them as
 * guides, not guarantees.
 */

export interface NormalizedRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface CoveredRegion extends NormalizedRect {
  /** What the platform draws there (for tooltips). */
  readonly kind: "status" | "header" | "actions" | "caption" | "controls" | "margin";
}

export interface SafeAreaPreset {
  readonly id: SafeAreaPlatformId;
  readonly label: string;
  readonly orientation: "vertical" | "horizontal";
  readonly safe: NormalizedRect;
  readonly covered: readonly CoveredRegion[];
}

export type SafeAreaPlatformId = "tiktok" | "reels" | "shorts" | "youtube";

function preset(
  id: SafeAreaPlatformId,
  label: string,
  orientation: SafeAreaPreset["orientation"],
  margins: { top: number; bottom: number; left: number; right: number },
  actionRail?: { top: number; bottom: number; width: number },
): SafeAreaPreset {
  const safe = {
    left: margins.left,
    top: margins.top,
    right: 1 - margins.right,
    bottom: 1 - margins.bottom,
  };
  const covered: CoveredRegion[] = [
    { kind: "header", left: 0, top: 0, right: 1, bottom: margins.top },
    {
      kind: orientation === "vertical" ? "caption" : "controls",
      left: 0,
      top: 1 - margins.bottom,
      right: 1,
      bottom: 1,
    },
    { kind: "margin", left: 0, top: margins.top, right: margins.left, bottom: 1 - margins.bottom },
    { kind: "margin", left: 1 - margins.right, top: margins.top, right: 1, bottom: 1 - margins.bottom },
  ];
  if (actionRail) {
    covered.push({
      kind: "actions",
      left: 1 - actionRail.width,
      top: actionRail.top,
      right: 1,
      bottom: actionRail.bottom,
    });
  }
  return { id, label, orientation, safe, covered };
}

export const SAFE_AREA_PRESETS: Readonly<Record<SafeAreaPlatformId, SafeAreaPreset>> = {
  // TikTok: top tabs ≈150 px, description/music ≈440 px, like/comment rail on the right.
  tiktok: preset("tiktok", "TikTok", "vertical", { top: 0.08, bottom: 0.23, left: 0.06, right: 0.12 }, { top: 0.4, bottom: 0.77, width: 0.12 }),
  // Instagram Reels: Meta guidance keeps ~14 % top and ~35 % bottom free of text.
  reels: preset("reels", "Instagram Reels", "vertical", { top: 0.14, bottom: 0.35, left: 0.06, right: 0.12 }, { top: 0.45, bottom: 0.65, width: 0.12 }),
  // YouTube Shorts: title/channel row at the bottom, action rail on the right.
  shorts: preset("shorts", "YouTube Shorts", "vertical", { top: 0.1, bottom: 0.25, left: 0.06, right: 0.15 }, { top: 0.4, bottom: 0.75, width: 0.15 }),
  // YouTube (16:9): title overlay on top, progress bar and controls at the bottom.
  youtube: preset("youtube", "YouTube", "horizontal", { top: 0.1, bottom: 0.14, left: 0.05, right: 0.05 }),
};

export const SAFE_AREA_PLATFORM_IDS = Object.keys(SAFE_AREA_PRESETS) as SafeAreaPlatformId[];

export function isSafeAreaPlatformId(value: unknown): value is SafeAreaPlatformId {
  return typeof value === "string" && value in SAFE_AREA_PRESETS;
}

/** Normalised size of a caption block: width and height as frame fractions. */
export interface BlockSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Moves a block centred at `center` the minimum distance needed to sit inside
 * `safe` (with `padding` on every side). A block wider/taller than the safe
 * area is centred on that axis.
 */
export function placeBlockInSafeArea(
  center: { x: number; y: number },
  size: BlockSize,
  safe: NormalizedRect,
  padding = 0.01,
): { x: number; y: number } {
  const clampAxis = (value: number, half: number, low: number, high: number) => {
    const min = low + padding + half;
    const max = high - padding - half;
    if (min > max) return (low + high) / 2;
    return Math.min(max, Math.max(min, value));
  };
  return {
    x: clampAxis(center.x, size.width / 2, safe.left, safe.right),
    y: clampAxis(center.y, size.height / 2, safe.top, safe.bottom),
  };
}

/** Rough caption block size from its text and font (no canvas needed). */
export function estimateCaptionBlockSize(
  text: string,
  fontSize: number,
  lineHeight: number,
  frame: { width: number; height: number },
): BlockSize {
  const lines = text.split("\n");
  const widest = Math.max(
    ...lines.map((line) =>
      Array.from(line).reduce(
        (sum, ch) => sum + (/[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 1 : 0.55),
        0,
      ),
    ),
  );
  return {
    width: Math.min(1, (widest * fontSize) / Math.max(1, frame.width)),
    height: Math.min(1, (lines.length * fontSize * Math.max(1, lineHeight)) / Math.max(1, frame.height)),
  };
}
