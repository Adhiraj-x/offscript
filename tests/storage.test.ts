import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { detectFillers } from "../lib/fillers";
import { computeSpeechMetrics } from "../lib/speechMetrics";
import { clearHistory, loadHistory, saveSession } from "../lib/storage";
import type { Session } from "../lib/types";

const HISTORY_KEY = "offscript_history_v1";
const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  };
  (globalThis as unknown as { window: unknown }).window = fakeWindow;
});

function legacySession(overrides: Partial<Session> = {}): Session {
  return {
    id: "legacy-1",
    date: "2026-01-02T10:00:00.000Z",
    topic: "A topic from before Scoring Engine 2.0",
    mode: "off-the-cuff",
    contentScore: 61,
    deliveryScore: 70,
    overallScore: 64,
    wpm: 132,
    fillerWordCount: 5,
    feedback: "Old feedback that predates the metric fields.",
    transcript: "An old transcript.",
    ...overrides,
  };
}

const wordsText = (count: number) =>
  Array.from({ length: count }, (_, index) => `w${index}`).join(" ");

test("legacy sessions without metrics still load", () => {
  store.set(HISTORY_KEY, JSON.stringify([legacySession()]));

  const history = loadHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].topic, "A topic from before Scoring Engine 2.0");
  assert.equal(history[0].overallScore, 64);
  assert.equal(history[0].metrics, undefined);
  assert.equal(history[0].fillers, undefined);
});

test("malformed metrics and fillers are dropped without losing the session", () => {
  const broken = {
    ...legacySession(),
    metrics: { wpm: "fast" },
    fillers: { total: 4 },
  } as unknown as Session;
  store.set(HISTORY_KEY, JSON.stringify([broken]));

  const history = loadHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].metrics, undefined);
  assert.equal(history[0].fillers, undefined);
});

test("current metrics survive a round trip", () => {
  const metrics = computeSpeechMetrics({
    transcript: wordsText(30),
    reportedDurationSeconds: 20,
    words: [
      { start: 0, end: 5 },
      { start: 8, end: 14 },
      { start: 15, end: 20 },
    ],
  });
  saveSession(legacySession({ metrics }));

  const history = loadHistory();
  assert.deepEqual(history[0].metrics, metrics);
  assert.equal(history[0].metrics?.noticeablePauseCount, 2);
  assert.equal(history[0].metrics?.longPauseCount, 1);
  assert.equal(history[0].metrics?.speakingRateWpm, 90);
});

test("one-decimal rates survive storage", () => {
  const metrics = computeSpeechMetrics({
    transcript: wordsText(42),
    reportedDurationSeconds: 54,
    segments: [
      { start: 2, end: 20 },
      { start: 22.2, end: 53.8 },
    ],
  });
  saveSession(legacySession({ wpm: metrics.wpm, metrics }));

  const history = loadHistory();
  assert.equal(history[0].metrics?.speakingRateWpm, 46.7);
  assert.equal(history[0].metrics?.articulationWpm, 50.8);
  assert.equal(history[0].wpm, 46.7);
});

test("filler breakdowns survive a round trip", () => {
  const fillers = detectFillers("Um, like, whatever. Uh.");
  saveSession(legacySession({ fillers }));

  const history = loadHistory();
  assert.deepEqual(history[0].fillers, fillers);
  assert.equal(history[0].fillers?.isEstimate, true);
});

test("Sprint 01 metrics are upgraded on load instead of discarded", () => {
  const sprintOne = {
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
  };
  store.set(HISTORY_KEY, JSON.stringify([{ ...legacySession(), metrics: sprintOne }]));

  const history = loadHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].metrics?.articulationWpm, 153);
  assert.equal(history[0].metrics?.speakingRateWpm, null);
  assert.equal(history[0].metrics?.noticeablePauseThresholdSeconds, 0.5);
  assert.equal(history[0].metrics?.longPauseCount, 2);
});

test("corrupt or unexpected storage returns an empty list", () => {
  store.set(HISTORY_KEY, "{not json");
  assert.deepEqual(loadHistory(), []);

  store.set(HISTORY_KEY, JSON.stringify({ sessions: [] }));
  assert.deepEqual(loadHistory(), []);
});

test("saveSession prepends, dedupes by id and sorts newest first", () => {
  saveSession(legacySession({ id: "a", date: "2026-01-01T10:00:00.000Z" }));
  saveSession(legacySession({ id: "b", date: "2026-01-03T10:00:00.000Z" }));
  saveSession(legacySession({ id: "a", date: "2026-01-01T10:00:00.000Z", overallScore: 88 }));

  const history = loadHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].id, "b");
  assert.equal(history[1].id, "a");
  assert.equal(history[1].overallScore, 88);
});

test("clearHistory empties the store", () => {
  saveSession(legacySession());
  clearHistory();
  assert.deepEqual(loadHistory(), []);
});
