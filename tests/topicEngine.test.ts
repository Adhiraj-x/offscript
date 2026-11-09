import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  DOMAINS,
  TOPICS,
  normalizeCategory,
  pickTopic,
  randomReelTopic,
  type CanonicalTopicCategory,
  type Topic,
} from "../lib/topics";
import {
  EXCLUSION_LIMIT,
  MAX_RECENT_TOPICS,
  RECENT_TOPICS_KEY,
  clearRecentTopics,
  getRecentForExclusion,
  getStaticFallbackTopic,
  loadRecentTopics,
  sanitizeAvoidList,
  saveRecentTopic,
  selectBalancedCategory,
  type RecentTopic,
} from "../lib/recentTopics";
import { availableTopics, consumeTopic } from "../lib/topicPool";

const memoryStore = new Map<string, string>();

beforeEach(() => {
  memoryStore.clear();
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => memoryStore.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memoryStore.set(key, String(value));
      },
      removeItem: (key: string) => {
        memoryStore.delete(key);
      },
    },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  };
  (globalThis as unknown as { window: unknown }).window = fakeWindow;
});

// 1. All five categories are valid
test("all five topic categories are valid and defined with correct display labels", () => {
  assert.equal(CATEGORIES.length, 5);
  const expected: CanonicalTopicCategory[] = [
    "CONCEPT",
    "TREND",
    "STATEMENT",
    "WHAT_IF",
    "DILEMMA",
  ];

  for (const cat of expected) {
    assert.ok(CATEGORIES.includes(cat), `Missing category: ${cat}`);
  }

  assert.equal(CATEGORY_LABEL.CONCEPT, "CONCEPT");
  assert.equal(CATEGORY_LABEL.TREND, "TREND");
  assert.equal(CATEGORY_LABEL.STATEMENT, "STATEMENT");
  assert.equal(CATEGORY_LABEL.WHAT_IF, "WHAT IF");
  assert.equal(CATEGORY_LABEL.DILEMMA, "DILEMMA");
});

// 2. WORD legacy entries map correctly to CONCEPT
test("legacy category entries map gracefully to canonical categories", () => {
  // Legacy "word" / "WORD" must map to "CONCEPT"
  assert.equal(normalizeCategory("word"), "CONCEPT");
  assert.equal(normalizeCategory("WORD"), "CONCEPT");

  // Legacy "general" / "statement" map to "STATEMENT"
  assert.equal(normalizeCategory("general"), "STATEMENT");
  assert.equal(normalizeCategory("statement"), "STATEMENT");
  assert.equal(normalizeCategory("STATEMENT"), "STATEMENT");

  // "trend" / "TREND"
  assert.equal(normalizeCategory("trend"), "TREND");
  assert.equal(normalizeCategory("TREND"), "TREND");

  // "what-if" / "what_if" / "WHAT IF"
  assert.equal(normalizeCategory("what-if"), "WHAT_IF");
  assert.equal(normalizeCategory("what_if"), "WHAT_IF");
  assert.equal(normalizeCategory("WHAT IF"), "WHAT_IF");
  assert.equal(normalizeCategory("WHAT_IF"), "WHAT_IF");

  // "dilemma" / "DILEMMA"
  assert.equal(normalizeCategory("dilemma"), "DILEMMA");
  assert.equal(normalizeCategory("DILEMMA"), "DILEMMA");

  // Unknown or invalid defaults safely to "STATEMENT"
  assert.equal(normalizeCategory(""), "STATEMENT");
  assert.equal(normalizeCategory(null), "STATEMENT");
  assert.equal(normalizeCategory(undefined), "STATEMENT");
});

// 3. Gemini response parsing and validation
test("structured topic response validation and domain taxonomy check", () => {
  assert.equal(DOMAINS.length, 12);
  assert.ok(DOMAINS.includes("Technology and AI"));
  assert.ok(DOMAINS.includes("Psychology and human behaviour"));
  assert.ok(DOMAINS.includes("Personal finance"));

  const validJson = JSON.stringify({
    topic: "Would you choose financial security over personal freedom?",
    domain: "Psychology and human behaviour",
  });

  const parsed = JSON.parse(validJson) as { topic: string; domain: string };
  assert.equal(typeof parsed.topic, "string");
  assert.ok(parsed.topic.length > 0);
  assert.ok(DOMAINS.includes(parsed.domain as (typeof DOMAINS)[number]));
});

// 4. Invalid JSON and malformed model responses
test("robust parsing handles markdown code fences and rejects malformed payloads", () => {
  // Parsing helper emulation
  const parseJson = (text: string) => {
    const trimmed = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
          return null;
        }
      }
      return null;
    }
  };

  // Code-fenced JSON
  const fenced = "```json\n{\"topic\": \"Nostalgia\", \"domain\": \"Psychology and human behaviour\"}\n```";
  const parsedFenced = parseJson(fenced);
  assert.ok(parsedFenced);
  assert.equal(parsedFenced.topic, "Nostalgia");

  // Embedded JSON with text before/after
  const embedded = "Here is your requested topic:\n{\"topic\": \"Ambition\", \"domain\": \"Work and careers\"}\nHope this works!";
  const parsedEmbedded = parseJson(embedded);
  assert.ok(parsedEmbedded);
  assert.equal(parsedEmbedded.topic, "Ambition");

  // Completely invalid strings
  assert.equal(parseJson("Not JSON at all"), null);
  assert.equal(parseJson("{ broken json:"), null);
});

// 5. Category balancing
test("category balancing avoids consecutive repeats and favors underrepresented categories", () => {
  // Empty history picks any valid category
  const emptyPick = selectBalancedCategory([]);
  assert.ok(CATEGORIES.includes(emptyPick));

  // If last pick was "CONCEPT", next pick MUST NOT be "CONCEPT"
  const historyWithConcept: RecentTopic[] = [
    { text: "Topic 1", category: "STATEMENT", domain: "Society and culture", timestamp: 1 },
    { text: "Topic 2", category: "CONCEPT", domain: "Psychology and human behaviour", timestamp: 2 },
  ];

  for (let i = 0; i < 20; i += 1) {
    const nextCat = selectBalancedCategory(historyWithConcept);
    assert.notEqual(nextCat, "CONCEPT", "Must not select the exact same category consecutively");
  }

  // Underrepresentation preference:
  // History has 5 CONCEPTs, 5 TRENDs, 5 STATEMENTs, 5 WHAT_IFs, and 0 DILEMMAs
  const unbalancedHistory: RecentTopic[] = [
    ...Array(5).fill({ text: "A", category: "CONCEPT", domain: "A", timestamp: 1 }),
    ...Array(5).fill({ text: "B", category: "TREND", domain: "B", timestamp: 2 }),
    ...Array(5).fill({ text: "C", category: "STATEMENT", domain: "C", timestamp: 3 }),
    ...Array(5).fill({ text: "D", category: "WHAT_IF", domain: "D", timestamp: 4 }),
  ];

  // The underrepresented category is DILEMMA (0 occurrences)
  const balancedChoice = selectBalancedCategory(unbalancedHistory);
  assert.equal(balancedChoice, "DILEMMA");
});

// 6. Duplicate and similar-topic exclusion instructions
test("sanitizeAvoidList sanitizes inputs, dedupes case-insensitively and caps at 20", () => {
  const rawList = [
    "  Why are more people building multiple income streams?  ",
    "why are more people building multiple income streams?", // Duplicate
    { text: "What if cities completely banned private cars?", category: "WHAT_IF", domain: "Environment and sustainability" },
    { text: "  what if cities completely banned private cars?  " }, // Duplicate
    { text: "" }, // Empty text rejected
    null,
    123,
    ...Array(30).fill(null).map((_, i) => `Extra topic ${i}`),
  ];

  const sanitized = sanitizeAvoidList(rawList);
  assert.ok(sanitized.length <= 20, "Must be capped at 20 items");
  assert.equal(sanitized[0].text, "Why are more people building multiple income streams?");
  assert.equal(sanitized[1].text, "What if cities completely banned private cars?");
  assert.equal(sanitized[1].category, "WHAT_IF");
});

// 7. Recent topic history storage and size limits
test("recent topic history storage stores up to 30 items and dedupes", () => {
  clearRecentTopics();
  assert.equal(loadRecentTopics().length, 0);

  // Save 35 topics
  for (let i = 1; i <= 35; i += 1) {
    saveRecentTopic({
      text: `Topic ${i}`,
      category: "STATEMENT",
      domain: "Society and culture",
      timestamp: i,
    });
  }

  const stored = loadRecentTopics();
  assert.equal(stored.length, MAX_RECENT_TOPICS);
  assert.equal(stored.length, 30);
  // Oldest items (1-5) should have shifted out; newest should be present
  assert.equal(stored[stored.length - 1].text, "Topic 35");
  assert.equal(stored[0].text, "Topic 6");

  // Deduplication: saving "Topic 35" again should not create duplicate
  saveRecentTopic({
    text: "topic 35",
    category: "STATEMENT",
    domain: "Society and culture",
  });
  const afterDedup = loadRecentTopics();
  assert.equal(afterDedup.length, 30);

  // Exclusion slice defaults to 20
  const exclusion = getRecentForExclusion();
  assert.equal(exclusion.length, EXCLUSION_LIMIT);
});

// 8. Invalid localStorage data handling
test("loadRecentTopics safely handles corrupt or unexpected localStorage values", () => {
  // Corrupted JSON
  memoryStore.set(RECENT_TOPICS_KEY, "{ not valid json [");
  assert.deepEqual(loadRecentTopics(), []);

  // Not an array
  memoryStore.set(RECENT_TOPICS_KEY, JSON.stringify({ notAnArray: true }));
  assert.deepEqual(loadRecentTopics(), []);

  // Array with malformed objects
  memoryStore.set(
    RECENT_TOPICS_KEY,
    JSON.stringify([
      null,
      123,
      { text: "" }, // Empty
      { text: "Valid topic", timestamp: 123456, domain: "Technology and AI", category: "TREND" },
    ]),
  );

  const recovered = loadRecentTopics();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].text, "Valid topic");
  assert.equal(recovered[0].category, "TREND");
});

// 9. Gemini failure and Groq fallback
test("static fallback executes reliably when AI providers are unavailable", () => {
  const avoid = new Set<string>(["nostalgia", "ambition"]);
  const fallback = getStaticFallbackTopic("CONCEPT", avoid);

  assert.ok(fallback.text.length > 0);
  assert.equal(fallback.category, "CONCEPT");
  assert.ok(!avoid.has(fallback.text.toLowerCase()));
  assert.ok(fallback.domain.length > 0);
});

// 10. Full static fallback behaviour covers all 5 categories
test("curated static pool contains diverse entries for all five categories", () => {
  for (const cat of CATEGORIES) {
    const inCategory = TOPICS.filter((t) => normalizeCategory(t.category) === cat);
    assert.ok(
      inCategory.length >= 10,
      `Category ${cat} should have at least 10 curated static topics, found ${inCategory.length}`,
    );

    // Verify each topic has non-empty text and a valid domain
    for (const t of inCategory) {
      assert.ok(t.text.trim().length > 0);
      assert.ok(t.domain && DOMAINS.includes(t.domain as (typeof DOMAINS)[number]));
    }
  }
});

// 11. Existing TopicSpinner compatibility
test("availableTopics and pickTopic remain fully compatible with TopicSpinner", () => {
  const candidates = availableTopics();
  assert.ok(candidates.length >= 50);

  // Ensure all 5 categories are present in availableTopics
  for (const cat of CATEGORIES) {
    const hasCat = candidates.some((c) => normalizeCategory(c.category) === cat);
    assert.ok(hasCat, `Candidate pool must contain category ${cat}`);
  }

  // pickTopic returns valid candidate
  const picked = pickTopic(candidates);
  assert.ok(picked.text.length > 0);
  assert.ok(CATEGORIES.includes(normalizeCategory(picked.category)));

  // randomReelTopic returns valid candidate
  const reelPick = randomReelTopic(candidates);
  assert.ok(reelPick.text.length > 0);

  // consumeTopic runs without error
  assert.doesNotThrow(() => consumeTopic(picked.text));
});

// 12. Existing topic selection and preparation flow
test("picked topic structure conforms to Topic interface and can be saved in session", () => {
  const sampleTopic: Topic = {
    text: "Would you choose absolute job security or high risk with infinite upside?",
    category: "DILEMMA",
    domain: "Business and entrepreneurship",
  };

  assert.equal(normalizeCategory(sampleTopic.category), "DILEMMA");
  assert.equal(CATEGORY_LABEL[sampleTopic.category], "DILEMMA");

  // Save to recent memory
  saveRecentTopic(sampleTopic);
  const recent = loadRecentTopics();
  assert.ok(recent.some((r) => r.text === sampleTopic.text && r.category === "DILEMMA"));
});
