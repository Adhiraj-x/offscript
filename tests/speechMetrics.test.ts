import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzePauses,
  computeSpeechMetrics,
  countWords,
  coerceSpeechMetrics,
  LONG_PAUSE_THRESHOLD_SECONDS,
  NOTICEABLE_PAUSE_THRESHOLD_SECONDS,
  normalizeSpans,
} from "../lib/speechMetrics";

const wordsText = (count: number) => Array.from({ length: count }, (_, index) => `w${index}`).join(" ");

test("countWords handles empty and padded text", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   "), 0);
  assert.equal(countWords("  hello   world "), 2);
});

test("normalizeSpans drops unusable entries and sorts", () => {
  const spans = normalizeSpans([
    { start: 2, end: 3 },
    { start: 0, end: 1 },
    { start: "nope", end: 2 },
    { start: 1, end: 0.5 },
    { start: -1, end: 1 },
    null,
  ]);
  assert.deepEqual(spans, [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
  ]);
  assert.deepEqual(normalizeSpans(undefined), []);
  assert.deepEqual(normalizeSpans("segments"), []);
});

test("word timestamps separate noticeable pauses from long pauses", () => {
  const metrics = computeSpeechMetrics({
    transcript: wordsText(5),
    reportedDurationSeconds: 10,
    words: [
      { word: "w0", start: 0, end: 0.4 },
      { word: "w1", start: 0.5, end: 0.9 },
      { word: "w2", start: 1.0, end: 1.4 },
      { word: "w3", start: 2.1, end: 2.5 },
      { word: "w4", start: 4.2, end: 4.5 },
    ],
    segments: [],
  });

  assert.equal(metrics.durationSeconds, 10);
  assert.equal(metrics.durationBasis, "reported");
  assert.equal(metrics.timestampGranularity, "word");
  assert.equal(metrics.pausesAvailable, true);
  assert.equal(metrics.pausesLowPrecision, false);
  assert.equal(metrics.noticeablePauseThresholdSeconds, NOTICEABLE_PAUSE_THRESHOLD_SECONDS);
  assert.equal(metrics.longPauseThresholdSeconds, LONG_PAUSE_THRESHOLD_SECONDS);
  // A 0.7s gap is noticeable; a 1.7s gap is noticeable and long.
  assert.equal(metrics.noticeablePauseCount, 2);
  assert.equal(metrics.noticeablePauseTotalSeconds, 2.4);
  assert.equal(metrics.longPauseCount, 1);
  assert.equal(metrics.longPauseTotalSeconds, 1.7);
  assert.equal(metrics.longestPauseSeconds, 1.7);
  assert.equal(metrics.activeSpeechSeconds, 2.1);
  // Primary pace includes the pauses: 5 words in 10 seconds.
  assert.equal(metrics.speakingRateWpm, 30);
  assert.equal(metrics.wpm, 30);
  assert.equal(metrics.wpmBasis, "total-duration");
  assert.equal(metrics.articulationWpm, 142.9);
  assert.equal(metrics.pauseFrequencyPerMinute, 12);
  // Sprint 01 compatibility field mirrors the long-pause count.
  assert.equal(metrics.pauseCount, 1);
  assert.equal(metrics.pauseThresholdSeconds, LONG_PAUSE_THRESHOLD_SECONDS);
});

test("gaps under half a second are articulation, not pauses", () => {
  const metrics = computeSpeechMetrics({
    transcript: wordsText(3),
    reportedDurationSeconds: 4,
    words: [
      { start: 0, end: 1 },
      { start: 1.3, end: 2.3 },
      { start: 2.5, end: 3.5 },
    ],
  });

  assert.equal(metrics.noticeablePauseCount, 0);
  assert.equal(metrics.longPauseCount, 0);
  assert.equal(metrics.longestPauseSeconds, 0);
  assert.equal(metrics.activeSpeechSeconds, 3.5);
  assert.equal(metrics.pauseFrequencyPerMinute, 0);
});

test("segment-only timestamps are flagged as low precision", () => {
  const metrics = computeSpeechMetrics({
    transcript: wordsText(12),
    reportedDurationSeconds: 12,
    segments: [
      { start: 0, end: 5 },
      { start: 6, end: 12 },
    ],
  });

  assert.equal(metrics.timestampGranularity, "segment");
  assert.equal(metrics.pausesLowPrecision, true);
  assert.equal(metrics.noticeablePauseCount, 1);
  assert.equal(metrics.longPauseCount, 0);
  assert.equal(metrics.activeSpeechSeconds, 11);
  assert.equal(metrics.speakingRateWpm, 60);
  assert.equal(metrics.articulationWpm, 65.5);
  assert.equal(metrics.pauseFrequencyPerMinute, 5);
});

test("segment gaps above 1.5s count as long pauses", () => {
  const metrics = computeSpeechMetrics({
    transcript: wordsText(12),
    reportedDurationSeconds: 12,
    segments: [
      { start: 0, end: 5 },
      { start: 7, end: 12 },
    ],
  });

  assert.equal(metrics.noticeablePauseCount, 1);
  assert.equal(metrics.longPauseCount, 1);
  assert.equal(metrics.longestPauseSeconds, 2);
  assert.equal(metrics.longPauseTotalSeconds, 2);
  assert.equal(metrics.activeSpeechSeconds, 10);
  assert.equal(metrics.articulationWpm, 72);
});

test("overlapping spans merge instead of creating phantom pauses", () => {
  // (0,2) and (1,3) overlap, so they count as one 0-3 block; the 1.6s gap after it is a pause.
  const analysis = analyzePauses([
    { start: 0, end: 2 },
    { start: 1, end: 3 },
    { start: 4.6, end: 5.5 },
  ]);
  assert.notEqual(analysis, null);
  assert.equal(analysis?.noticeableCount, 1);
  assert.equal(analysis?.longCount, 1);
  assert.equal(analysis?.longestSeconds, 1.6);
  assert.equal(analysis?.speechSeconds, 3.9);
});

test("invalid timestamps are rejected instead of inventing pace", () => {
  const metrics = computeSpeechMetrics({
    transcript: wordsText(20),
    reportedDurationSeconds: 10,
    words: [{ start: 5, end: 1 }],
    segments: [{ start: "x", end: 4 }],
  });

  assert.equal(metrics.timestampGranularity, null);
  assert.equal(metrics.pausesAvailable, false);
  assert.equal(metrics.articulationWpm, null);
  assert.equal(metrics.activeSpeechSeconds, null);
  assert.equal(metrics.speakingRateWpm, 120);
  assert.equal(metrics.wpmBasis, "total-duration");
});

test("recording length falls back to the last timestamp", () => {
  const metrics = computeSpeechMetrics({
    transcript: wordsText(8),
    words: [
      { start: 0, end: 2 },
      { start: 4, end: 8 },
    ],
  });

  assert.equal(metrics.durationSeconds, 8);
  assert.equal(metrics.durationBasis, "timestamps");
  assert.equal(metrics.speakingRateWpm, 60);
  assert.equal(metrics.activeSpeechSeconds, 6);
  assert.equal(metrics.articulationWpm, 80);
  assert.equal(metrics.noticeablePauseCount, 1);
  assert.equal(metrics.longPauseCount, 1);
});

test("without timestamps, pause stats are unavailable and pace uses total duration", () => {
  const metrics = computeSpeechMetrics({
    transcript: wordsText(30),
    reportedDurationSeconds: 15,
    segments: [],
    words: [],
  });

  assert.equal(metrics.pausesAvailable, false);
  assert.equal(metrics.pausesLowPrecision, false);
  assert.equal(metrics.noticeablePauseCount, null);
  assert.equal(metrics.longPauseCount, null);
  assert.equal(metrics.longestPauseSeconds, null);
  assert.equal(metrics.pauseFrequencyPerMinute, null);
  assert.equal(metrics.activeSpeechSeconds, null);
  assert.equal(metrics.articulationWpm, null);
  assert.equal(metrics.timestampGranularity, null);
  assert.equal(metrics.wpmBasis, "total-duration");
  assert.equal(metrics.wpm, 120);
});

test("without timestamps or duration, pace is reported as unavailable", () => {
  const metrics = computeSpeechMetrics({ transcript: wordsText(10) });

  assert.equal(metrics.durationSeconds, null);
  assert.equal(metrics.durationBasis, "unavailable");
  assert.equal(metrics.pausesAvailable, false);
  assert.equal(metrics.wpmBasis, "unavailable");
  assert.equal(metrics.speakingRateWpm, null);
  assert.equal(metrics.articulationWpm, null);
  assert.equal(metrics.wpm, 0);
});

test("rates keep one decimal so the arithmetic reconciles", () => {
  const metrics = computeSpeechMetrics({
    transcript: wordsText(42),
    reportedDurationSeconds: 54,
    segments: [
      { start: 2, end: 20 },
      { start: 22.2, end: 53.8 },
    ],
  });

  // 42 / 54 * 60 = 46.7; 42 / 49.6 * 60 = 50.8.
  assert.equal(metrics.activeSpeechSeconds, 49.6);
  assert.equal(metrics.speakingRateWpm, 46.7);
  assert.equal(metrics.articulationWpm, 50.8);
  assert.equal(metrics.wpm, 46.7);
  assert.equal(coerceSpeechMetrics(metrics)?.speakingRateWpm, 46.7);
});

test("coerceSpeechMetrics round-trips a complete record", () => {
  const good = computeSpeechMetrics({
    transcript: wordsText(20),
    reportedDurationSeconds: 12,
    words: [
      { start: 0, end: 2 },
      { start: 4, end: 8 },
    ],
  });
  assert.deepEqual(coerceSpeechMetrics(good), good);
});

test("coerceSpeechMetrics rejects broken or contradictory records", () => {
  assert.equal(coerceSpeechMetrics(null), null);
  assert.equal(coerceSpeechMetrics({ wpm: "fast", wordCount: 10, wpmBasis: "active-speech" }), null);
  assert.equal(
    coerceSpeechMetrics({ wordCount: 10, wpm: 140, wpmBasis: "sideways", durationSeconds: 10 }),
    null,
  );
  const base = computeSpeechMetrics({
    transcript: wordsText(20),
    reportedDurationSeconds: 12,
    words: [
      { start: 0, end: 2 },
      { start: 4, end: 8 },
    ],
  });
  assert.equal(coerceSpeechMetrics({ ...base, noticeablePauseCount: "a few" }), null);
});

test("coerceSpeechMetrics upgrades a Sprint 01 record", () => {
  const metrics = coerceSpeechMetrics({
    wordCount: 120,
    durationSeconds: 58.4,
    activeSpeechSeconds: 47.1,
    wpm: 153,
    wpmBasis: "active-speech",
    timestampGranularity: "word",
    pausesAvailable: true,
    pauseCount: 2,
    longestPauseSeconds: 3.2,
    longPauseTotalSeconds: 5,
    pauseThresholdSeconds: 1.5,
  });

  assert.notEqual(metrics, null);
  assert.equal(metrics?.durationBasis, "reported");
  // The old figure was active-speech based, so it is the articulation rate, never the pace.
  assert.equal(metrics?.speakingRateWpm, null);
  assert.equal(metrics?.articulationWpm, 153);
  assert.equal(metrics?.noticeablePauseCount, 2);
  assert.equal(metrics?.longPauseCount, 2);
  assert.equal(metrics?.noticeablePauseTotalSeconds, 5);
  assert.equal(metrics?.pauseFrequencyPerMinute, 2.1);
  assert.equal(metrics?.pausesLowPrecision, false);
  assert.equal(metrics?.noticeablePauseThresholdSeconds, 0.5);
});

test("coerceSpeechMetrics tolerates a missing granularity and threshold", () => {
  const metrics = coerceSpeechMetrics({
    wordCount: 40,
    wpm: 130,
    wpmBasis: "total-duration",
    durationSeconds: 18.5,
    pausesAvailable: false,
    pauseCount: null,
    longestPauseSeconds: null,
    longPauseTotalSeconds: null,
  });

  assert.notEqual(metrics, null);
  assert.equal(metrics?.timestampGranularity, null);
  assert.equal(metrics?.pauseThresholdSeconds, LONG_PAUSE_THRESHOLD_SECONDS);
  assert.equal(metrics?.noticeablePauseThresholdSeconds, NOTICEABLE_PAUSE_THRESHOLD_SECONDS);
  assert.equal(metrics?.speakingRateWpm, 130);
  assert.equal(metrics?.longPauseCount, null);
});
