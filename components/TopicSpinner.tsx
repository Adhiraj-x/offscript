"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CategoryChip from "./CategoryChip";
import { pickTopic, randomReelTopic, topicTextClass, type Topic } from "@/lib/topics";
import { availableTopics, consumeTopic, fetchTopicFromApi } from "@/lib/topicPool";
import {
  getRecentForExclusion,
  saveRecentTopic,
  selectBalancedCategory,
} from "@/lib/recentTopics";

const SWAP_START_MS = 60;
const SWAP_GROWTH = 1.15;
const SPIN_DURATION_MS = 1600;
const LAND_EFFECT_MS = 900;
const MAX_SPIN_TIMEOUT_MS = 4000;

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

  const spin = useCallback(async () => {
    if (disabled || spinningRef.current) return;

    const candidates = availableTopics();
    const recent = getRecentForExclusion(20);
    const balancedCategory = selectBalancedCategory(recent);

    // Prepare reliable static fallback in case of network timeout
    const avoidTexts = recent.map((r) => r.text);
    let staticCandidate = pickTopic(candidates, avoidTexts);
    for (let attempt = 0; attempt < 6 && topic && staticCandidate.text === topic.text; attempt += 1) {
      staticCandidate = pickTopic(candidates, avoidTexts);
    }

    setLanded(false);
    const isReduced = reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (isReduced) {
      spinningRef.current = true;
      setSpinning(true);
      onSpinStateChange?.(true);

      let finalTopic: Topic;
      try {
        finalTopic = await fetchTopicFromApi({ category: balancedCategory, avoid: recent });
      } catch {
        finalTopic = staticCandidate;
      }

      saveRecentTopic({
        text: finalTopic.text,
        category: finalTopic.category,
        domain: finalTopic.domain,
      });
      consumeTopic(finalTopic.text);

      setReel(finalTopic);
      setSwapKey((key) => key + 1);
      setSpinning(false);
      setLanded(true);
      spinningRef.current = false;
      onSpinStateChange?.(false);
      onPick(finalTopic);
      landTimeoutRef.current = window.setTimeout(() => setLanded(false), 300);
      return;
    }

    spinningRef.current = true;
    setSpinning(true);
    onSpinStateChange?.(true);
    setReel(randomReelTopic(candidates));
    setSwapKey((key) => key + 1);

    let chosenTopic: Topic | null = null;
    let fetchFinished = false;

    // Fetch from API in background while reel spins
    fetchTopicFromApi({ category: balancedCategory, avoid: recent })
      .then((res) => {
        chosenTopic = res;
      })
      .catch(() => {
        chosenTopic = staticCandidate;
      })
      .finally(() => {
        fetchFinished = true;
      });

    let delay = SWAP_START_MS;
    let elapsed = 0;

    const swap = () => {
      swapTimeoutRef.current = window.setTimeout(() => {
        elapsed += delay;

        // If elapsed is under target duration OR API response is still in-flight (up to max timeout)
        const canFinish = (elapsed >= SPIN_DURATION_MS && fetchFinished) || elapsed >= MAX_SPIN_TIMEOUT_MS;

        if (!canFinish) {
          setReel(randomReelTopic(candidates));
          setSwapKey((key) => key + 1);
          delay = Math.min(delay * SWAP_GROWTH, 280);
          swap();
          return;
        }

        const winner = chosenTopic ?? staticCandidate;

        saveRecentTopic({
          text: winner.text,
          category: winner.category,
          domain: winner.domain,
        });
        consumeTopic(winner.text);

        setReel(winner);
        setSwapKey((key) => key + 1);
        setSpinning(false);
        setLanded(true);
        spinningRef.current = false;
        onSpinStateChange?.(false);
        onPick(winner);
        landTimeoutRef.current = window.setTimeout(() => setLanded(false), LAND_EFFECT_MS);
      }, delay);
    };

    swap();
  }, [disabled, onPick, onSpinStateChange, reducedMotion, topic]);

  const shown = reel ?? topic;

  return (
    <div
      className={`rounded-2xl border border-line bg-panel p-6 sm:p-10 transition-shadow duration-500 flex flex-col items-center justify-center text-center ${
        landed ? "topic-glow" : ""
      }`}
    >
      {/* 1. Category Chip (centred, acting as inner heading) & 2. Actual Topic (large, centred) */}
      <div className="flex min-h-[140px] sm:min-h-[170px] w-full flex-col items-center justify-center gap-3.5 sm:gap-4">
        {shown ? (
          <>
            <div className="flex justify-center">
              <CategoryChip category={shown.category} />
            </div>
            <p
              key={`${shown.text}-${swapKey}`}
              aria-live={spinning ? "off" : "polite"}
              className={`text-balance text-white max-w-xl ${topicTextClass(shown.text)} ${
                spinning ? "reel-item" : reducedMotion ? "reel-fade" : landed ? "reel-land" : ""
              }`}
            >
              {shown.text}
            </p>
          </>
        ) : (
          <p
            className="max-w-xs text-sm sm:text-base leading-relaxed text-[#8e949d]"
            style={{ color: "#8e949d" }}
          >
            Your speaking topic will appear here.
          </p>
        )}
      </div>

      {/* 3. Topic-generation button (centred directly underneath the topic) */}
      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={spin}
          disabled={disabled || spinning}
          aria-busy={spinning}
          className="flex items-center gap-2 rounded-full border border-line bg-base/50 px-5 py-2.5 text-xs sm:text-sm font-medium text-white/85 transition-all hover:border-white/30 hover:bg-base hover:text-white disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <svg
            className={`h-3.5 w-3.5 ${spinning ? "spin-icon text-accent" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M20 12a8 8 0 1 1-2.34-5.66" strokeLinecap="round" />
            <path d="M20 4v4h-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            {spinning ? "Choosing..." : topic ? "Get another topic" : "Get a topic"}
          </span>
        </button>
      </div>
    </div>
  );
}
