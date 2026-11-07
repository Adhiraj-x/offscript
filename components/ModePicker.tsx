"use client";

import { MODES } from "@/lib/modes";
import type { Mode } from "@/lib/types";

type Props = {
  value: Mode | null;
  onChange: (mode: Mode) => void;
};

export default function ModePicker({ value, onChange }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {MODES.map((mode) => {
        const active = value === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(mode.id)}
            className={`rounded-2xl border p-6 text-left transition-colors ${
              active
                ? "border-accent/50 bg-accent/[0.06]"
                : "border-line bg-panel hover:border-white/20"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[15px] font-medium">{mode.name}</span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] ${
                  active ? "bg-accent/15 text-accent" : "bg-white/5 text-muted"
                }`}
              >
                {mode.prepLabel}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">{mode.blurb}</p>
          </button>
        );
      })}
    </div>
  );
}
