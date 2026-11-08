"use client";

import Link from "next/link";
import { formatClock, formatSeconds } from "@/lib/format";
import { modeName } from "@/lib/modes";
import { bandLabel, classifyPace } from "@/lib/scoring";
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

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-3.5">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="mt-1.5 font-mono text-lg tabular-nums text-white">{value}</p>
      {note ? <p className="mt-0.5 text-[11px] leading-snug text-muted/70">{note}</p> : null}
    </div>
  );
}

function MetricGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted/80">{title}</p>
      <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">{children}</div>
    </div>
  );
}

function rateValue(value: number | null): string {
  if (value === null) return "—";
  return `${Number.isInteger(value) ? value : value.toFixed(1)} WPM`;
}

function decimal(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

export default function ResultView({ result, topic, category, mode, onRestart }: Props) {
  const metrics = result.metrics;
  const pace = classifyPace(metrics?.speakingRateWpm ?? null);
  const pausesAvailable =
    metrics?.pausesAvailable === true && metrics.noticeablePauseCount !== null;
  const fillerTotal = result.fillers?.total ?? result.fillerWordCount;
  const fillerRate =
    result.fillers?.per100Words ??
    (metrics && metrics.wordCount > 0
      ? Math.round((fillerTotal / metrics.wordCount) * 1000) / 10
      : null);
  const fillerTypes = result.fillers
    ? Object.entries(result.fillers.counts).sort((a, b) => b[1] - a[1])
    : [];
  const wordCount =
    metrics?.wordCount ?? result.transcript.split(/\s+/).filter(Boolean).length;
  const granularity =
    metrics?.timestampGranularity === "segment"
      ? "segment"
      : metrics?.timestampGranularity === "word"
        ? "word"
        : "transcription";

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
          <ScoreBar
            label="Overall"
            value={result.overallScore}
            band={bandLabel(result.overallScore)}
            accent
          />
          <ScoreBar
            label="Content"
            value={result.contentScore}
            hint="relevance · structure · depth"
            band={bandLabel(result.contentScore)}
          />
          <ScoreBar
            label="Delivery"
            value={result.deliveryScore}
            hint="pace · pauses · fillers"
            band={bandLabel(result.deliveryScore)}
          />
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-muted/60">
          Overall is 60% content and 40% delivery. The coach awards both scores, judging delivery
          from the transcript and the measured pace, pauses and fillers; the server only
          calculates the 60/40 total.
        </p>

        {metrics ? (
          <div className="mt-7 space-y-6">
            <MetricGroup title="Pace">
              <Stat
                label="Speaking rate"
                value={rateValue(metrics.speakingRateWpm)}
                note={pace ? `${pace.label} · pauses included` : "pauses included"}
              />
              <Stat
                label="Articulation"
                value={rateValue(metrics.articulationWpm)}
                note="pauses excluded"
              />
              <Stat
                label="Active speech"
                value={
                  metrics.activeSpeechSeconds === null
                    ? "—"
                    : formatSeconds(metrics.activeSpeechSeconds)
                }
                note="estimated"
              />
              <Stat
                label="Recording"
                value={metrics.durationSeconds === null ? "—" : formatClock(metrics.durationSeconds)}
                note="total length"
              />
            </MetricGroup>

            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted/80">Pauses</p>
              {pausesAvailable ? (
                <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <Stat
                    label="Noticeable"
                    value={`${metrics.noticeablePauseCount ?? 0}`}
                    note={`≥ ${metrics.noticeablePauseThresholdSeconds}s`}
                  />
                  <Stat
                    label="Long"
                    value={`${metrics.longPauseCount ?? 0}`}
                    note={`≥ ${metrics.longPauseThresholdSeconds}s`}
                  />
                  <Stat
                    label="Longest"
                    value={formatSeconds(metrics.longestPauseSeconds ?? 0)}
                    note="from timestamps"
                  />
                  <Stat
                    label="Per minute"
                    value={decimal(metrics.pauseFrequencyPerMinute)}
                    note="noticeable pauses"
                  />
                </div>
              ) : (
                <p className="mt-2 rounded-xl border border-dashed border-line p-4 text-xs leading-relaxed text-muted">
                  Pauses weren&apos;t measurable for this take: the transcriber returned no usable
                  timestamps, so no pause figures were invented.
                </p>
              )}
              {pausesAvailable && metrics.pausesLowPrecision ? (
                <p className="mt-2 text-[11px] leading-relaxed text-muted/70">
                  Lower precision: only segment timestamps were available, so pauses inside a
                  segment couldn&apos;t be seen. These counts are a lower bound.
                </p>
              ) : null}
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted/80">Fillers</p>
              <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <Stat label="Detected" value={`${fillerTotal}`} note="transcript estimate" />
                <Stat
                  label="Rate"
                  value={fillerRate === null ? "—" : `${fillerRate}`}
                  note="per 100 words"
                />
                <Stat label="Words" value={`${wordCount}`} />
                <Stat label="Basis" value="estimated" note="Whisper drops some fillers" />
              </div>
              {fillerTypes.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {fillerTypes.map(([term, count]) => (
                    <span
                      key={term}
                      className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted"
                    >
                      {term} · {count}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat label="Detected fillers" value={`${fillerTotal}`} note="transcript estimate" />
            <Stat label="Words" value={`${wordCount}`} />
          </div>
        )}

        <p className="mt-5 text-[11px] leading-relaxed text-muted/60">
          {metrics
            ? `Pace and pause figures are estimates from Whisper ${granularity} timestamps, not acoustic analysis. Filler counts are transcript-detected estimates and miss anything the transcriber dropped.`
            : "Timing metrics weren't available for this take, so pace and pauses are not shown."}
        </p>
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
