/**
 * Deterministic synthetic fixtures for the highlight tests and smoke run:
 * a 10-minute zh-TW talk with filler sentences and a few strong moments.
 */
import type { RmsProfile, TranscriptSegment } from "./types";

const FILLER = [
  "今天天氣還不錯，我們慢慢開始",
  "這邊先整理一下桌面",
  "然後我們看一下這個畫面",
  "嗯，這個部分大家應該都看過",
  "接下來繼續往下講",
  "好，那我們換到下一頁",
];

/** Strong sentences: [startSeconds, text]; each lasts 4 seconds. */
const STRONG: ReadonlyArray<readonly [number, string]> = [
  [61, "你知道嗎？剪輯最重要的祕訣就是節奏！"],
  [66, "千萬不要把開頭拖太長，三秒內就要抓住觀眾"],
  [71, "記住這個重點，留存率會差很多！"],
  [301, "其實很多人都做錯了這一步？"],
  [306, "關鍵在於字幕要短，一行不要超過十二個字"],
  [311, "這個小技巧真的超級好用！"],
  [481, "最後告訴你一個結論：先求有再求好"],
  [486, "一定要先發布，再根據數據調整！"],
];

/** 4-second sentences every 5 seconds (1 s pauses); strong lines at fixed slots. */
export function syntheticTalk(durationSeconds = 600): TranscriptSegment[] {
  const strongByStart = new Map(STRONG);
  const segments: TranscriptSegment[] = [];
  let fillerIndex = 0;
  for (let start = 1; start + 4 <= durationSeconds; start += 5) {
    const strong = strongByStart.get(start);
    const text = strong ?? `${FILLER[fillerIndex % FILLER.length]}。`;
    if (!strong) fillerIndex += 1;
    segments.push({ start, end: start + 4, text });
  }
  return segments;
}

/** Flat 0.05 RMS with louder passages over [60, 80) and [300, 315). */
export function syntheticRms(durationSeconds = 600, frameSeconds = 0.5): RmsProfile {
  const values = new Float32Array(Math.ceil(durationSeconds / frameSeconds));
  for (let index = 0; index < values.length; index += 1) {
    const time = index * frameSeconds;
    const loud = (time >= 60 && time < 80) || (time >= 300 && time < 315);
    values[index] = loud ? 0.2 + 0.05 * Math.sin(index) : 0.05;
  }
  return { frameSeconds, values };
}
