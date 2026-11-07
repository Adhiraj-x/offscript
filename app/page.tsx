"use client";

import { useCallback, useEffect, useState } from "react";
import Header from "@/components/Header";
import ModePicker from "@/components/ModePicker";
import PrepTimer from "@/components/PrepTimer";
import Recorder from "@/components/Recorder";
import ResultView from "@/components/ResultView";
import TopicSpinner from "@/components/TopicSpinner";
import { clampScore } from "@/lib/format";
import { modeInfo } from "@/lib/modes";
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
};

export default function HomePage() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [result, setResult] = useState<RatingResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [streak, setStreak] = useState(0);
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    setStreak(computeStreak(loadHistory()).current);
    // Quietly tops up the AI topic pool; never blocks the UI or a spin.
    void refreshTopicsInBackground();
  }, []);

  const submitRecording = useCallback(
    async (blob: Blob, currentTopic: Topic, selectedMode: Mode) => {
      setPhase("scoring");
      setResult(null);
      setErrorMessage("");

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

        const rated: RatingResult = {
          contentScore: clampScore(Number(payload.contentScore ?? 0)),
          deliveryScore: clampScore(Number(payload.deliveryScore ?? 0)),
          overallScore: clampScore(Number(payload.overallScore ?? 0)),
          feedback: String(payload.feedback ?? ""),
          strengths: Array.isArray(payload.strengths) ? payload.strengths.map(String) : [],
          improvements: Array.isArray(payload.improvements) ? payload.improvements.map(String) : [],
          wpm: Math.max(0, Math.round(Number(payload.wpm ?? 0))),
          fillerWordCount: Math.max(0, Math.round(Number(payload.fillerWordCount ?? 0))),
          transcript: String(payload.transcript ?? ""),
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
        };
        saveSession(session);

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

  function resetPractice() {
    setResult(null);
    setErrorMessage("");
    setTopic(null);
    setSpinning(false);
    setPhase("setup");
  }

  function pickMode(next: Mode) {
    setMode(next);
    if (phase !== "setup") {
      setPhase("setup");
      setResult(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-24">
      <Header streak={streak} />

      {phase === "setup" ? (
        <div className="pt-10">
          <p className="text-[11px] uppercase tracking-[0.22em] text-accent">Speaking practice</p>
          <h1 className="mt-4 text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Practice thinking
            <br />
            out loud.
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
            Pick a mode, spin a topic, then talk for two minutes. You&apos;ll get a transcript and honest
            feedback on what you said and how you said it.
          </p>

          <section className="mt-12">
            <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted">1 — Pick a mode</p>
            <ModePicker value={mode} onChange={pickMode} />
          </section>

          <section className="mt-10">
            <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted">2 — Spin a topic</p>
            <TopicSpinner
              topic={topic}
              onPick={setTopic}
              disabled={!mode}
              onSpinStateChange={setSpinning}
            />
          </section>

          <button
            type="button"
            onClick={startPrep}
            disabled={!mode || !topic || spinning}
            className="mt-8 w-full rounded-full bg-accent px-6 py-3 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted sm:w-auto sm:px-8"
          >
            {spinning
              ? "Spinning…"
              : mode && topic
                ? `Start ${modeInfo(mode).prepLabel} →`
                : "Pick a mode and spin a topic"}
          </button>
        </div>
      ) : null}

      {phase === "prep" && mode && topic ? (
        <div className="pt-6">
          <p className="text-balance text-lg leading-snug text-white/90">{topic.text}</p>
          <div className="mt-8">
            <PrepTimer
              key={`${mode}-${topic.text}`}
              seconds={modeInfo(mode).prepSeconds}
              label={modeInfo(mode).prepLabel.replace(" prep", "")}
              onDone={startSpeaking}
              onSkip={startSpeaking}
            />
          </div>
          <button
            type="button"
            onClick={resetPractice}
            className="mt-6 text-sm text-muted transition-colors hover:text-white"
          >
            ← Back to setup
          </button>
        </div>
      ) : null}

      {phase === "speak" && mode && topic ? (
        <div className="pt-6">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Topic</p>
          <p className="mt-3 text-balance text-xl leading-snug text-white/90">{topic.text}</p>
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
            <p className="mt-6 text-white/85">Listening back…</p>
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
            <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-white/85">{errorMessage}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => setPhase("speak")}
                className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90"
              >
                Record again
              </button>
              <button
                type="button"
                onClick={resetPractice}
                className="rounded-full border border-line px-5 py-2.5 text-sm text-white/80 transition-colors hover:border-white/30 hover:text-white"
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
          />
        </div>
      ) : null}
    </main>
  );
}
