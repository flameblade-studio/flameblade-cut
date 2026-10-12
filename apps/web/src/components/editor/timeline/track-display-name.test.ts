import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { displayTrackName } from "./track-display-name";

const zh: Record<string, string> = {
  "timeline.trackNames.Track": "軌道",
  "timeline.trackNames.Music": "音樂",
  "timeline.trackNames.Video": "影片",
};
const t = ((key: string) => zh[key] ?? key) as unknown as TFunction;

describe("displayTrackName", () => {
  it("translates default names and keeps their number", () => {
    expect(displayTrackName("Track 1", t)).toBe("軌道 1");
    expect(displayTrackName("Video 12", t)).toBe("影片 12");
    expect(displayTrackName("Music", t)).toBe("音樂");
  });

  it("leaves user-chosen names untouched", () => {
    expect(displayTrackName("片頭配樂", t)).toBe("片頭配樂");
    expect(displayTrackName("Track one", t)).toBe("Track one");
    expect(displayTrackName("My Track 1", t)).toBe("My Track 1");
  });
});
