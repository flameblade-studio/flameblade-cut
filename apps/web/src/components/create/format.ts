/** Display formatting for the AI page (durations, relative times). */
import type { TFunction } from "i18next";

export function formatDuration(totalSeconds: number, t: TFunction): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return t("create.time.seconds", { count: seconds });
  return t("create.time.minutesSeconds", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 });
}

export function formatEstimate(seconds: number, t: TFunction): string {
  return seconds < 100
    ? t("create.form.estimate", { seconds: Math.max(5, Math.round(seconds / 5) * 5) })
    : t("create.form.estimateMinutes", { minutes: Math.max(2, Math.round(seconds / 60)) });
}

export function formatCreatedAt(iso: string, now: Date, locale: string, t: TFunction): string {
  const created = new Date(iso);
  const minutes = Math.floor((now.getTime() - created.getTime()) / 60_000);
  if (minutes < 1) return t("create.time.justNow");
  if (minutes < 60) return t("create.time.minutesAgo", { count: minutes });
  const time = created.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (created.toDateString() === now.toDateString()) return t("create.time.today", { time });
  return created.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
