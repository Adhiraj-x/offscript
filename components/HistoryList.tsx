"use client";

import { useState } from "react";
import { formatDate, formatTime } from "@/lib/format";
import { modeName } from "@/lib/modes";
import { describePace } from "@/lib/scoring";
import type { Session } from "@/lib/types";

/**
 * Same source as the result screen: the speaking rate, which is what the pace bands
 * classify. Sprint 01 records without metrics keep their stored WPM.
 */
function paceLabel(session: Session): string {
  return describePace(session.metrics ? session.metrics.speakingRateWpm : session.wpm);
}

function SessionCard({
  session,
  open,
  onToggle,
}: {
  session: Session;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-2xl border border-line bg-panel transition-colors hover:border-foreground/20">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-4 p-5 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-muted">
              {modeName(session.mode)}
            </span>
            <span className="text-[11px] text-muted/70">
              {formatDate(session.date)} · {formatTime(session.date)}
            </span>
          </div>
          <p className={`mt-2 text-[15px] leading-snug text-foreground ${open ? "" : "line-clamp-2"}`}>
            {session.topic}
          </p>
          <p className="mt-2 text-xs text-muted">
            Content {session.contentScore} · Delivery {session.deliveryScore} · {session.wpm} WPM ·{" "}
            {paceLabel(session)} · {session.fillerWordCount} fillers
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`font-mono text-2xl tabular-nums ${open ? "text-accent" : "text-foreground"}`}>
            {session.overallScore}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted/70">overall</p>
        </div>
      </button>

      {open ? (
        <div className="border-t border-line px-5 py-5">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Feedback</p>
          <p className="mt-3 text-sm leading-relaxed text-secondary">{session.feedback}</p>
          <p className="mt-6 text-[11px] uppercase tracking-[0.22em] text-muted">Transcript</p>
          <p className="mt-3 max-h-60 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-muted">
            {session.transcript}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default function HistoryList({ sessions }: { sessions: Session[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (sessions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line p-10 text-center">
        <p className="text-foreground/80">No sessions yet.</p>
        <p className="mt-2 text-sm text-muted">
          Your rated sessions land here — stored in this browser only.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          open={openId === session.id}
          onToggle={() => setOpenId((current) => (current === session.id ? null : session.id))}
        />
      ))}
    </div>
  );
}
