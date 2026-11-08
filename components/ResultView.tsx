"use client";

import { useState } from "react";
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
  onRetry?: () => void;
};

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-base/50 p-3.5">
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

export default function ResultView({
  result,
  topic,
  category,
  mode,
  onRestart,
  onRetry,
}: Props) {
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);

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

  const mainTakeaway = result.mainTakeaway?.trim() || result.feedback;
  const strengths = (result.strengths || []).slice(0, 2);
  const improvements = (result.improvements || []).slice(0, 3);
  const nextAttemptFocus =
    result.nextAttemptFocus?.trim() ||
    (result.improvements && result.improvements[0] ? result.improvements[0] : undefined);

  return (
    <div className="space-y-4">
      {/* 1. Evaluation Card: Scores & Topic */}
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
            category === "word" ? "mt-3 text-2xl font-medium sm:text-3xl" : "mt-3 text-lg font-medium sm:text-xl"
          }`}
        >
          {topic}
        </p>

        <div className="mt-7 space-y-4">
          <div className="border-b border-line/60 pb-5">
            <ScoreBar
              label="Overall"
              value={result.overallScore}
              band={bandLabel(result.overallScore)}
              accent
            />
          </div>
          <div className="space-y-4 pt-1">
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
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-muted/60">
          Overall is 60% content and 40% delivery. The coach awards both scores, judging delivery
          from the transcript and the measured pace, pauses and fillers; the server only
          calculates the 60/40 total.
        </p>
      </div>

      {/* 2. Coach Feedback Card (Centrepiece) */}
      <div className="rounded-2xl border border-line bg-panel p-6 sm:p-8">
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Coach feedback</p>

        {/* Part A: Main Takeaway */}
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/70">Main takeaway</p>
          <p className="mt-2 text-[15px] sm:text-base leading-relaxed text-white/95 font-medium">
            {mainTakeaway}
          </p>
          {result.mainTakeaway && result.feedback && result.feedback !== result.mainTakeaway ? (
            <p className="mt-2 text-sm leading-relaxed text-white/80">{result.feedback}</p>
          ) : null}
        </div>

        {/* Parts B & C: What Worked & What to Improve */}
        <div className="mt-6 grid gap-6 border-t border-line/60 pt-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">What worked</p>
            {strengths.length > 0 ? (
              <ul className="mt-3 space-y-2.5">
                {strengths.map((item, index) => (
                  <li key={`strength-${index}`} className="flex gap-2.5 text-sm leading-relaxed text-white/80">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-white/60">No specific strengths recorded.</p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/75">What to improve</p>
            {improvements.length > 0 ? (
              <ul className="mt-3 space-y-2.5">
                {improvements.map((item, index) => (
                  <li key={`improvement-${index}`} className="flex gap-2.5 text-sm leading-relaxed text-white/80">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-white/40" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-white/60">No specific improvements recorded.</p>
            )}
          </div>
        </div>

        {/* Part D: Focus on Your Next Attempt */}
        {nextAttemptFocus ? (
          <div className="mt-6 rounded-xl border border-accent/25 bg-accent/[0.04] p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
              Focus on your next attempt
            </p>
            <p className="mt-2 text-sm leading-relaxed text-white/90 sm:text-[15px]">
              {nextAttemptFocus}
            </p>
          </div>
        ) : null}
      </div>

      {/* 3. Advanced Speech Analysis (Collapsible) */}
      <div className="rounded-2xl border border-line bg-panel overflow-hidden transition-all">
        <button
          type="button"
          onClick={() => setIsAnalysisOpen((open) => !open)}
          aria-expanded={isAnalysisOpen}
          aria-controls="advanced-speech-analysis"
          className="flex w-full items-start justify-between gap-4 p-6 text-left transition-colors hover:bg-base/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset sm:p-8"
        >
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="text-sm font-semibold tracking-wide text-white sm:text-base">
                Advanced Speech Analysis
              </h3>
              <span className="rounded-full border border-line bg-base/60 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                Estimated metrics
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted/80 max-w-2xl">
              Explore your speaking pace, pauses and filler words. These measurements are estimates based on transcription and timestamps.
            </p>
          </div>
          <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-base/60 text-muted transition-transform duration-200">
            <svg
              className={`h-4 w-4 transition-transform duration-200 ${isAnalysisOpen ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {isAnalysisOpen ? (
          <div
            id="advanced-speech-analysis"
            className="border-t border-line/60 p-6 pt-6 sm:p-8 sm:pt-6"
          >
            {metrics ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Speech metrics</p>
                  <span className="rounded-full border border-line px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted/70">
                    {granularity === "word"
                      ? "Word timestamps"
                      : granularity === "segment"
                        ? "Segment timestamps"
                        : "Basic timing"}
                  </span>
                </div>

                <div className="mt-6 space-y-6">
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
                            className="rounded-full border border-line bg-base/50 px-2.5 py-0.5 text-[11px] text-muted"
                          >
                            {term} · {count}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <p className="mt-5 text-[11px] leading-relaxed text-muted/60">
                  Pace and pause figures are estimates from Whisper {granularity} timestamps, not acoustic
                  analysis. Filler counts are transcript-detected estimates and miss anything the transcriber
                  dropped.
                </p>
              </>
            ) : (
              <>
                <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Speech metrics</p>
                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <Stat label="Detected fillers" value={`${fillerTotal}`} note="transcript estimate" />
                  <Stat label="Words" value={`${wordCount}`} />
                </div>
                <p className="mt-5 text-[11px] leading-relaxed text-muted/60">
                  Timing metrics weren&apos;t available for this take, so pace and pauses are not shown.
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* 4. Transcript Card */}
      <div className="rounded-2xl border border-line bg-panel p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Transcript</p>
          <span className="font-mono text-[11px] tabular-nums text-muted/70">{wordCount} words</span>
        </div>
        <p className="mt-4 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-white/75">
          {result.transcript}
        </p>
      </div>

      {/* 5. Actions Area */}
      <div className="pt-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2.5">
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex h-10 items-center justify-center rounded-full bg-accent px-6 text-sm font-medium text-black transition-all hover:bg-accent/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base"
              >
                Retry
              </button>
            ) : null}
            <button
              type="button"
              onClick={onRestart}
              className={
                onRetry
                  ? "inline-flex h-10 items-center justify-center rounded-full border border-line bg-panel/60 px-5 text-sm text-white/85 transition-all hover:border-white/30 hover:bg-panel hover:text-white active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-base"
                  : "inline-flex h-10 items-center justify-center rounded-full bg-accent px-6 text-sm font-medium text-black transition-all hover:bg-accent/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base"
              }
            >
              Home
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <ShareCard
              topic={topic}
              mode={mode}
              overallScore={result.overallScore}
              contentScore={result.contentScore}
              deliveryScore={result.deliveryScore}
              wpm={result.wpm}
            />
            <Link
              href="/history"
              className="inline-flex h-10 items-center justify-center rounded-full border border-line bg-panel/60 px-5 text-sm text-white/85 transition-all hover:border-white/30 hover:bg-panel hover:text-white active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-base"
            >
              View history
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
