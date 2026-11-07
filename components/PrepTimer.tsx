"use client";

import { useEffect, useRef, useState } from "react";
import { formatClock } from "@/lib/format";

type Props = {
  seconds: number;
  label: string;
  onDone: () => void;
  onSkip: () => void;
};

export default function PrepTimer({ seconds, label, onDone, onSkip }: Props) {
  const [remaining, setRemaining] = useState(seconds);
  const doneRef = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      setRemaining((value) => (value > 0 ? value - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (remaining === 0 && !doneRef.current) {
      doneRef.current = true;
      onDone();
    }
  }, [remaining, onDone]);

  const progress = seconds > 0 ? ((seconds - remaining) / seconds) * 100 : 100;

  return (
    <div className="rounded-2xl border border-line bg-panel p-8 text-center sm:p-10">
      <p className="text-[11px] uppercase tracking-[0.22em] text-muted">{label} prep</p>
      <p className="mt-5 font-mono text-6xl tabular-nums tracking-tight sm:text-7xl">
        {formatClock(remaining)}
      </p>
      <div className="mx-auto mt-7 h-1 w-full max-w-md overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-accent transition-all duration-1000 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-5 text-sm text-muted">
        Research, outline, or just think it through. Speaking starts on its own at 0:00.
      </p>
      <button
        type="button"
        onClick={onSkip}
        className="mt-7 inline-flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm text-white/85 transition-colors hover:border-accent/50 hover:text-white"
      >
        Skip to speaking
        <span aria-hidden>→</span>
      </button>
    </div>
  );
}
