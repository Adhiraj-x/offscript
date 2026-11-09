import {
  TOPICS,
  normalizeCategory,
  type CanonicalTopicCategory,
  type Topic,
  type TopicCategory,
} from "./topics";
import {
  getRecentForExclusion,
  loadRecentTopics,
  saveRecentTopic,
  selectBalancedCategory,
} from "./recentTopics";

const POOL_KEY = "offscript_topics_v1";

export function loadAiTopics(): Topic[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(POOL_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const record = parsed as { topics?: unknown };
    if (!Array.isArray(record.topics)) return [];

    return record.topics
      .filter((t): t is Topic => Boolean(t && typeof t.text === "string" && t.text.trim()))
      .map((t) => ({
        text: t.text.trim(),
        category: normalizeCategory(t.category),
        domain: typeof t.domain === "string" ? t.domain : undefined,
      }));
  } catch {
    return [];
  }
}

/** Static curated list plus any cached topics, de-duplicated case-insensitively. */
export function availableTopics(): Topic[] {
  const extra = loadAiTopics();
  if (extra.length === 0) return [...TOPICS];

  const seen = new Set(TOPICS.map((topic) => topic.text.toLowerCase()));
  const fresh = extra.filter((topic) => {
    const key = topic.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...TOPICS, ...fresh];
}

/** Consume single-use topic from cached storage. */
export function consumeTopic(text: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(POOL_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    const record = parsed as { topics?: unknown; fetchedAt?: number };
    if (!Array.isArray(record.topics)) return;

    const key = text.trim().toLowerCase();
    const remaining = record.topics.filter(
      (t: { text?: string }) => typeof t.text === "string" && t.text.toLowerCase() !== key,
    );
    window.localStorage.setItem(POOL_KEY, JSON.stringify({ ...record, topics: remaining }));
  } catch {
    // Safe no-op
  }
}

/** Fetch a single topic from the API route with avoidance context. */
export async function fetchTopicFromApi(options?: {
  category?: CanonicalTopicCategory;
  avoid?: { text: string; category?: string; domain?: string }[];
}): Promise<Topic> {
  const avoid = options?.avoid ?? getRecentForExclusion(20);
  const category = options?.category ?? selectBalancedCategory(avoid);

  const response = await fetch("/api/topics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ category, avoid }),
  });

  if (!response.ok) {
    throw new Error(`Topic generation failed with status ${response.status}`);
  }

  const data = (await response.json()) as { topic?: Topic; topics?: Topic[] };
  const topic = data.topic ?? data.topics?.[0];
  if (!topic || typeof topic.text !== "string" || !topic.text.trim()) {
    throw new Error("Invalid topic payload returned from server");
  }

  return {
    text: topic.text.trim(),
    category: normalizeCategory(topic.category),
    domain: typeof topic.domain === "string" ? topic.domain : undefined,
  };
}

let backgroundFetchTriggered = false;

/**
 * Background hook retained for compatibility with home page mount.
 * Does not block UI.
 */
export async function refreshTopicsInBackground(): Promise<void> {
  if (typeof window === "undefined" || backgroundFetchTriggered) return;
  backgroundFetchTriggered = true;
  // Non-blocking no-op or lightweight warmup if needed
}
