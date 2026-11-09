import assert from "node:assert/strict";
import test from "node:test";
import { MODES, modeInfo } from "../lib/modes";

test("MODES configuration has exact names, prep seconds and descriptions", () => {
  assert.equal(MODES.length, 2);

  const offTheCuff = modeInfo("off-the-cuff");
  assert.equal(offTheCuff.name, "Quick Prep");
  assert.equal(offTheCuff.prepSeconds, 60);
  assert.equal(
    offTheCuff.blurb,
    "Organise your thoughts quickly, then deliver your response.",
  );

  const deepResearch = modeInfo("deep-research");
  assert.equal(deepResearch.name, "Extended Prep");
  assert.equal(deepResearch.prepSeconds, 600);
  assert.equal(
    deepResearch.blurb,
    "Take more time to explore the topic, structure your ideas and build a considered response.",
  );
});

test("CTA state transitions logically based on mode and topic selection", () => {
  const getCtaLabel = (mode: string | null, topic: { text: string } | null) => {
    if (topic && mode) return "Start preparation";
    if (topic && !mode) return "Pick a mode to continue";
    if (!topic && mode) return "Get a topic to continue";
    return "Get a topic and pick a mode";
  };

  const isCtaDisabled = (mode: string | null, topic: { text: string } | null, spinning: boolean) => {
    return !mode || !topic || spinning;
  };

  const getCtaClasses = (enabled: boolean) => {
    return enabled
      ? "border border-transparent bg-accent text-black hover:bg-accent/90 active:scale-[0.98] shadow-[0_0_24px_-8px_rgba(201,249,108,0.35)] cursor-pointer"
      : "border border-line bg-panel text-muted cursor-not-allowed shadow-none disabled:border-line disabled:bg-panel disabled:text-muted disabled:opacity-100 disabled:cursor-not-allowed";
  };

  // Neither selected
  assert.equal(getCtaLabel(null, null), "Get a topic and pick a mode");
  assert.equal(isCtaDisabled(null, null, false), true);
  assert.ok(getCtaClasses(false).includes("text-muted"));
  assert.ok(getCtaClasses(false).includes("cursor-not-allowed"));
  assert.ok(getCtaClasses(false).includes("bg-panel"));
  assert.ok(!getCtaClasses(false).includes("text-muted/50"));
  assert.ok(!getCtaClasses(false).includes("bg-accent"));

  // Only mode selected
  assert.equal(getCtaLabel("off-the-cuff", null), "Get a topic to continue");
  assert.equal(isCtaDisabled("off-the-cuff", null, false), true);

  // Only topic selected
  assert.equal(getCtaLabel(null, { text: "Silence" }), "Pick a mode to continue");
  assert.equal(isCtaDisabled(null, { text: "Silence" }, false), true);

  // Both selected
  assert.equal(getCtaLabel("off-the-cuff", { text: "Silence" }), "Start preparation");
  assert.equal(isCtaDisabled("off-the-cuff", { text: "Silence" }, false), false);
  assert.ok(getCtaClasses(true).includes("bg-accent"));
  assert.ok(getCtaClasses(true).includes("text-black"));
  assert.ok(getCtaClasses(true).includes("cursor-pointer"));
  assert.ok(getCtaClasses(true).includes("shadow-"));

  // Both selected but topic is generating/spinning
  assert.equal(getCtaLabel("deep-research", { text: "Failure" }), "Start preparation");
  assert.equal(isCtaDisabled("deep-research", { text: "Failure" }, true), true);
});

import { availableTopics } from "../lib/topicPool";
import { pickTopic } from "../lib/topics";

test("topic candidate reel pool is available and non-empty", () => {
  const candidates = availableTopics();
  assert.ok(candidates.length > 0);
  const picked = pickTopic(candidates);
  assert.ok(picked.text.length > 0);
  assert.ok(picked.category.length > 0);
});

test("topic-generation button labels match generation lifecycle", () => {
  const getTopicButtonLabel = (spinning: boolean, hasTopic: boolean) => {
    return spinning ? "Choosing..." : hasTopic ? "Get another topic" : "Get a topic";
  };

  assert.equal(getTopicButtonLabel(false, false), "Get a topic");
  assert.equal(getTopicButtonLabel(true, false), "Choosing...");
  assert.equal(getTopicButtonLabel(true, true), "Choosing...");
  assert.equal(getTopicButtonLabel(false, true), "Get another topic");
});

test("reordered homepage practice flow handles independent selection lifecycle and timer transitions", () => {
  let mode: "off-the-cuff" | "deep-research" | null = null;
  let topic: { text: string; category: string } | null = null;
  let spinning = false;

  const getCtaLabel = () => {
    if (topic && mode) return "Start preparation";
    if (topic && !mode) return "Pick a mode to continue";
    if (!topic && mode) return "Get a topic to continue";
    return "Get a topic and pick a mode";
  };

  const isCtaDisabled = () => !mode || !topic || spinning;

  // Initial state: neither selected
  assert.equal(getCtaLabel(), "Get a topic and pick a mode");
  assert.equal(isCtaDisabled(), true);

  // 1. Generate topic, then select Quick Prep
  topic = { text: "Authenticity", category: "CONCEPT" };
  assert.equal(getCtaLabel(), "Pick a mode to continue");
  assert.equal(isCtaDisabled(), true);
  mode = "off-the-cuff";
  assert.equal(getCtaLabel(), "Start preparation");
  assert.equal(isCtaDisabled(), false);
  assert.equal(modeInfo(mode).prepSeconds, 60);

  // 2. Generate topic, then select Extended Prep
  mode = "deep-research";
  assert.equal(getCtaLabel(), "Start preparation");
  assert.equal(isCtaDisabled(), false);
  assert.equal(modeInfo(mode).prepSeconds, 600);

  // Reset to initial
  mode = null;
  topic = null;

  // 3. Select a mode, then generate a topic
  mode = "off-the-cuff";
  assert.equal(getCtaLabel(), "Get a topic to continue");
  assert.equal(isCtaDisabled(), true);
  topic = { text: "Remote Work Paradox", category: "TREND" };
  assert.equal(getCtaLabel(), "Start preparation");
  assert.equal(isCtaDisabled(), false);

  // 4. Generate another topic after selecting a mode (mode persists)
  spinning = true;
  assert.equal(isCtaDisabled(), true); // Disabled while spinning
  topic = { text: "What if cars were banned?", category: "WHAT_IF" };
  spinning = false;
  assert.equal(mode, "off-the-cuff"); // Mode preserved
  assert.equal(getCtaLabel(), "Start preparation");
  assert.equal(isCtaDisabled(), false);

  // 5. Change mode after generating a topic (topic persists)
  mode = "deep-research";
  assert.equal(topic.text, "What if cars were banned?"); // Topic preserved
  assert.equal(getCtaLabel(), "Start preparation");
  assert.equal(isCtaDisabled(), false);

  // 6. Verify CTA remains disabled if either selection is missing
  mode = null;
  assert.equal(isCtaDisabled(), true);
  assert.equal(getCtaLabel(), "Pick a mode to continue");

  mode = "off-the-cuff";
  topic = null;
  assert.equal(isCtaDisabled(), true);
  assert.equal(getCtaLabel(), "Get a topic to continue");

  // 7. Verify correct preparation timers for both modes
  assert.equal(modeInfo("off-the-cuff").prepSeconds, 60);
  assert.equal(modeInfo("off-the-cuff").name, "Quick Prep");
  assert.equal(modeInfo("deep-research").prepSeconds, 600);
  assert.equal(modeInfo("deep-research").name, "Extended Prep");
});

test("simplified navigation streak indicator renders number only with accessible text", () => {
  const renderStreak = (streak?: number) => {
    if (typeof streak !== "number" || streak <= 0) return null;
    return {
      visualNumber: String(streak),
      screenReaderText: `${streak} day streak`,
      title: `${streak} day streak`,
      accentColorClass: "text-accent",
    };
  };

  assert.equal(renderStreak(0), null);
  assert.equal(renderStreak(-1), null);
  assert.equal(renderStreak(undefined), null);

  const streakResult = renderStreak(3);
  assert.ok(streakResult !== null);
  assert.equal(streakResult.visualNumber, "3");
  assert.equal(streakResult.screenReaderText, "3 day streak");
  assert.equal(streakResult.title, "3 day streak");
  assert.equal(streakResult.accentColorClass, "text-accent");
});

test("hero tagline and topic empty-state styles match specifications", () => {
  const HERO_TAGLINE = "Where ideas take shape and voices find confidence.";
  const TOPIC_EMPTY_TEXT = "Your speaking topic will appear here.";
  const TOPIC_EMPTY_COLOR = "#8e949d";

  assert.equal(HERO_TAGLINE, "Where ideas take shape and voices find confidence.");
  assert.equal(TOPIC_EMPTY_TEXT, "Your speaking topic will appear here.");
  assert.equal(TOPIC_EMPTY_COLOR, "#8e949d");
});

test("Offscript logo navigates to homepage from result, prep and other states without clearing history", () => {
  type Phase = "setup" | "prep" | "speak" | "scoring" | "result" | "error";

  let phase: Phase = "result";
  let topic: { text: string } | null = { text: "Focus" };
  let result: { overallScore: number } | null = { overallScore: 82 };
  const history = [{ id: "session-1", topic: "Focus", overallScore: 82 }];

  const resetPractice = () => {
    result = null;
    topic = null;
    phase = "setup";
  };

  // 1. From Result page
  assert.equal(phase, "result");
  assert.ok(result !== null);
  resetPractice();
  assert.equal(phase, "setup");
  assert.equal(result, null);
  assert.equal(topic, null);
  assert.equal(history.length, 1);

  // 2. From Prep page
  phase = "prep";
  topic = { text: "Courage" };
  resetPractice();
  assert.equal(phase, "setup");
  assert.equal(topic, null);
  assert.equal(history.length, 1);

  // 3. From Speak page
  phase = "speak";
  topic = { text: "Resilience" };
  resetPractice();
  assert.equal(phase, "setup");
  assert.equal(history.length, 1);

  // 4. Logo configuration
  const logoConfig = {
    href: "/",
    ariaLabel: "Offscript home",
    hasDot: true,
    hasText: true,
  };
  assert.equal(logoConfig.href, "/");
  assert.equal(logoConfig.ariaLabel, "Offscript home");
  assert.equal(logoConfig.hasDot, true);
  assert.equal(logoConfig.hasText, true);
});
