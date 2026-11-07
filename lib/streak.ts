import type { Session } from "./types";

export type StreakInfo = {
  current: number;
  longest: number;
  practicedToday: boolean;
  days: number;
};

/** Local calendar key, e.g. "2026-11-01". */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days since epoch for a calendar key (avoids DST drift). */
function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map((part) => Number.parseInt(part, 10));
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
}

function practicedDays(sessions: Session[]): Set<number> {
  const days = new Set<number>();
  for (const session of sessions) {
    const time = Date.parse(session.date);
    if (Number.isNaN(time)) continue;
    days.add(dayNumber(dayKey(new Date(time))));
  }
  return days;
}

/**
 * Current streak = consecutive practice days ending today (or yesterday, so a
 * streak is not lost until a full day has been skipped).
 */
export function computeStreak(sessions: Session[]): StreakInfo {
  const days = practicedDays(sessions);
  const today = dayNumber(dayKey(new Date()));
  const practicedToday = days.has(today);

  let current = 0;
  let cursor = practicedToday ? today : today - 1;
  while (days.has(cursor)) {
    current += 1;
    cursor -= 1;
  }

  const sorted = Array.from(days).sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of sorted) {
    run = previous !== null && day === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }

  return { current, longest, practicedToday, days: days.size };
}

export type HeatmapDay = { key: string; label: string; count: number; practiced: boolean };

/** The last `length` local days, oldest first. */
export function heatmapDays(sessions: Session[], length = 30): HeatmapDay[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const time = Date.parse(session.date);
    if (Number.isNaN(time)) continue;
    const key = dayKey(new Date(time));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const now = new Date();
  const out: HeatmapDay[] = [];
  for (let offset = length - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    date.setDate(date.getDate() - offset);
    const key = dayKey(date);
    const count = counts.get(key) ?? 0;
    out.push({
      key,
      label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      count,
      practiced: count > 0,
    });
  }
  return out;
}
