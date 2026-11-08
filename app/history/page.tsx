"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import Heatmap from "@/components/Heatmap";
import HistoryList from "@/components/HistoryList";
import { loadHistory } from "@/lib/storage";
import { computeStreak } from "@/lib/streak";
import type { Session } from "@/lib/types";

function FlameIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    setSessions(loadHistory());
  }, []);

  const streak = useMemo(() => computeStreak(sessions ?? []), [sessions]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-24">
      <Header streak={streak.current} />

      <div className="pt-10">
        <h1 className="text-3xl font-semibold tracking-tight">History</h1>
        <p className="mt-3 text-sm text-muted">
          Every rated session, stored in this browser only. Nothing leaves your device.
        </p>
      </div>

      {sessions === null ? (
        <div className="mt-12 h-24 animate-pulse rounded-2xl bg-panel" />
      ) : (
        <>
          <section className="mt-10">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-lg">
                {streak.current > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-accent">
                    <FlameIcon className="h-4 w-4" />
                    <span>{streak.current} day streak</span>
                  </span>
                ) : (
                  <span className="text-white/70">No streak yet — practice today to start one.</span>
                )}
              </p>
              <p className="text-xs text-muted">
                Longest: {streak.longest} {streak.longest === 1 ? "day" : "days"}
              </p>
            </div>
            <div className="mt-4">
              <Heatmap sessions={sessions} />
            </div>
          </section>

          <section className="mt-8">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.22em] text-muted">
                {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
              </p>
              <Link href="/" className="text-sm text-muted transition-colors hover:text-white">
                Practice →
              </Link>
            </div>
            <HistoryList sessions={sessions} />
          </section>
        </>
      )}
    </main>
  );
}
