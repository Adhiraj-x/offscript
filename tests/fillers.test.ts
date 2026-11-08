import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTEXTUAL_FILLERS,
  DEFINITE_FILLERS,
  coerceFillers,
  detectFillers,
  fillersPer100Words,
  summarizeFillers,
} from "../lib/fillers";
import { countWords } from "../lib/speechMetrics";

/**
 * Regression fixture from the real-world lantern recording. The reported inventory
 * was 13 fillers (er 3, like 3, uh 2, so 2, well 2, um 1). Two of those "like"s were
 * ordinary comparisons that Sprint 2.1 counted because of a comma, and "hmm" was
 * never detected at all.
 */
const LANTERN_TRANSCRIPT = [
  "A lantern is like, a portable light that you carry with you.",
  "Uh, it's like, this: you put a candle inside, er, or oil.",
  "Hmm, so, the glass keeps the flame safe from the wind.",
  "Umm, and it's, erm, easy to hold, er, with one hand.",
  "Well, I think a lantern is mostly about the handle.",
  "So, uh, it's a simple object with a light inside.",
  "Like, I don't know what else to say.",
  "Well, it's just a container for light.",
].join(" ");

test("counts definite disfluencies on sight", () => {
  const result = detectFillers("Um, I was, uh, thinking. Erm, er, ah.");
  assert.equal(result.definiteCount, 5);
  assert.equal(result.contextualCount, 0);
  assert.equal(result.total, 5);
  assert.equal(result.counts.um, 1);
  assert.equal(result.counts.uh, 1);
  assert.equal(result.counts.er, 2);
  assert.equal(result.counts.ah, 1);
  assert.equal(result.isEstimate, true);
});

test("normalises repeated spellings onto one key", () => {
  const result = detectFillers("Umm, um, uhh, uh, erm, er.");
  assert.equal(result.definiteCount, 6);
  assert.equal(result.counts.um, 2);
  assert.equal(result.counts.uh, 2);
  assert.equal(result.counts.er, 2);
  assert.equal(result.counts.erm, undefined);
});

test("detects hmm, hm and hmmm as one category", () => {
  const result = detectFillers("Hmm. Hmmm, hm.");
  assert.equal(result.total, 3);
  assert.equal(result.counts.hmm, 3);
});

test("hyphenated affirmations are words, not hesitations", () => {
  assert.equal(detectFillers("Uh-huh. Mm-hmm, that works.").total, 0);
});

test("ignores substrings of ordinary words", () => {
  assert.equal(detectFillers("over her error there").total, 0);
  assert.equal(detectFillers("The summer umbrella was under the table.").total, 0);
});

test("does not count contextual words used normally", () => {
  assert.equal(detectFillers("I like coffee and she likes tea.").total, 0);
  assert.equal(detectFillers("So I went home and basically slept.").total, 0);
  assert.equal(detectFillers("It actually works and it basically holds.").total, 0);
  assert.equal(detectFillers("Do you know the answer?").total, 0);
  assert.equal(detectFillers("It works well enough.").total, 0);
  assert.equal(detectFillers("It was so good that I clapped.").total, 0);
  assert.equal(detectFillers("That's exactly what I mean.").total, 0);
});

test("comparisons with 'like' are never counted, comma or not", () => {
  assert.equal(detectFillers("A lantern is like a portable light.").total, 0);
  assert.equal(detectFillers("It's like this.").total, 0);
  assert.equal(detectFillers("It's like, this.").total, 0);
  assert.equal(detectFillers("It looks like rain.").total, 0);
  assert.equal(detectFillers("It was like, really hard to explain.").total, 0);
});

test("a comparison stays uncounted even when it is next to a hesitation", () => {
  const result = detectFillers("It's like, um, this.");
  assert.equal(result.total, 1);
  assert.equal(result.counts.um, 1);
  assert.equal(result.counts.like, undefined);
});

test("counts 'like' when it is clearly a hesitation marker", () => {
  const utteranceStart = detectFillers("Like, I don't know what to say.");
  assert.equal(utteranceStart.counts.like, 1);
  assert.equal(utteranceStart.total, 1);

  const parenthetical = detectFillers("It was, like, really hard to explain.");
  assert.equal(parenthetical.counts.like, 1);
});

test("counts comma-marked discourse markers", () => {
  const result = detectFillers("So, I went home. Basically, it was fine. Actually, it was great.");
  assert.equal(result.contextualCount, 3);
  assert.equal(result.counts.so, 1);
  assert.equal(result.counts.basically, 1);
  assert.equal(result.counts.actually, 1);
});

test("counts 'look', 'well' and 'I mean' only as discourse markers", () => {
  assert.equal(detectFillers("Look, I think we should leave.").counts.look, 1);
  assert.equal(detectFillers("Look at that building.").total, 0);
  assert.equal(detectFillers("I look at the building.").total, 0);
  assert.equal(detectFillers("Look! A bird.").total, 0);

  assert.equal(detectFillers("Well, that depends.").counts.well, 1);
  assert.equal(detectFillers("It works well and I like it.").total, 0);

  assert.equal(detectFillers("I mean, that's the whole point.").counts["i mean"], 1);
  assert.equal(detectFillers("I mean that literally.").total, 0);
});

test("counts 'you know' only in tag position", () => {
  const tag = detectFillers("You know, that's the whole point.");
  assert.equal(tag.counts["you know"], 1);
  assert.equal(tag.total, 1);

  assert.equal(detectFillers("That's the whole point, you know.").counts["you know"], 1);
  assert.equal(detectFillers("You know what I mean?").total, 0);
  assert.equal(detectFillers("You know the answer already.").total, 0);
});

test("counts 'so' with an aside but not as a conjunction or intensifier", () => {
  assert.equal(detectFillers("So, the answer is the second one.").counts.so, 1);
  assert.equal(detectFillers("So the answer is the second one.").total, 0);
  assert.equal(detectFillers("It was so much better.").total, 0);
  assert.equal(detectFillers("So that we could leave early.").total, 0);
});

test("counts contextual words next to a definite filler", () => {
  const result = detectFillers("I was um like really tired");
  assert.equal(result.definiteCount, 1);
  assert.equal(result.contextualCount, 1);
  assert.equal(result.total, 2);
});

test("missing punctuation is not invented, but hesitations need none", () => {
  // No evidence to justify counting: left alone rather than guessed at.
  assert.equal(detectFillers("well I think we should leave").total, 0);
  assert.equal(detectFillers("so it was a lantern really").total, 0);

  assert.equal(detectFillers("uh I was thinking").counts.uh, 1);
  assert.equal(detectFillers("Hmm I see").counts.hmm, 1);
});

test("timestamp gaps can support a contextual marker", () => {
  const text = "the answer so we should go";
  const wordTimings = [
    { word: "the", start: 0, end: 0.3 },
    { word: "answer", start: 0.3, end: 0.7 },
    { word: "so", start: 1.1, end: 1.3 },
    { word: "we", start: 1.3, end: 1.5 },
    { word: "should", start: 1.5, end: 1.8 },
    { word: "go", start: 1.8, end: 2.0 },
  ];

  assert.equal(detectFillers(text).total, 0);
  assert.equal(detectFillers(text, { wordTimings }).counts.so, 1);
});

test("timestamps never override literal grammar", () => {
  const text = "a lantern is like a portable light";
  const wordTimings = [
    { word: "a", start: 0, end: 0.2 },
    { word: "lantern", start: 0.2, end: 0.7 },
    { word: "is", start: 1.3, end: 1.5 },
    { word: "like", start: 1.5, end: 1.8 },
    { word: "a", start: 1.8, end: 1.9 },
    { word: "portable", start: 1.9, end: 2.4 },
    { word: "light", start: 2.4, end: 2.8 },
  ];
  assert.equal(detectFillers(text, { wordTimings }).total, 0);
});

test("misaligned or malformed timings are ignored instead of misapplied", () => {
  const text = "the answer so we should go";
  assert.equal(detectFillers(text, { wordTimings: [] }).total, 0);
  assert.equal(detectFillers(text, { wordTimings: [{ word: "the", start: 0, end: 1 }] }).total, 0);
  assert.equal(detectFillers(text, { wordTimings: "nope" }).total, 0);
  assert.equal(
    detectFillers(text, { wordTimings: [{ word: "the", start: 0, end: 0 }] }).total,
    0,
  );
});

test("counts repeated hesitations once each and records the run", () => {
  const repeated = detectFillers("Uh uh, um um, umm uh.");
  assert.equal(repeated.definiteCount, 6);
  assert.equal(repeated.total, 6);
  assert.equal(repeated.repeatedRunCount, 1);

  const separated = detectFillers("Uh uh. Later, um um.");
  assert.equal(separated.definiteCount, 4);
  assert.equal(separated.repeatedRunCount, 2);
});

test("consecutive fillers across categories are not double-counted", () => {
  const result = detectFillers("You know, I mean, like, um.");
  assert.equal(result.total, 4);
  assert.equal(result.definiteCount, 1);
  assert.equal(result.contextualCount, 3);
  assert.equal(result.counts["you know"], 1);
  assert.equal(result.counts["i mean"], 1);
  assert.equal(result.counts.like, 1);
  assert.equal(result.counts.um, 1);
  const counted = Object.values(result.counts).reduce((sum, count) => sum + count, 0);
  assert.equal(counted, result.total);
});

test("ordinary repeated words are not fillers", () => {
  assert.equal(detectFillers("I had had enough of the the noise.").total, 0);
});

test("total is always definite plus contextual", () => {
  const result = detectFillers("Um, like, whatever. So, you know, it happens.");
  assert.equal(result.total, result.definiteCount + result.contextualCount);
  const counted = Object.values(result.counts).reduce((sum, count) => sum + count, 0);
  assert.equal(counted, result.total);
});

test("categories are mutually exclusive", () => {
  const overlap = DEFINITE_FILLERS.filter((term) =>
    (CONTEXTUAL_FILLERS as readonly string[]).includes(term),
  );
  assert.deepEqual(overlap, []);

  const canonical = new Set<string>([...DEFINITE_FILLERS, ...CONTEXTUAL_FILLERS]);
  const result = detectFillers(
    "Um, uh, er, ah, hmm. Like, so, well, look. Actually, basically, I mean, you know,",
  );
  for (const term of Object.keys(result.counts)) {
    assert.equal(canonical.has(term), true, `unexpected category: ${term}`);
  }
});

test("reports filler rate per 100 words", () => {
  const result = detectFillers("um word word word word", { wordCount: 5 });
  assert.equal(result.total, 1);
  assert.equal(result.per100Words, 20);

  assert.equal(detectFillers("word word word").per100Words, 0);
  assert.equal(fillersPer100Words(2, 0), null);
  assert.equal(fillersPer100Words(3, 60), 5);
});

test("handles empty text", () => {
  const result = detectFillers("");
  assert.equal(result.total, 0);
  assert.equal(result.per100Words, null);
  assert.deepEqual(result.counts, {});
  assert.equal(summarizeFillers(result), "none detected");
});

test("summarises counts by frequency", () => {
  const summary = summarizeFillers(detectFillers("um um um uh like,"));
  assert.equal(summary, "um 3, uh 1, like 1");
});

test("the lantern transcript drops the false 'like' positives and finds hmm", () => {
  assert.equal(countWords(LANTERN_TRANSCRIPT), 81);
  const result = detectFillers(LANTERN_TRANSCRIPT);

  // Before the context rules this transcript produced 13 detections.
  assert.equal(fillersPer100Words(13, 81), 16);

  assert.equal(result.total, 12);
  assert.equal(result.definiteCount, 7);
  assert.equal(result.contextualCount, 5);
  assert.equal(result.per100Words, 14.8);
  assert.equal(result.repeatedRunCount, 0);
  assert.deepEqual(result.counts, {
    uh: 2,
    er: 3,
    hmm: 1,
    um: 1,
    so: 2,
    well: 2,
    like: 1,
  });

  const counted = Object.values(result.counts).reduce((sum, count) => sum + count, 0);
  assert.equal(counted, result.total);
});

test("the lantern comparisons are specifically not counted", () => {
  assert.equal(detectFillers("A lantern is like, a portable light.").total, 0);
  assert.equal(detectFillers("It's like, this.").total, 0);
  assert.equal(detectFillers("Look at that building.").total, 0);
  assert.equal(detectFillers("You know the answer.").total, 0);

  assert.equal(detectFillers("Uh, er, hmm, umm.").definiteCount, 4);
  assert.equal(detectFillers("Well, I think so, look,").contextualCount, 3);
});

test("coerceFillers round-trips a stored breakdown", () => {
  const detected = detectFillers("Um, like, whatever.");
  assert.deepEqual(coerceFillers(detected), detected);

  assert.equal(coerceFillers(null), null);
  assert.equal(coerceFillers({ total: 3, definiteCount: 1, contextualCount: 1 }), null);
  assert.equal(coerceFillers({ total: 1, definiteCount: "one", contextualCount: 0 }), null);
});

test("coerceFillers rejects a breakdown that does not add up", () => {
  assert.equal(
    coerceFillers({
      total: 3,
      definiteCount: 2,
      contextualCount: 1,
      repeatedRunCount: 0,
      per100Words: 3,
      counts: { um: 1 },
    }),
    null,
  );

  assert.equal(
    coerceFillers({
      total: 2,
      definiteCount: 2,
      contextualCount: 0,
      repeatedRunCount: 0,
      per100Words: 2,
      counts: { um: 2 },
    })?.total,
    2,
  );
});

test("coerceFillers still loads a session stored before normalisation", () => {
  const legacy = coerceFillers({
    total: 2,
    definiteCount: 2,
    contextualCount: 0,
    repeatedRunCount: 0,
    per100Words: 4,
    counts: { erm: 2 },
  });
  assert.notEqual(legacy, null);
  assert.equal(legacy?.counts.erm, 2);
  assert.equal(legacy?.isEstimate, true);
});
