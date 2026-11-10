"use client";

import { useCallback, useEffect, useState } from "react";
import { useAmbient } from "@/components/AmbientBackground";
import Header from "@/components/Header";
import ModePicker from "@/components/ModePicker";
import PrepTimer from "@/components/PrepTimer";
import Recorder from "@/components/Recorder";
import ResultView from "@/components/ResultView";
import TopicSpinner from "@/components/TopicSpinner";
import { coerceFillers } from "@/lib/fillers";
import { clampScore, roundRate } from "@/lib/format";
import { modeInfo, modeName } from "@/lib/modes";
import { coerceSpeechMetrics } from "@/lib/speechMetrics";
import { loadHistory, newSessionId, saveSession } from "@/lib/storage";
import { computeStreak } from "@/lib/streak";
import { refreshTopicsInBackground } from "@/lib/topicPool";
import type { Topic } from "@/lib/topics";
import type { Mode, RatingResult, Session } from "@/lib/types";

type Phase = "setup" | "prep" | "speak" | "scoring" | "result" | "error";

type RatePayload = Partial<RatingResult> & {
  ok?: boolean;
  message?: string;
  error?: string;
  wordCount?: number;
  duration?: number | null;
  metrics?: unknown;
};

export default function HomePage() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [result, setResult] = useState<RatingResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [retainedAudio, setRetainedAudio] = useState<Blob | null>(null);
  const [streak, setStreak] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [prepAttempt, setPrepAttempt] = useState(0);
  const { setIntensity } = useAmbient();

  useEffect(() => {
    if (phase === "setup") {
      setIntensity("full");
    } else if (phase === "prep") {
      setIntensity("subtle");
    } else if (phase === "speak" || phase === "scoring") {
      setIntensity("minimal");
    } else if (phase === "result" || phase === "error") {
      setIntensity("subtle");
    }
  }, [phase, setIntensity]);

  useEffect(() => {
    setStreak(computeStreak(loadHistory()).current);
    // Quietly tops up the AI topic pool; never blocks the UI or a spin.
    void refreshTopicsInBackground();

    try {
      const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      if (q && q.get("mock_phase") === "prep") {
        setMode("off-the-cuff");
        setTopic({ text: "The Future of Ambient Interface Design", category: "CONCEPT" });
        setPhase("prep");
      } else if (q && q.get("mock_phase") === "speak") {
        setMode("off-the-cuff");
        setTopic({ text: "The Future of Ambient Interface Design", category: "CONCEPT" });
        setPhase("speak");
      } else if (q && q.get("mock_result") === "true") {
        setMode("off-the-cuff");
        setTopic({ text: "The Future of Ambient Interface Design", category: "CONCEPT" });
        setPhase("result");
        setResult({
          overallScore: 84,
          contentScore: 86,
          deliveryScore: 81,
          mainTakeaway: "Clear structure with articulate delivery and calm pacing.",
          nextAttemptFocus: "Reduce pause duration when moving between key arguments.",
          feedback: "A thoughtful and nuanced answer that made effective use of vivid imagery.",
          strengths: ["Distinct main thesis", "Natural conversational tone"],
          improvements: ["Watch pauses between paragraphs", "Vary articulation speed"],
          wpm: 138,
          fillerWordCount: 3,
          transcript:
            "Ambient interfaces should provide spatial depth and calmness without competing with the primary content.",
          metrics: {
            wordCount: 145,
            durationSeconds: 63,
            durationBasis: "reported",
            activeSpeechSeconds: 55.9,
            wpm: 138,
            wpmBasis: "total-duration",
            speakingRateWpm: 138,
            articulationWpm: 155,
            timestampGranularity: "word",
            pausesAvailable: true,
            pausesLowPrecision: false,
            noticeablePauseThresholdSeconds: 0.5,
            longPauseThresholdSeconds: 1.5,
            noticeablePauseCount: 4,
            noticeablePauseTotalSeconds: 7.1,
            longPauseCount: 2,
            longPauseTotalSeconds: 3.6,
            longestPauseSeconds: 1.8,
            pauseFrequencyPerMinute: 3.8,
            pauseCount: 2,
            pauseThresholdSeconds: 1.5,
          },
          fillers: {
            total: 3,
            definiteCount: 3,
            contextualCount: 0,
            repeatedRunCount: 0,
            per100Words: 2.1,
            counts: { um: 2, like: 1 },
            isEstimate: true,
          },
        });
      }
    } catch {}
  }, []);

  const submitRecording = useCallback(
    async (blob: Blob, currentTopic: Topic, selectedMode: Mode) => {
      setPhase("scoring");
      setResult(null);
      setErrorMessage("");
      setRetainedAudio(blob);

      const form = new FormData();
      const extension = blob.type.includes("mp4") ? "m4a" : "webm";
      form.append("audio", blob, `take.${extension}`);
      form.append("topic", currentTopic.text);
      form.append("mode", selectedMode);

      try {
        const response = await fetch("/api/rate", { method: "POST", body: form });
        const payload = (await response.json().catch(() => null)) as RatePayload | null;

        if (!response.ok || !payload?.ok) {
          let message = payload?.message || "Something went wrong while rating that take. Try again.";

          if (response.status === 429) {
            message = "Free limit hit, try again in a minute.";
          } else if (payload?.error === "TOO_SHORT") {
            setRetainedAudio(null);
            const words = Math.max(0, Math.round(Number(payload.wordCount ?? 0)));
            const seconds = Math.max(0, Math.round(Number(payload.duration ?? 0)));
            const heard = String(payload.transcript ?? "").trim();

            if (words === 0) {
              message =
                "We didn't pick up any speech in that take. Check that your mic isn't muted and the right input device is selected, then record again.";
            } else {
              message = `We only caught ${words} word${words === 1 ? "" : "s"}${
                seconds > 0 ? ` in ${seconds}s of audio` : ""
              }. Talk for at least 20–30 seconds so there's something to score.`;
            }

            if (heard) {
              message += ` Here's what we heard: “${heard.slice(0, 120)}${heard.length > 120 ? "…" : ""}”`;
            }
          }

          setErrorMessage(message);
          setPhase("error");
          return;
        }

        const metrics = coerceSpeechMetrics(payload.metrics);
        const fillers = coerceFillers(payload.fillers);
        const mainTakeaway =
          typeof payload.mainTakeaway === "string" && payload.mainTakeaway.trim().length > 0
            ? payload.mainTakeaway.trim()
            : undefined;
        const nextAttemptFocus =
          typeof payload.nextAttemptFocus === "string" && payload.nextAttemptFocus.trim().length > 0
            ? payload.nextAttemptFocus.trim()
            : undefined;
        const rated: RatingResult = {
          contentScore: clampScore(Number(payload.contentScore ?? 0)),
          deliveryScore: clampScore(Number(payload.deliveryScore ?? 0)),
          overallScore: clampScore(Number(payload.overallScore ?? 0)),
          feedback: String(payload.feedback ?? ""),
          strengths: Array.isArray(payload.strengths) ? payload.strengths.map(String) : [],
          improvements: Array.isArray(payload.improvements) ? payload.improvements.map(String) : [],
          mainTakeaway,
          nextAttemptFocus,
          wpm: roundRate(Number(metrics?.wpm ?? payload.wpm ?? 0)),
          fillerWordCount: Math.max(
            0,
            Math.round(Number(payload.fillerWordCount ?? fillers?.total ?? 0)),
          ),
          transcript: String(payload.transcript ?? ""),
          metrics: metrics ?? undefined,
          fillers: fillers ?? undefined,
        };

        const session: Session = {
          id: newSessionId(),
          date: new Date().toISOString(),
          topic: currentTopic.text,
          mode: selectedMode,
          category: currentTopic.category,
          contentScore: rated.contentScore,
          deliveryScore: rated.deliveryScore,
          overallScore: rated.overallScore,
          wpm: rated.wpm,
          fillerWordCount: rated.fillerWordCount,
          feedback: rated.feedback,
          transcript: rated.transcript,
          mainTakeaway,
          nextAttemptFocus,
          metrics: metrics ?? undefined,
          fillers: fillers ?? undefined,
        };
        saveSession(session);

        setRetainedAudio(null);
        setResult(rated);
        setStreak(computeStreak(loadHistory()).current);
        setPhase("result");
      } catch {
        setErrorMessage("Network hiccup — check your connection and try again.");
        setPhase("error");
      }
    },
    [],
  );

  const handleRecorded = useCallback(
    (blob: Blob) => {
      if (!topic || !mode) return;
      void submitRecording(blob, topic, mode);
    },
    [mode, submitRecording, topic],
  );

  const startPrep = useCallback(() => setPhase("prep"), []);
  const startSpeaking = useCallback(() => setPhase("speak"), []);

  const retrySameTopic = useCallback(() => {
    if (!topic || !mode) return;
    setRetainedAudio(null);
    setResult(null);
    setErrorMessage("");
    setPrepAttempt((prev) => prev + 1);
    setPhase("prep");
  }, [topic, mode]);

  const resetPractice = useCallback(() => {
    setRetainedAudio(null);
    setResult(null);
    setErrorMessage("");
    setTopic(null);
    setSpinning(false);
    setPrepAttempt(0);
    setPhase("setup");
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0);
    }
  }, []);

  function pickMode(next: Mode) {
    setMode(next);
    setRetainedAudio(null);
    if (phase !== "setup") {
      setPhase("setup");
      setResult(null);
      setPrepAttempt(0);
    }
  }

  return (
    <main className="relative z-10 mx-auto w-full max-w-2xl px-6 pb-24">
      <Header streak={streak} onLogoClick={resetPractice} />

      {phase === "setup" ? (
        <div className="pt-4 sm:pt-6">
          {/* Hero Section */}
          <section className="pt-3 pb-1 text-center sm:pt-6 sm:pb-2">
            <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Prepare. Speak. Improve.
            </h1>
            <p
              className="mx-auto mt-4 sm:mt-5 max-w-[520px] text-balance text-sm sm:text-base leading-relaxed select-none text-muted"
              style={{ color: "var(--text-muted)", userSelect: "none" }}
            >
              Where ideas take shape and voices find confidence.
            </p>
          </section>

          {/* Section 1: Topic Selection */}
          <section className="mt-7 sm:mt-8 space-y-3 sm:space-y-3.5">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
              1 — GET A TOPIC
            </h2>
            <TopicSpinner
              topic={topic}
              onPick={setTopic}
              disabled={spinning}
              onSpinStateChange={setSpinning}
            />
          </section>

          {/* Section 2: Mode Selection */}
          <section className="mt-6 sm:mt-10 space-y-3 sm:space-y-3.5">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
              2 — PICK A MODE
            </h2>
            <ModePicker value={mode} onChange={pickMode} />
          </section>

          {/* Primary Action CTA */}
          <section className="mt-5 sm:mt-8">
            <button
              type="button"
              onClick={startPrep}
              disabled={!mode || !topic || spinning}
              className={`w-full rounded-full py-4 px-8 text-sm sm:text-base font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base sm:w-auto ${
                mode && topic && !spinning
                  ? "border border-transparent bg-accent text-accent-contrast hover:opacity-90 active:scale-[0.98] shadow-[0_0_24px_-8px_var(--color-topic-glow-halo)] cursor-pointer"
                  : "border border-line bg-panel text-muted cursor-not-allowed shadow-none disabled:border-line disabled:bg-panel disabled:text-muted disabled:opacity-100 disabled:cursor-not-allowed"
              }`}
            >
              <span className={mode && topic && !spinning ? "text-accent-contrast" : "text-muted"}>
                {topic && mode
                  ? "Start preparation"
                  : topic && !mode
                    ? "Pick a mode to continue"
                    : !topic && mode
                      ? "Get a topic to continue"
                      : "Get a topic and pick a mode"}
              </span>
            </button>
          </section>
        </div>
      ) : null}

      {phase === "prep" && mode && topic ? (
        <div className="pt-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Preparation</p>
            <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted">
              {modeName(mode)}
            </span>
          </div>
          <p className="text-balance text-lg leading-snug text-foreground">{topic.text}</p>
          <div className="mt-8">
            <PrepTimer
              key={`${mode}-${topic.text}-${prepAttempt}`}
              seconds={modeInfo(mode).prepSeconds}
              label={modeInfo(mode).prepLabel.replace(" prep", "")}
              onDone={startSpeaking}
              onSkip={startSpeaking}
            />
          </div>
          <button
            type="button"
            onClick={resetPractice}
            className="mt-6 text-sm text-muted transition-colors hover:text-foreground"
          >
            ← Back to setup
          </button>
        </div>
      ) : null}

      {phase === "speak" && mode && topic ? (
        <div className="pt-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Topic</p>
            <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted">
              {modeName(mode)}
            </span>
          </div>
          <p className="mt-3 text-balance text-xl leading-snug text-foreground">{topic.text}</p>
          <div className="mt-8">
            <Recorder onComplete={handleRecorded} onCancel={resetPractice} />
          </div>
        </div>
      ) : null}

      {phase === "scoring" ? (
        <div className="pt-16">
          <div className="rounded-2xl border border-line bg-panel p-10 text-center">
            <div className="flex h-7 items-center justify-center gap-1.5" aria-hidden>
              {[0, 1, 2, 3, 4].map((index) => (
                <span
                  key={index}
                  className="eq-bar"
                  style={{ animationDelay: `${index * 140}ms`, height: `${16 + (index % 3) * 8}px` }}
                />
              ))}
            </div>
            <p className="mt-6 text-foreground/85">Listening back…</p>
            <p className="mt-2 text-sm text-muted">
              Transcribing your take, counting fillers, and writing feedback. Takes a few seconds.
            </p>
          </div>
        </div>
      ) : null}

      {phase === "error" ? (
        <div className="pt-16">
          <div className="rounded-2xl border border-line bg-panel p-8 text-center sm:p-10">
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Couldn&apos;t score that</p>
            <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-foreground/85">{errorMessage}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {retainedAudio && topic && mode ? (
                <button
                  type="button"
                  onClick={() => submitRecording(retainedAudio, topic, mode)}
                  className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-contrast transition-opacity hover:opacity-90 active:scale-[0.98]"
                >
                  Retry evaluation
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setRetainedAudio(null);
                  setPhase("speak");
                }}
                className={
                  retainedAudio && topic && mode
                    ? "rounded-full border border-line bg-raised/70 px-5 py-2.5 text-sm font-medium text-foreground transition-all hover:border-foreground/30 hover:bg-raised hover:text-foreground active:scale-[0.98]"
                    : "rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-contrast transition-opacity hover:opacity-90 active:scale-[0.98]"
                }
              >
                Record again
              </button>
              <button
                type="button"
                onClick={resetPractice}
                className="rounded-full border border-line px-5 py-2.5 text-sm text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                Change topic
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {phase === "result" && result && mode && topic ? (
        <div className="pt-6">
          <ResultView
            result={result}
            topic={topic.text}
            category={topic.category}
            mode={mode}
            onRestart={resetPractice}
            onRetry={retrySameTopic}
          />
        </div>
      ) : null}
    </main>
  );
}
