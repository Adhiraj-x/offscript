"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CategoryChip from "./CategoryChip";
import {
  pickTopic,
  recentTopicTexts,
  topicTextClass,
  type Topic,
  type TopicCategory,
} from "@/lib/topics";
import { availableTopics, consumeTopic } from "@/lib/topicPool";

const ANIMATION_WORDS = [
  "Ambition",
  "Nostalgia",
  "Technology",
  "Creativity",
  "Success",
  "Human connection",
];

const CATEGORIES: TopicCategory[] = ["statement", "general", "trend", "word"];

type Props = {
  topic: Topic | null;
  onPick: (topic: Topic) => void;
  disabled?: boolean;
  onSpinStateChange?: (spinning: boolean) => void;
  onError?: (message: string) => void;
};

export default function TopicSpinner({
  topic,
  onPick,
  disabled,
  onSpinStateChange,
  onError,
}: Props) {
  const [status, setStatus] = useState<"idle" | "finding" | "ready">(
    topic ? "ready" : "idle",
  );
  const [animWordIndex, setAnimWordIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const unmountedRef = useRef(false);
  const cycleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    unmountedRef.current = false;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", onChange);

    return () => {
      unmountedRef.current = true;
      query.removeEventListener("change", onChange);
      if (cycleTimerRef.current) {
        clearInterval(cycleTimerRef.current);
        cycleTimerRef.current = null;
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  // Sync external topic reset (e.g. Back to setup or resetPractice)
  useEffect(() => {
    if (!topic && !isLoading) {
      setStatus("idle");
    } else if (topic && !isLoading) {
      setStatus("ready");
    }
  }, [topic, isLoading]);

  const generateTopic = useCallback(async () => {
    if (disabled || isLoading) return;

    setIsLoading(true);
    setStatus("finding");
    setAnimWordIndex(0);
    onSpinStateChange?.(true);

    // Abort any prior in-flight request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Start cycling through the decorative anticipation words
    if (cycleTimerRef.current) clearInterval(cycleTimerRef.current);
    cycleTimerRef.current = setInterval(() => {
      if (unmountedRef.current) return;
      setAnimWordIndex((prev) => (prev + 1) % ANIMATION_WORDS.length);
    }, 450);

    const randomCategory = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    const avoid = recentTopicTexts(30);

    try {
      const response = await fetch(
        `/api/topics?category=${encodeURIComponent(randomCategory)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avoid }),
          signal: controller.signal,
        },
      );

      let selectedTopic: Topic | null = null;

      if (response.ok) {
        const payload = (await response.json()) as { topics?: unknown };
        if (Array.isArray(payload.topics) && payload.topics.length > 0) {
          const candidates = (payload.topics as Topic[]).filter(
            (t) =>
              typeof t?.text === "string" &&
              t.text.trim().length > 0 &&
              (!topic || t.text.toLowerCase() !== topic.text.toLowerCase()),
          );
          const chosen =
            candidates.length > 0
              ? candidates[Math.floor(Math.random() * candidates.length)]
              : (payload.topics[0] as Topic);

          if (chosen && typeof chosen.text === "string") {
            selectedTopic = {
              text: chosen.text.trim(),
              category: chosen.category || randomCategory,
            };
            consumeTopic(chosen.text);
          }
        }
      }

      // Resilient fallback to local pool if API was unreachable or empty
      if (!selectedTopic) {
        const candidates = availableTopics();
        selectedTopic = pickTopic(candidates);
        if (topic && selectedTopic.text === topic.text) {
          selectedTopic = pickTopic(candidates);
        }
      }

      if (unmountedRef.current) return;

      // Stop word cycling immediately on arrival
      if (cycleTimerRef.current) {
        clearInterval(cycleTimerRef.current);
        cycleTimerRef.current = null;
      }

      setStatus("ready");
      setIsLoading(false);
      onSpinStateChange?.(false);
      onPick(selectedTopic);
    } catch (err: unknown) {
      if (controller.signal.aborted || unmountedRef.current) return;

      if (cycleTimerRef.current) {
        clearInterval(cycleTimerRef.current);
        cycleTimerRef.current = null;
      }

      // Safe fallback to built-in topic pool so user can always practice
      try {
        const fallback = pickTopic(availableTopics());
        setStatus("ready");
        setIsLoading(false);
        onSpinStateChange?.(false);
        onPick(fallback);
      } catch {
        setStatus("idle");
        setIsLoading(false);
        onSpinStateChange?.(false);
        onError?.("Couldn't generate a topic right now. Please try again.");
      }
    }
  }, [disabled, isLoading, onPick, onSpinStateChange, onError, topic]);

  return (
    <div className="rounded-2xl border border-line bg-panel p-6 sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          {status === "finding" ? (
            <span className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.22em] text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              FINDING YOUR TOPIC...
            </span>
          ) : status === "ready" && topic ? (
            <span className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.22em] text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              READY
            </span>
          ) : (
            <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
              YOUR TOPIC
            </span>
          )}
        </div>
      </div>

      {/* Main topic display area */}
      <div className="mt-5 flex min-h-[190px] sm:min-h-[220px] flex-col items-center justify-center rounded-xl border border-line/60 bg-base/50 p-6 sm:p-8 text-center transition-all">
        {status === "finding" ? (
          <div className="flex flex-col items-center justify-center gap-3">
            <p
              key={`anim-${animWordIndex}`}
              className={`editorial-word text-3xl font-semibold tracking-tight text-white/45 sm:text-5xl ${
                reducedMotion ? "reel-fade" : ""
              }`}
              aria-live="polite"
            >
              {ANIMATION_WORDS[animWordIndex]}
            </p>
          </div>
        ) : topic ? (
          <div
            className={`topic-reveal flex flex-col items-center justify-center gap-3.5 ${
              reducedMotion ? "reel-fade" : ""
            }`}
          >
            {topic.category ? <CategoryChip category={topic.category} /> : null}
            <p
              className={`text-balance text-white max-w-xl ${topicTextClass(topic.text)}`}
            >
              {topic.text}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2">
            <p className="max-w-md text-base leading-relaxed text-muted/70 sm:text-lg">
              Your speaking topic will appear here.
            </p>
          </div>
        )}
      </div>

      {/* Primary topic generation action */}
      <div className="mt-6 flex items-center justify-center">
        <button
          type="button"
          onClick={generateTopic}
          disabled={disabled || isLoading}
          aria-busy={isLoading}
          className={`inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base active:scale-[0.98] ${
            topic
              ? "border border-line bg-base/60 px-5 py-2.5 text-xs sm:text-sm text-white/85 hover:border-white/30 hover:bg-base hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              : "bg-accent px-7 py-3 text-sm sm:text-base text-black hover:bg-accent/90 shadow-[0_0_24px_-8px_rgba(201,249,108,0.35)] disabled:cursor-not-allowed disabled:opacity-40"
          }`}
        >
          {isLoading ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-current animate-ping" />
              <span>Finding topic…</span>
            </>
          ) : topic ? (
            <span>Get another topic</span>
          ) : (
            <span>Get a topic</span>
          )}
        </button>
      </div>
    </div>
  );
}
