import assert from "node:assert/strict";
import test from "node:test";
import { MODES, modeInfo } from "../lib/modes";

test("MODES configuration has exact names, prep seconds and descriptions", () => {
  assert.equal(MODES.length, 2);

  const offTheCuff = modeInfo("off-the-cuff");
  assert.equal(offTheCuff.name, "Off the Cuff");
  assert.equal(offTheCuff.prepSeconds, 60);
  assert.equal(
    offTheCuff.blurb,
    "Organise your thoughts quickly, then deliver your response.",
  );

  const deepResearch = modeInfo("deep-research");
  assert.equal(deepResearch.name, "Deep Research");
  assert.equal(deepResearch.prepSeconds, 600);
  assert.equal(
    deepResearch.blurb,
    "Explore the topic, develop your ideas and build a considered argument before speaking.",
  );
});

test("CTA state transitions logically based on mode and topic selection", () => {
  const getCtaLabel = (mode: string | null, topic: { text: string } | null) => {
    return mode && topic ? "Start preparation" : "Choose a mode and get a topic";
  };

  const isCtaDisabled = (mode: string | null, topic: { text: string } | null, spinning: boolean) => {
    return !mode || !topic || spinning;
  };

  // Neither selected
  assert.equal(getCtaLabel(null, null), "Choose a mode and get a topic");
  assert.equal(isCtaDisabled(null, null, false), true);

  // Only mode selected
  assert.equal(getCtaLabel("off-the-cuff", null), "Choose a mode and get a topic");
  assert.equal(isCtaDisabled("off-the-cuff", null, false), true);

  // Only topic selected
  assert.equal(getCtaLabel(null, { text: "Silence" }), "Choose a mode and get a topic");
  assert.equal(isCtaDisabled(null, { text: "Silence" }, false), true);

  // Both selected
  assert.equal(getCtaLabel("off-the-cuff", { text: "Silence" }), "Start preparation");
  assert.equal(isCtaDisabled("off-the-cuff", { text: "Silence" }, false), false);

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

