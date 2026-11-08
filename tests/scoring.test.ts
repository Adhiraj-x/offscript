import assert from "node:assert/strict";
import test from "node:test";
import { detectFillers } from "../lib/fillers";
import {
  bandLabel,
  buildScoringUserPrompt,
  checkPaceLabelConsistency,
  classifyPace,
  computeOverallScore,
  countAdjacentRepetitions,
  feedbackRequirements,
  normalizeRating,
  scoreBand,
  SCORING_SYSTEM_PROMPT,
  SCORING_WEIGHTS,
} from "../lib/scoring";
import { computeSpeechMetrics } from "../lib/speechMetrics";

const feedback =
  "You opened with a clear claim and kept it in view through the whole answer, though the pace stayed slow.";

const goodReply = {
  contentScore: 75,
  deliveryScore: 65,
  overallScore: 12,
  feedback,
  strengths: ["Clear opening claim", "Concrete example about the sprint"],
  improvements: ["Cut the recap at the end", "Tighten the closing sentence"],
};

/** Alphabetic tokens, because the repetition counter ignores digits. */
function wordToken(index: number): string {
  let value = index;
  let label = "";
  do {
    label = String.fromCharCode(97 + (value % 26)) + label;
    value = Math.floor(value / 26);
  } while (value > 0);
  return `w${label}`;
}

const words = (count: number) =>
  Array.from({ length: count }, (_, index) => wordToken(index)).join(" ");

test("overall score uses the documented 60/40 formula", () => {
  assert.deepEqual(SCORING_WEIGHTS, { content: 0.6, delivery: 0.4 });
  assert.equal(computeOverallScore(80, 60), 72);
  assert.equal(computeOverallScore(75, 65), 71);
  assert.equal(computeOverallScore(100, 0), 60);
  assert.equal(computeOverallScore(0, 100), 40);
});

test("overall score clamps out-of-range inputs", () => {
  // -50 clamps to 0 and 140 clamps to 100, so the weighted result is 40.
  assert.equal(computeOverallScore(-50, 140), 40);
  assert.equal(computeOverallScore(Number.NaN, 100), 40);
});

test("bands cover every score from 0 to 100", () => {
  assert.equal(bandLabel(0), "Very weak");
  assert.equal(bandLabel(39), "Very weak");
  assert.equal(bandLabel(40), "Needs improvement");
  assert.equal(bandLabel(59), "Needs improvement");
  assert.equal(bandLabel(60), "Competent");
  assert.equal(bandLabel(74), "Competent");
  assert.equal(bandLabel(75), "Strong");
  assert.equal(bandLabel(89), "Strong");
  assert.equal(bandLabel(90), "Excellent");
  assert.equal(bandLabel(100), "Excellent");
  assert.equal(bandLabel(150), "Excellent");
  assert.equal(scoreBand(-5).label, "Very weak");
});

test("pace classification follows the product calibration bands", () => {
  assert.equal(classifyPace(51)?.id, "very-slow");
  assert.equal(classifyPace(69)?.label, "Very slow");
  assert.equal(classifyPace(70)?.label, "Slow");
  assert.equal(classifyPace(89)?.label, "Slow");
  assert.equal(classifyPace(90)?.label, "Somewhat slow");
  assert.equal(classifyPace(109)?.label, "Somewhat slow");
  assert.equal(classifyPace(110)?.label, "Comfortable");
  assert.equal(classifyPace(160)?.label, "Comfortable");
  assert.equal(classifyPace(161)?.label, "Somewhat fast");
  assert.equal(classifyPace(180)?.label, "Somewhat fast");
  assert.equal(classifyPace(181)?.label, "Very fast");
  assert.equal(classifyPace(0), null);
  assert.equal(classifyPace(null), null);
});

test("pace boundaries classify at the documented edges", () => {
  const cases: Array<[number, string]> = [
    [69.9, "very-slow"],
    [70, "slow"],
    [89.9, "slow"],
    [90, "somewhat-slow"],
    [109.9, "somewhat-slow"],
    [110, "comfortable"],
    [160, "comfortable"],
    [160.1, "somewhat-fast"],
    [180, "somewhat-fast"],
    [180.1, "very-fast"],
  ];

  for (const [wpm, id] of cases) {
    assert.equal(classifyPace(wpm)?.id, id, `${wpm} WPM should classify as ${id}`);
  }
});

test("repetition counting ignores hesitations", () => {
  assert.equal(countAdjacentRepetitions("the the cat sat on the mat"), 1);
  assert.equal(countAdjacentRepetitions("I I said said it"), 2);
  assert.equal(countAdjacentRepetitions("um um uh uh"), 0);
});

test("the AI's delivery score is used, not a deterministic calculation", () => {
  const result = normalizeRating({ ...goodReply, contentScore: 70, deliveryScore: 42 });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.deliveryScore, 42);
  assert.equal(result.value.contentScore, 70);
  // round(0.6 * 70 + 0.4 * 42) = round(58.8) = 59
  assert.equal(result.value.overallScore, 59);
});

test("the model's overall score is ignored in favour of the 60/40 formula", () => {
  const result = normalizeRating({ ...goodReply, contentScore: 82, deliveryScore: 51, overallScore: 99 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.overallScore, 70);
});

test("the AI is allowed to award a genuinely low delivery score", () => {
  const result = normalizeRating({
    ...goodReply,
    contentScore: 68,
    deliveryScore: 41,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.deliveryScore, 41);
  assert.equal(result.value.overallScore, 57);
});

test("strong content and weak delivery can coexist", () => {
  const result = normalizeRating({ ...goodReply, contentScore: 88, deliveryScore: 44 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.value.contentScore > 85);
  assert.ok(result.value.deliveryScore < 50);
  // round(0.6 * 88 + 0.4 * 44) = round(70.4) = 70
  assert.equal(result.value.overallScore, 70);
});

test("weak content and strong delivery can coexist", () => {
  const result = normalizeRating({ ...goodReply, contentScore: 35, deliveryScore: 92 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.contentScore, 35);
  assert.equal(result.value.deliveryScore, 92);
  assert.equal(result.value.overallScore, 58);
});

test("scores outside 0-100 are clamped deterministically", () => {
  const result = normalizeRating({
    ...goodReply,
    contentScore: 140,
    deliveryScore: -20,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.contentScore, 100);
  assert.equal(result.value.deliveryScore, 0);
  assert.equal(result.value.overallScore, 60);
});

test("numeric strings are accepted", () => {
  const result = normalizeRating({ ...goodReply, contentScore: "72", deliveryScore: "68" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.contentScore, 72);
  assert.equal(result.value.deliveryScore, 68);
  assert.equal(result.value.overallScore, 70);
});

test("invalid replies are rejected instead of defaulting to 60", () => {
  const invalidReplies: unknown[] = [
    null,
    "not json",
    [],
    {},
    { ...goodReply, contentScore: undefined },
    { ...goodReply, deliveryScore: undefined },
    { ...goodReply, deliveryScore: "abc" },
    { ...goodReply, feedback: "Too short." },
    { ...goodReply, strengths: ["Only one"] },
    { ...goodReply, improvements: [] },
    { ...goodReply, improvements: [1, 2] },
  ];

  for (const reply of invalidReplies) {
    const result = normalizeRating(reply);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(reply)}`);
  }
});

test("missing scores never produce a silent default", () => {
  const result = normalizeRating({
    feedback,
    strengths: goodReply.strengths,
    improvements: goodReply.improvements,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /contentScore/);
});

test("a missing delivery score is reported by name", () => {
  const result = normalizeRating({
    contentScore: 70,
    feedback,
    strengths: goodReply.strengths,
    improvements: goodReply.improvements,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "delivery-score");
});

test("strengths and improvements are capped at three", () => {
  const result = normalizeRating({
    ...goodReply,
    strengths: ["a", "b", "c", "d"],
    improvements: ["1", "2", "3", "4"],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.strengths.length, 3);
  assert.equal(result.value.improvements.length, 3);
});

test("79 WPM is Slow, and prose that calls it very slow is rejected", () => {
  const band = classifyPace(79);
  assert.ok(band);
  if (!band) return;
  assert.equal(band.label, "Slow");

  assert.deepEqual(
    checkPaceLabelConsistency("Your pace was slow enough to follow throughout.", band),
    { ok: true },
  );

  const mismatch = checkPaceLabelConsistency("Your pace was very slow for this answer.", band);
  assert.equal(mismatch.ok, false);
  if (mismatch.ok) return;
  assert.equal(mismatch.code, "pace-label");
  assert.match(mismatch.reason, /very slow/);
  assert.match(mismatch.reason, /Slow/);
});

test("negated pace labels are not treated as contradictions", () => {
  const comfortable = classifyPace(120);
  assert.ok(comfortable);
  if (!comfortable) return;

  for (const feedbackText of [
    "You were not slow, and the pace held throughout this answer.",
    "You were anything but slow in this answer.",
    "It was comfortable, not somewhat fast.",
  ]) {
    assert.deepEqual(checkPaceLabelConsistency(feedbackText, comfortable), { ok: true });
  }

  assert.equal(checkPaceLabelConsistency("That answer was somewhat fast.", comfortable).ok, false);
  assert.deepEqual(checkPaceLabelConsistency("No pace was measured.", null), { ok: true });
});

test("normalizeRating rejects a reply whose pace label contradicts the measurement", () => {
  const band = classifyPace(79);
  assert.ok(band);
  if (!band) return;

  const rejected = normalizeRating(
    { ...goodReply, feedback: "Your pace was very slow, which cost you here." },
    { paceBand: band },
  );
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.code, "pace-label");

  const accepted = normalizeRating(
    { ...goodReply, feedback: "Your pace was slow, which cost you here." },
    { paceBand: band },
  );
  assert.equal(accepted.ok, true);
});

test("the system prompt makes the model the judge and the metrics evidence", () => {
  assert.match(SCORING_SYSTEM_PROMPT, /You award both scores/);
  assert.match(SCORING_SYSTEM_PROMPT, /evidence, not a formula/);
  assert.match(SCORING_SYSTEM_PROMPT, /40-50/);
  assert.match(SCORING_SYSTEM_PROMPT, /Zero detected fillers must not by itself mean good delivery/);
  assert.match(SCORING_SYSTEM_PROMPT, /Frequent pauses that break the flow should lower the score/);
  assert.match(SCORING_SYSTEM_PROMPT, /Never claim or imply that you assessed vocal confidence/);
  assert.match(SCORING_SYSTEM_PROMPT, /server recomputes it/);
});

test("the user prompt supplies slow pace, pauses and fillers as evidence", () => {
  const transcript = `um um like, ${words(40)}`;
  const metrics = computeSpeechMetrics({
    transcript,
    reportedDurationSeconds: 60,
    segments: [
      { start: 0, end: 28 },
      { start: 30, end: 58 },
    ],
  });
  const fillers = detectFillers(transcript, { wordCount: metrics.wordCount });
  const prompt = buildScoringUserPrompt({
    topic: "Should cities make public transport free?",
    mode: "off-the-cuff",
    transcript,
    metrics,
    fillers,
  });

  assert.equal(metrics.speakingRateWpm, 43);
  assert.equal(fillers.total, 3);
  assert.match(prompt, /Speaking rate: 43 WPM/);
  assert.match(prompt, /Pace classification: Very slow\./);
  assert.match(prompt, /Pauses of 0\.5s or longer: 1/);
  assert.match(prompt, /Filler estimate: 3 detected \(um 2, like 1\)/);
  assert.match(prompt, /7 per 100 transcribed words/);
  assert.match(prompt, /Text heuristic; Whisper often drops audible fillers/);
  assert.match(prompt, /evidence rather than as a formula/);
  assert.doesNotMatch(prompt, /Effective weights/);
  assert.doesNotMatch(prompt, /Delivery score: \d+ of 100/);
  assert.doesNotMatch(prompt, /do not change/);
});

test("missing timestamps are identified instead of invented", () => {
  const transcript = words(60);
  const metrics = computeSpeechMetrics({ transcript, reportedDurationSeconds: 30 });
  const fillers = detectFillers(transcript, { wordCount: metrics.wordCount });
  const prompt = buildScoringUserPrompt({
    topic: "An open topic",
    mode: "off-the-cuff",
    transcript,
    metrics,
    fillers,
  });

  assert.equal(metrics.pausesAvailable, false);
  assert.match(prompt, /Speaking rate: 120 WPM/);
  assert.match(prompt, /Articulation rate: not measurable/);
  assert.match(prompt, /Pauses: not measured \(no usable timestamps\)/);
  assert.match(prompt, /Pace classification: Comfortable\./);
});

test("a missing pace measurement is not given a band", () => {
  const transcript = words(40);
  const metrics = computeSpeechMetrics({ transcript });
  const fillers = detectFillers(transcript, { wordCount: metrics.wordCount });
  const prompt = buildScoringUserPrompt({
    topic: "An open topic",
    mode: "off-the-cuff",
    transcript,
    metrics,
    fillers,
  });

  assert.equal(metrics.speakingRateWpm, null);
  assert.match(prompt, /Speaking rate: not measurable/);
  assert.match(prompt, /Pace classification: none\./);
  assert.match(prompt, /Do not describe the pacing and do not name a pace band/);
});

test("a clean transcript does not become a fabricated filler measurement", () => {
  const transcript = words(50);
  const metrics = computeSpeechMetrics({ transcript, reportedDurationSeconds: 30 });
  const fillers = detectFillers(transcript, { wordCount: metrics.wordCount });
  const prompt = buildScoringUserPrompt({
    topic: "An open topic",
    mode: "off-the-cuff",
    transcript,
    metrics,
    fillers,
  });

  assert.equal(fillers.total, 0);
  assert.match(prompt, /Filler estimate: 0 detected \(none detected\), 0 per 100 transcribed words/);
  assert.doesNotMatch(prompt, /NaN|undefined/);
});

test("normalizeRating accepts mainTakeaway and nextAttemptFocus when provided", () => {
  const input = {
    contentScore: 82,
    deliveryScore: 78,
    feedback: "You structured your response well and supported it with good examples.",
    strengths: ["Clear structure", "Relevant examples"],
    improvements: ["Reduce filler words", "Vary sentence pacing"],
    mainTakeaway: "Strong structure with clear arguments; tighten your pace on transitions.",
    nextAttemptFocus: "Pause for one second instead of saying 'like' when changing topics.",
  };

  const result = normalizeRating(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.mainTakeaway, input.mainTakeaway);
  assert.equal(result.value.nextAttemptFocus, input.nextAttemptFocus);
});

test("normalizeRating gracefully tolerates omitted mainTakeaway and nextAttemptFocus", () => {
  const result = normalizeRating(goodReply);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.mainTakeaway, undefined);
  assert.equal(result.value.nextAttemptFocus, undefined);
});

test("feedbackRequirements cites the exact longest pause and forbids confusing 1.5s threshold", () => {
  const metrics = computeSpeechMetrics({
    transcript: words(40),
    reportedDurationSeconds: 60,
    segments: [
      { start: 0, end: 20 },
      { start: 29, end: 50 }, // 9-second pause
    ],
  });
  const fillers = detectFillers(words(40), { wordCount: 40 });
  const band = classifyPace(metrics.speakingRateWpm);
  const reqs = feedbackRequirements(metrics, fillers, band);

  const pauseReq = reqs.find((r) => r.includes("Pauses of 0.5s or longer were measured"));
  assert.ok(pauseReq, "Pause requirement should be present");
  assert.match(pauseReq, /longest single pause was 9s/i);
  assert.match(pauseReq, /NEVER confuse the 1\.5s threshold with the pause duration/i);
});

test("SCORING_SYSTEM_PROMPT includes mainTakeaway, nextAttemptFocus, and pause accuracy instructions", () => {
  assert.match(SCORING_SYSTEM_PROMPT, /"mainTakeaway": string/);
  assert.match(SCORING_SYSTEM_PROMPT, /"nextAttemptFocus": string/);
  assert.match(SCORING_SYSTEM_PROMPT, /NEVER confuse the 1\.5s threshold/);
});
