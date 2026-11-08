import assert from "node:assert/strict";
import test from "node:test";
import { detectFillers } from "../lib/fillers";
import {
  buildScoringUserPrompt,
  checkPaceLabelConsistency,
  classifyPace,
  computeOverallScore,
  normalizeRating,
} from "../lib/scoring";
import { computeSpeechMetrics, type SpeechMetrics } from "../lib/speechMetrics";

/**
 * Regression fixture built from the real take that exposed the 2.0 problem:
 * 42 words, 54s recording, 49.6s active speech, one 1.6s pause found, no fillers
 * in the transcript — and an 82/100 delivery score.
 *
 * Arithmetic: 42 / 54 * 60 = 46.7 WPM speaking rate; 42 / 49.6 * 60 = 50.8 WPM
 * articulation rate. The 4.4s of the recording that is not active speech is the
 * 2.3s of measured noticeable pauses plus roughly 2.1s of edge silence.
 *
 * These are the measured values from that take rather than a timestamp
 * reconstruction, so the fixture stays stable if the pause algorithm changes.
 */
const REAL_TAKE_TRANSCRIPT =
  "We need to think about how public transport works in smaller cities. Buses are cheap but unreliable and people wait a long time. Walking is often faster than waiting for a bus that never comes. That is the whole problem here today.";

const realTakeMetrics: SpeechMetrics = {
  wordCount: 42,
  durationSeconds: 54,
  durationBasis: "reported",
  activeSpeechSeconds: 49.6,
  wpm: 46.7,
  wpmBasis: "total-duration",
  speakingRateWpm: 46.7,
  articulationWpm: 50.8,
  timestampGranularity: "word",
  pausesAvailable: true,
  pausesLowPrecision: false,
  noticeablePauseThresholdSeconds: 0.5,
  longPauseThresholdSeconds: 1.5,
  noticeablePauseCount: 2,
  noticeablePauseTotalSeconds: 2.3,
  longPauseCount: 1,
  longPauseTotalSeconds: 1.6,
  longestPauseSeconds: 1.6,
  pauseFrequencyPerMinute: 2.2,
  pauseCount: 1,
  pauseThresholdSeconds: 1.5,
};

const strongButSlowAnswer = {
  contentScore: 80,
  deliveryScore: 45,
  overallScore: 90,
  feedback:
    "You built a clear argument around unreliable buses and supported it with the walking comparison, but the pace at 46.7 WPM was very slow and the long pause in the middle split the reasoning.",
  strengths: ["Clear central claim", "Concrete walking-versus-waiting comparison"],
  improvements: ["Lift the pace towards a conversational rate", "Keep the closing sentence tight"],
};

const buildPrompt = (metrics: SpeechMetrics = realTakeMetrics, transcript = REAL_TAKE_TRANSCRIPT) => {
  const fillers = detectFillers(transcript, { wordCount: metrics.wordCount });
  return buildScoringUserPrompt({
    topic: "Should cities make public transport free?",
    mode: "off-the-cuff",
    transcript,
    metrics,
    fillers,
  });
};

test("the fixture is 42 words with no detected fillers", () => {
  const fillers = detectFillers(REAL_TAKE_TRANSCRIPT, { wordCount: realTakeMetrics.wordCount });
  assert.equal(realTakeMetrics.wordCount, 42);
  assert.equal(REAL_TAKE_TRANSCRIPT.trim().split(/\s+/).length, 42);
  assert.equal(fillers.total, 0);
  assert.equal(fillers.per100Words, 0);
});

test("the fixture rates match the documented arithmetic exactly", () => {
  // 42 / 54 * 60 and 42 / 49.6 * 60, to one decimal.
  assert.equal(Number((((42 / 54) * 60).toFixed(1))), 46.7);
  assert.equal(Number((((42 / 49.6) * 60).toFixed(1))), 50.8);

  assert.equal(realTakeMetrics.speakingRateWpm, 46.7);
  assert.equal(realTakeMetrics.articulationWpm, 50.8);
  assert.equal(realTakeMetrics.wpm, 46.7);
  assert.equal(realTakeMetrics.wpmBasis, "total-duration");
});

test("computeSpeechMetrics reproduces 46.7 and 50.8 from the raw timings", () => {
  const metrics = computeSpeechMetrics({
    transcript: REAL_TAKE_TRANSCRIPT,
    reportedDurationSeconds: 54,
    segments: [
      { start: 2, end: 20 },
      { start: 22.2, end: 53.8 },
    ],
  });

  assert.equal(metrics.speakingRateWpm, 46.7);
  assert.equal(metrics.articulationWpm, 50.8);
  assert.equal(metrics.wpm, 46.7);
  // The reconstructed segment gap is 2.2s: one noticeable pause, which is also long.
  assert.equal(metrics.noticeablePauseCount, 1);
  assert.equal(metrics.longPauseCount, 1);
});

test("the pace label comes from the speaking rate, not the articulation rate", () => {
  assert.equal(classifyPace(realTakeMetrics.speakingRateWpm)?.id, "very-slow");
  assert.equal(classifyPace(realTakeMetrics.speakingRateWpm)?.label, "Very slow");

  const prompt = buildPrompt();
  assert.match(prompt, /Speaking rate: 46\.7 WPM across the whole recording/);
  assert.match(prompt, /Pace classification: Very slow\./);
  assert.match(prompt, /Articulation rate: 50\.8 WPM/);
  assert.match(prompt, /Do not treat this as the overall pace/);
});

test("the prompt hands the model every measurement as evidence, with no precomputed score", () => {
  const prompt = buildPrompt();

  assert.match(prompt, /Recording length: 54s/);
  assert.match(prompt, /Estimated speaking time: 49\.6s/);
  assert.match(prompt, /Pauses of 0\.5s or longer: 2/);
  assert.match(prompt, /1 of 1\.5s or longer/);
  assert.match(prompt, /longest 1\.6s/);
  assert.match(prompt, /2\.2 per minute/);
  assert.match(prompt, /Filler estimate: 0 detected \(none detected\)/);
  assert.match(prompt, /Transcript-supported repetition: 0 adjacent repeated word pairs/);
  assert.match(prompt, /evidence rather than as a formula/);
  assert.match(prompt, /Do not claim the speaker used no fillers/);

  // The deterministic delivery formula must not survive in the prompt.
  assert.doesNotMatch(prompt, /Delivery score: \d+ of 100/);
  assert.doesNotMatch(prompt, /Effective weights/);
  assert.doesNotMatch(prompt, /Delivery sub-scores/);
  assert.doesNotMatch(prompt, /do not change/);
});

test("a low AI delivery score is accepted and drives the overall score", () => {
  const result = normalizeRating(strongButSlowAnswer, {
    paceBand: classifyPace(realTakeMetrics.speakingRateWpm),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.deliveryScore, 45);
  // round(0.6 * 80 + 0.4 * 45) = round(66) = 66
  assert.equal(result.value.overallScore, 66);
  assert.equal(result.value.overallScore, computeOverallScore(80, 45));
});

test("the metrics do not decide delivery: two replies over the same evidence both stand", () => {
  const harsh = normalizeRating(strongButSlowAnswer);
  const generous = normalizeRating({ ...strongButSlowAnswer, deliveryScore: 74 });
  assert.equal(harsh.ok, true);
  assert.equal(generous.ok, true);
  if (!harsh.ok || !generous.ok) return;

  assert.equal(harsh.value.deliveryScore, 45);
  assert.equal(generous.value.deliveryScore, 74);
  assert.notEqual(harsh.value.overallScore, generous.value.overallScore);
});

test("strong content and weak delivery coexist without being averaged into one verdict", () => {
  const result = normalizeRating(strongButSlowAnswer);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.contentScore, 80);
  assert.equal(result.value.deliveryScore, 45);
  assert.ok(result.value.contentScore > result.value.deliveryScore);
});

test("missing timestamps are stated as missing, not invented", () => {
  const metrics = computeSpeechMetrics({
    transcript: REAL_TAKE_TRANSCRIPT,
    reportedDurationSeconds: null,
  });
  const fillers = detectFillers(REAL_TAKE_TRANSCRIPT, { wordCount: metrics.wordCount });
  const prompt = buildScoringUserPrompt({
    topic: "Should cities make public transport free?",
    mode: "off-the-cuff",
    transcript: REAL_TAKE_TRANSCRIPT,
    metrics,
    fillers,
  });

  assert.equal(metrics.speakingRateWpm, null);
  assert.equal(metrics.pausesAvailable, false);
  assert.match(prompt, /Speaking rate: not measurable/);
  assert.match(prompt, /Pauses: not measured \(no usable timestamps\)/);
  assert.match(prompt, /Pace classification: none\./);
  assert.match(prompt, /Do not describe the pacing and do not name a pace band/);
  assert.match(prompt, /Do not comment on pauses/);
});

test("the 79 WPM take is called Slow everywhere, never very slow", () => {
  // The reported inconsistency: the UI showed "79 WPM - Slow" while the feedback
  // described the same take as "very slow". 42 words in 31.9s rounds to 79.0 WPM.
  const metrics = computeSpeechMetrics({
    transcript: REAL_TAKE_TRANSCRIPT,
    reportedDurationSeconds: 31.9,
  });
  assert.equal(metrics.speakingRateWpm, 79);

  const fillers = detectFillers(REAL_TAKE_TRANSCRIPT, { wordCount: metrics.wordCount });
  const prompt = buildScoringUserPrompt({
    topic: "Should cities make public transport free?",
    mode: "off-the-cuff",
    transcript: REAL_TAKE_TRANSCRIPT,
    metrics,
    fillers,
  });
  const band = classifyPace(metrics.speakingRateWpm);

  assert.equal(band?.label, "Slow");
  assert.match(prompt, /Speaking rate: 79 WPM/);
  assert.match(prompt, /Pace classification: Slow\./);
  assert.match(prompt, /never substitute another pace label/);
  assert.doesNotMatch(prompt, /Pace classification: Very slow/);

  // And the guard the route applies rejects the exact sentence from the report.
  assert.equal(checkPaceLabelConsistency("The pace was very slow.", band).ok, false);
  assert.equal(checkPaceLabelConsistency("The pace was slow.", band).ok, true);
});
