/**
 * Track names are stored in the project file in English (e.g. "Track 1",
 * "Music") so a project opens the same in every UI language. Default names
 * are translated only for display; names the user typed are shown as-is.
 */
import type { TFunction } from "i18next";

const DEFAULT_NAME = /^(Track|Video|Audio|Image|Text|Graphics|Dialogue|Music|Captions|Effects)(?: (\d+))?$/;

export function displayTrackName(name: string, t: TFunction): string {
  const match = DEFAULT_NAME.exec(name.trim());
  if (!match) return name;
  const [, base, number] = match;
  const label = t(`timeline.trackNames.${base}`);
  return number ? `${label} ${number}` : label;
}
