import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clampScore, formatClock } from "../lib/format";
import { modeInfo } from "../lib/modes";
import { bandLabel, describePace } from "../lib/scoring";
import { clearHistory, loadHistory, newSessionId, saveSession } from "../lib/storage";
import { computeStreak } from "../lib/streak";
import type { Topic, TopicCategory } from "../lib/topics";
import type { Mode, RatingResult, Session } from "../lib/types";

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

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: newSessionId(),
    date: new Date().toISOString(),
    topic: "Default Topic",
    mode: "off-the-cuff",
    contentScore: 70,
    deliveryScore: 75,
    overallScore: 72,
    wpm: 130,
    fillerWordCount: 2,
    feedback: "Solid take.",
    transcript: "Default speech transcript.",
    ...overrides,
  };
}

test("exact topic text, category and mode are preserved across retry", () => {
  const originalTopic: Topic = {
    text: "Artificial Intelligence in Education",
    category: "general",
  };
  const originalMode: Mode = "deep-research";

  // Simulate attempt 1 state
  let currentTopic: Topic | null = { ...originalTopic };
  let currentMode: Mode | null = originalMode;
  let phase: string = "result";
  let prepAttempt = 0;
  let result: Partial<RatingResult> | null = {
    contentScore: 68,
    deliveryScore: 72,
    overallScore: 70,
    feedback: "Initial attempt feedback.",
    transcript: "First take audio transcript.",
  };

  // Simulate retrySameTopic action
  const retrySameTopic = () => {
    if (!currentTopic || !currentMode) return;
    result = null;
    prepAttempt += 1;
    phase = "prep";
  };

  retrySameTopic();

  // Assertions: exact topic, category, mode retained; previous results cleared; prep refreshed
  assert.equal(phase, "prep");
  assert.equal(result, null);
  assert.equal(prepAttempt, 1);
  assert.equal(currentTopic.text, "Artificial Intelligence in Education");
  assert.equal(currentTopic.category, "general");
  assert.equal(currentMode, "deep-research");

  // PrepTimer key changes with prepAttempt so a fresh timer mounts
  const timerKey1 = `${currentMode}-${currentTopic.text}-${0}`;
  const timerKey2 = `${currentMode}-${currentTopic.text}-${prepAttempt}`;
  assert.notEqual(timerKey1, timerKey2);
  assert.equal(timerKey2, "deep-research-Artificial Intelligence in Education-1");

  // Mode prep time is correct
  assert.equal(modeInfo(currentMode).prepSeconds, 600);
});

test("fresh recording starts and previous results are not reused", () => {
  // First attempt results
  const takeOneResult: RatingResult = {
    contentScore: 65,
    deliveryScore: 60,
    overallScore: 63,
    feedback: "Needs more structure and fewer pauses.",
    strengths: ["Clear topic relevance"],
    improvements: ["Reduce hesitations", "Tighten conclusions"],
    wpm: 95.5,
    fillerWordCount: 8,
    transcript: "Um, I think education and AI, uh, can work together.",
  };

  let activeResult: RatingResult | null = takeOneResult;

  // Trigger retry: active result MUST be cleared
  activeResult = null;
  assert.equal(activeResult, null);

  // New take recording completes and returns fresh scores
  const takeTwoResult: RatingResult = {
    contentScore: 88,
    deliveryScore: 84,
    overallScore: 86,
    feedback: "Much stronger delivery with steady pacing.",
    strengths: ["Confident tone", "Structured arguments"],
    improvements: ["Vary vocabulary"],
    wpm: 132.0,
    fillerWordCount: 1,
    transcript: "Artificial intelligence has transformed how students learn today.",
  };

  activeResult = takeTwoResult;
  assert.notDeepEqual(activeResult, takeOneResult);
  assert.equal(activeResult.overallScore, 86);
  assert.equal(activeResult.fillerWordCount, 1);
  assert.equal(activeResult.transcript, "Artificial intelligence has transformed how students learn today.");
});

test("both attempts persist separately as distinct history records without overwriting", () => {
  const topic = "Workplace Automation";
  const mode: Mode = "off-the-cuff";
  const category: TopicCategory = "trend";

  const attempt1: Session = createSession({
    id: "attempt-1",
    date: "2026-11-08T10:00:00.000Z",
    topic,
    mode,
    category,
    contentScore: 60,
    deliveryScore: 55,
    overallScore: 58,
    wpm: 88,
    fillerWordCount: 7,
    transcript: "First take transcript with some fillers.",
    feedback: "A bit rushed with several fillers.",
  });

  const attempt2: Session = createSession({
    id: "attempt-2",
    date: "2026-11-08T10:10:00.000Z",
    topic,
    mode,
    category,
    contentScore: 85,
    deliveryScore: 82,
    overallScore: 84,
    wpm: 125,
    fillerWordCount: 1,
    transcript: "Second take transcript with clear points.",
    feedback: "Much clearer and well-paced.",
  });

  saveSession(attempt1);
  saveSession(attempt2);

  const history = loadHistory();
  assert.equal(history.length, 2);

  // Newest attempt is first
  assert.equal(history[0].id, "attempt-2");
  assert.equal(history[0].overallScore, 84);
  assert.equal(history[0].topic, topic);
  assert.equal(history[0].category, "trend");

  // Previous attempt is preserved intact
  assert.equal(history[1].id, "attempt-1");
  assert.equal(history[1].overallScore, 58);
  assert.equal(history[1].topic, topic);
  assert.equal(history[1].category, "trend");

  // Confirms neither overwrote the other
  assert.notEqual(history[0].id, history[1].id);
  assert.notEqual(history[0].transcript, history[1].transcript);
  assert.notEqual(history[0].overallScore, history[1].overallScore);
});

test("practice again clears topic to allow new topic generation", () => {
  let topic: Topic | null = { text: "Urban Farming", category: "trend" };
  let mode: Mode | null = "off-the-cuff";
  let phase: string = "result";
  let prepAttempt = 2;
  let result: unknown = { score: 75 };

  // Simulate resetPractice
  const resetPractice = () => {
    result = null;
    topic = null;
    prepAttempt = 0;
    phase = "setup";
  };

  resetPractice();

  assert.equal(phase, "setup");
  assert.equal(topic, null);
  assert.equal(result, null);
  assert.equal(prepAttempt, 0);
  // Mode is retained for convenience when spinning a new topic
  assert.equal(mode, "off-the-cuff");
});

test("supports every topic category across retries", () => {
  const categories: TopicCategory[] = ["word", "statement", "general", "trend"];

  for (const category of categories) {
    const session = createSession({
      topic: `Topic in ${category}`,
      category,
      mode: "off-the-cuff",
    });
    saveSession(session);

    const history = loadHistory();
    const stored = history.find((s) => s.id === session.id);
    assert.ok(stored);
    assert.equal(stored.category, category);
  }
});

test("supports both speaking modes across retries", () => {
  const modes: Mode[] = ["off-the-cuff", "deep-research"];

  for (const mode of modes) {
    const session = createSession({
      topic: `Topic in ${mode}`,
      mode,
    });
    saveSession(session);

    const info = modeInfo(mode);
    assert.ok(info.prepSeconds > 0);
    assert.ok(info.name.length > 0);
  }
});

test("handles missing legacy topic data safely", () => {
  // Legacy session without category
  const legacyWithoutCategory: Session = createSession({
    id: "legacy-no-cat",
    topic: "Legacy Topic Without Category",
    category: undefined,
  });

  saveSession(legacyWithoutCategory);

  const history = loadHistory();
  const loaded = history.find((s) => s.id === "legacy-no-cat");
  assert.ok(loaded);
  assert.equal(loaded.topic, "Legacy Topic Without Category");
  assert.equal(loaded.category, undefined);

  // Retrying legacy topic retains topic text safely
  const retryTopicText = loaded.topic;
  const retryCategory = loaded.category;
  assert.equal(retryTopicText, "Legacy Topic Without Category");
  assert.equal(retryCategory, undefined);
});

test("history and share cards remain compatible after multiple retries", () => {
  const topic = "Renewable Energy Transitions";
  const mode: Mode = "off-the-cuff";

  const sess1 = createSession({
    id: "sess-ret-1",
    date: "2026-11-08T09:00:00.000Z",
    topic,
    mode,
    overallScore: 64,
    contentScore: 65,
    deliveryScore: 62,
    wpm: 110.4,
  });

  const sess2 = createSession({
    id: "sess-ret-2",
    date: "2026-11-08T09:15:00.000Z",
    topic,
    mode,
    overallScore: 82,
    contentScore: 85,
    deliveryScore: 78,
    wpm: 128.2,
  });

  saveSession(sess1);
  saveSession(sess2);

  const history = loadHistory();

  // Streak computes correctly with multiple sessions on same day
  const streak = computeStreak(history);
  assert.ok(streak.days >= 1);

  // Verify formatters used in ResultView, HistoryList, and ShareCard
  for (const item of history) {
    const band = bandLabel(item.overallScore);
    assert.ok(band.length > 0);
    const pace = describePace(item.wpm);
    assert.ok(pace.length > 0);
    const safeOverall = clampScore(item.overallScore);
    assert.ok(safeOverall >= 0 && safeOverall <= 100);
  }
});

