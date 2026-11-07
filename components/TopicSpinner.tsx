"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CategoryChip from "./CategoryChip";
import { pickTopic, randomReelTopic, topicTextClass, type Topic } from "@/lib/topics";
import { availableTopics, consumeTopic } from "@/lib/topicPool";

const SWAP_START_MS = 60;
const SWAP_GROWTH = 1.15;
const SPIN_DURATION_MS = 1600;
const LAND_EFFECT_MS = 900;

type Props = {
  topic: Topic | null;
  onPick: (topic: Topic) => void;
  disabled?: boolean;
  onSpinStateChange?: (spinning: boolean) => void;
};

export default function TopicSpinner({ topic, onPick, disabled, onSpinStateChange }: Props) {
  const [reel, setReel] = useState<Topic | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState(false);
  const [swapKey, setSwapKey] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  const swapTimeoutRef = useRef<number | null>(null);
  const landTimeoutRef = useRef<number | null>(null);
  const spinningRef = useRef(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    return () => {
      if (swapTimeoutRef.current !== null) window.clearTimeout(swapTimeoutRef.current);
      if (landTimeoutRef.current !== null) window.clearTimeout(landTimeoutRef.current);
    };
  }, []);

  // Starting a new practice elsewhere clears the settled reel.
  useEffect(() => {
    if (!topic) setReel(null);
  }, [topic]);

  const spin = useCallback(() => {
    if (disabled || spinningRef.current) return;

    const candidates = availableTopics();
    // The winner is chosen up front; a guard keeps it off the previous topic.
    let chosen = pickTopic(candidates);
    for (let attempt = 0; attempt < 6 && topic && chosen.text === topic.text; attempt += 1) {
      chosen = pickTopic(candidates);
    }

    setLanded(false);
    const reduced = reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      consumeTopic(chosen.text);
      setReel(chosen);
      setSwapKey((key) => key + 1);
      setLanded(true);
      onPick(chosen);
      landTimeoutRef.current = window.setTimeout(() => setLanded(false), 300);
      return;
    }

    spinningRef.current = true;
    setSpinning(true);
    onSpinStateChange?.(true);
    setReel(randomReelTopic(candidates));
    setSwapKey((key) => key + 1);

    let delay = SWAP_START_MS;
    let elapsed = 0;

    const swap = () => {
      swapTimeoutRef.current = window.setTimeout(() => {
        elapsed += delay;

        if (elapsed < SPIN_DURATION_MS) {
          setReel(randomReelTopic(candidates));
          setSwapKey((key) => key + 1);
          delay *= SWAP_GROWTH;
          swap();
          return;
        }

        consumeTopic(chosen.text);
        setReel(chosen);
        setSwapKey((key) => key + 1);
        setSpinning(false);
        setLanded(true);
        spinningRef.current = false;
        onSpinStateChange?.(false);
        onPick(chosen);
        landTimeoutRef.current = window.setTimeout(() => setLanded(false), LAND_EFFECT_MS);
      }, delay);
    };

    swap();
  }, [disabled, onPick, onSpinStateChange, reducedMotion, topic]);

  const shown = reel ?? topic;

  return (
    <div
      className={`rounded-2xl border border-line bg-panel p-6 transition-shadow duration-500 sm:p-8 ${
        landed ? "topic-glow" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Your topic</p>
        <button
          type="button"
          onClick={spin}
          disabled={disabled || spinning}
          aria-busy={spinning}
          className="flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-xs text-white/80 transition-colors hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg
            className={`h-3 w-3 ${spinning ? "spin-icon text-accent" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M20 12a8 8 0 1 1-2.34-5.66" strokeLinecap="round" />
            <path d="M20 4v4h-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {spinning ? "Spinning…" : topic ? "Spin again" : "Spin a topic"}
        </button>
      </div>

      {/* Fixed height + centered content: mixed topic lengths never reflow the page. */}
      <div className="mt-5 flex h-44 flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-line/70 bg-base/40 px-5 text-center">
        {shown ? (
          <>
            <CategoryChip category={shown.category} />
            <p
              key={`${shown.text}-${swapKey}`}
              aria-live={spinning ? "off" : "polite"}
              className={`text-balance text-white ${topicTextClass(shown.text)} ${
                spinning ? "reel-item" : reducedMotion ? "reel-fade" : landed ? "reel-land" : ""
              }`}
            >
              {shown.text}
            </p>
          </>
        ) : (
          <p className="max-w-xs text-base leading-relaxed text-muted/60">
            Spin to get a prompt worth arguing about.
          </p>
        )}
      </div>
    </div>
  );
}
