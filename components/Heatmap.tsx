"use client";

import { heatmapDays } from "@/lib/streak";
import type { Session } from "@/lib/types";

export default function Heatmap({ sessions }: { sessions: Session[] }) {
  const days = heatmapDays(sessions, 30);
  const active = days.filter((day) => day.practiced).length;

  return (
    <div className="rounded-2xl border border-line bg-panel p-6">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Last 30 days</p>
        <p className="text-xs text-muted">
          {active} {active === 1 ? "day" : "days"} practiced
        </p>
      </div>
      <div className="mt-4 grid grid-cols-[repeat(30,minmax(0,1fr))] gap-1 sm:gap-1.5">
        {days.map((day) => (
          <div
            key={day.key}
            title={`${day.label} — ${day.count} ${day.count === 1 ? "session" : "sessions"}`}
            className={`aspect-square rounded-[2px] ${
              day.practiced ? "bg-accent" : "bg-line"
            }`}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-between text-[11px] text-muted/70">
        <span>{days[0]?.label ?? ""}</span>
        <span>today</span>
      </div>
    </div>
  );
}
