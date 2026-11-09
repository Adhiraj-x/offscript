"use client";

import { MODES } from "@/lib/modes";
import type { Mode } from "@/lib/types";

type Props = {
  value: Mode | null;
  onChange: (mode: Mode) => void;
};

export default function ModePicker({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
      {MODES.map((mode) => {
        const active = value === mode.id;
        const prepTime = mode.id === "off-the-cuff" ? "60 seconds" : "10 minutes";

        return (
          <button
            key={mode.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(mode.id)}
            className={`group relative flex flex-col justify-between rounded-2xl border p-6 text-left transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base active:scale-[0.99] ${
              active
                ? "border-accent bg-accent/[0.05] shadow-[0_0_24px_-10px_rgba(201,249,108,0.22)]"
                : "border-line bg-panel hover:border-white/20 hover:bg-panel/80"
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-base font-medium text-white sm:text-lg">{mode.name}</span>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium transition-colors ${
                    active
                      ? "border border-accent/40 bg-accent/15 text-accent"
                      : "border border-line bg-base/60 text-muted group-hover:text-white/80"
                  }`}
                >
                  {prepTime}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                {mode.blurb}
              </p>
            </div>
            <div className="mt-5 flex items-center gap-2 border-t border-line/50 pt-3.5">
              <span className="text-[11px] uppercase tracking-[0.16em] text-muted/70">
                Preparation time: <span className="font-mono text-white/90">{prepTime}</span>
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
