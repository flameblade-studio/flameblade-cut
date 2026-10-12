import { describe, expect, it } from "vitest";
import {
  SAFE_AREA_PLATFORM_IDS,
  SAFE_AREA_PRESETS,
  estimateCaptionBlockSize,
  isSafeAreaPlatformId,
  placeBlockInSafeArea,
} from "./safe-area";

describe("safe areas", () => {
  it("defines a sane safe rectangle and covered regions per platform", () => {
    expect(SAFE_AREA_PLATFORM_IDS).toEqual(["tiktok", "reels", "shorts", "youtube"]);
    for (const id of SAFE_AREA_PLATFORM_IDS) {
      const { safe, covered } = SAFE_AREA_PRESETS[id];
      expect(safe.left).toBeGreaterThan(0);
      expect(safe.right).toBeLessThan(1);
      expect(safe.top).toBeLessThan(safe.bottom);
      for (const region of covered) {
        expect(region.left).toBeLessThanOrEqual(region.right);
        expect(region.top).toBeLessThanOrEqual(region.bottom);
        // Covered regions never overlap the interior of the safe rectangle,
        // except the vertical action rail, which lies in the right margin.
        const overlaps =
          region.left < safe.right - 1e-9 &&
          region.right > safe.left + 1e-9 &&
          region.top < safe.bottom - 1e-9 &&
          region.bottom > safe.top + 1e-9;
        expect(overlaps).toBe(false);
      }
    }
    expect(SAFE_AREA_PRESETS.youtube.orientation).toBe("horizontal");
    expect(isSafeAreaPlatformId("reels")).toBe(true);
    expect(isSafeAreaPlatformId("vine")).toBe(false);
  });

  it("moves a bottom caption above the TikTok description area", () => {
    const safe = SAFE_AREA_PRESETS.tiktok.safe;
    const placed = placeBlockInSafeArea({ x: 0.5, y: 0.9 }, { width: 0.6, height: 0.06 }, safe);
    expect(placed.y).toBeCloseTo(safe.bottom - 0.01 - 0.03, 6);
    expect(placed.x).toBeCloseTo(0.5, 6);
  });

  it("keeps a caption that is already safe where it is", () => {
    const safe = SAFE_AREA_PRESETS.youtube.safe;
    expect(placeBlockInSafeArea({ x: 0.5, y: 0.6 }, { width: 0.4, height: 0.08 }, safe)).toEqual({
      x: 0.5,
      y: 0.6,
    });
  });

  it("centres a block that cannot fit on an axis", () => {
    const safe = SAFE_AREA_PRESETS.reels.safe;
    const placed = placeBlockInSafeArea({ x: 0.1, y: 0.5 }, { width: 0.95, height: 0.05 }, safe);
    expect(placed.x).toBeCloseTo((safe.left + safe.right) / 2, 6);
  });

  it("estimates caption block size from text and font", () => {
    const size = estimateCaptionBlockSize("你好世界\nHello", 54, 1.2, { width: 1080, height: 1920 });
    expect(size.width).toBeCloseTo((4 * 54) / 1080, 6);
    expect(size.height).toBeCloseTo((2 * 54 * 1.2) / 1920, 6);
  });
});
