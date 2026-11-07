"use client";

import Link from "next/link";
import { paceLabel } from "@/lib/format";
import { modeName } from "@/lib/modes";
import type { TopicCategory } from "@/lib/topics";
import type { Mode, RatingResult } from "@/lib/types";
import CategoryChip from "./CategoryChip";
import ScoreBar from "./ScoreBar";
import ShareCard from "./ShareCard";

type Props = {
  result: RatingResult;
  topic: string;
  category?: TopicCategory;
  mode: Mode;
  onRestart: () => void;
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className="mt-2 font-mono text-xl tabular-nums text-white">{value}</p>
      {hint ? <p className="mt-1 text-xs text-accent">{hint}</p> : null}
    </div>
  );
}

export default function ResultView({ result, topic, category, mode, onRestart }: Props) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-panel p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Your result</p>
          <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted">
            {modeName(mode)}
          </span>
        </div>
        {category ? <CategoryChip category={category} className="mt-4" /> : null}
        <p
          className={`text-balance leading-snug text-white/90 ${
            category === "word" ? "mt-3 text-2xl sm:text-3xl" : "mt-3 text-lg"
          }`}
        >
          {topic}
        </p>

        <div className="mt-7 space-y-5">
          <ScoreBar label="Overall" value={result.overallScore} accent />
          <ScoreBar label="Content" value={result.contentScore} hint="structure · relevance · depth" />
          <ScoreBar label="Delivery" value={result.deliveryScore} hint="fillers · pacing · clarity" />
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Pace" value={`${result.wpm} WPM`} hint={paceLabel(result.wpm)} />
          <Stat label="Filler words" value={`${result.fillerWordCount}`} />
          <Stat
            label="Words"
            value={`${result.transcript.split(/\s+/).filter(Boolean).length}`}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-panel p-6 sm:p-8">
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Coach feedback</p>
        <p className="mt-4 text-[15px] leading-relaxed text-white/85">{result.feedback}</p>

        <div className="mt-7 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-accent">What worked</p>
            <ul className="mt-3 space-y-2">
              {result.strengths.map((item, index) => (
                <li key={`strength-${index}`} className="flex gap-2 text-sm leading-relaxed text-white/75">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent/70" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-medium text-white/90">What to fix</p>
            <ul className="mt-3 space-y-2">
              {result.improvements.map((item, index) => (
                <li key={`improvement-${index}`} className="flex gap-2 text-sm leading-relaxed text-white/75">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-white/40" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-panel p-6 sm:p-8">
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Transcript</p>
        <p className="mt-4 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-white/65">
          {result.transcript}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <ShareCard
          topic={topic}
          mode={mode}
          overallScore={result.overallScore}
          contentScore={result.contentScore}
          deliveryScore={result.deliveryScore}
          wpm={result.wpm}
        />
        <button
          type="button"
          onClick={onRestart}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90"
        >
          Practice again
        </button>
        <Link
          href="/history"
          className="rounded-full border border-line px-5 py-2.5 text-sm text-white/80 transition-colors hover:border-white/30 hover:text-white"
        >
          View history
        </Link>
      </div>
    </div>
  );
}
