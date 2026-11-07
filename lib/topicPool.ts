import { TOPICS, recentTopicTexts, type Topic, type TopicCategory } from "./topics";

const POOL_KEY = "offscript_topics_v1";
/** Refill a category only once its unused AI batch drops below this. */
const MIN_UNUSED_PER_CATEGORY = 5;
const BATCH_SIZE = 25;
const TREND_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CATEGORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const AVOID_LIMIT = 30;
const CATEGORIES: TopicCategory[] = ["word", "statement", "general", "trend"];

type StoredPool = {
  fetchedAt: number;
  topics: Topic[];
  /** Last successful refill per category, so each category keeps its own clock. */
  fetchedByCategory: Partial<Record<TopicCategory, number>>;
};

/** One refresh pass per session; a failed pass is not retried until reload. */
let refreshStarted = false;
let failedThisSession = false;

function isCategory(value: unknown): value is TopicCategory {
  return typeof value === "string" && (CATEGORIES as string[]).includes(value);
}

function isTopic(value: unknown): value is Topic {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Topic>;
  return (
    typeof candidate.text === "string" &&
    candidate.text.trim().length > 0 &&
    isCategory(candidate.category)
  );
}

function readPool(): StoredPool | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(POOL_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const record = parsed as { fetchedAt?: unknown; topics?: unknown; fetchedByCategory?: unknown };
    const topics = Array.isArray(record.topics) ? record.topics.filter(isTopic) : [];
    const fetchedAt =
      typeof record.fetchedAt === "number" && Number.isFinite(record.fetchedAt) ? record.fetchedAt : 0;

    // Older records only stored a single fetchedAt; that still works as a fallback.
    const fetchedByCategory: Partial<Record<TopicCategory, number>> = {};
    if (record.fetchedByCategory && typeof record.fetchedByCategory === "object") {
      for (const [key, value] of Object.entries(record.fetchedByCategory as Record<string, unknown>)) {
        if (isCategory(key) && typeof value === "number" && Number.isFinite(value)) {
          fetchedByCategory[key] = value;
        }
      }
    }

    return { fetchedAt, topics, fetchedByCategory };
  } catch {
    return null;
  }
}

function writePool(pool: StoredPool): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(POOL_KEY, JSON.stringify(pool));
  } catch {
    // Quota or private mode: the static list still works.
  }
}

/** AI topics currently cached (may be empty). */
export function loadAiTopics(): Topic[] {
  return readPool()?.topics ?? [];
}

/** Static list plus unused AI topics, de-duplicated case-insensitively. */
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

/** AI topics are single-use: once handed to the user, drop them from the pool. */
export function consumeTopic(text: string): void {
  const pool = readPool();
  if (!pool) return;
  const key = text.trim().toLowerCase();
  const remaining = pool.topics.filter((topic) => topic.text.toLowerCase() !== key);
  if (remaining.length === pool.topics.length) return;
  writePool({ ...pool, topics: remaining });
}

function lastFetchedAt(pool: StoredPool, category: TopicCategory): number {
  return pool.fetchedByCategory[category] ?? pool.fetchedAt;
}

/** Fewer than 5 unused AI topics, and the category's own cooldown has elapsed. */
function needsCategory(pool: StoredPool | null, category: TopicCategory, now: number): boolean {
  const topics = pool?.topics ?? [];
  if (topics.filter((topic) => topic.category === category).length >= MIN_UNUSED_PER_CATEGORY) {
    return false;
  }
  if (!pool) return true;
  const minAge = category === "trend" ? TREND_MAX_AGE_MS : CATEGORY_MAX_AGE_MS;
  return now - lastFetchedAt(pool, category) >= minAge;
}

function buildAvoidList(): string[] {
  const texts = [...recentTopicTexts(AVOID_LIMIT), ...loadAiTopics().map((topic) => topic.text)];
  const seen = new Set<string>();
  const avoid: string[] = [];
  for (const text of texts) {
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    avoid.push(text);
  }
  return avoid.slice(0, AVOID_LIMIT + 10);
}

/** Replaces the cached batch for one category and stamps its refresh clock. */
function replaceCategory(category: TopicCategory, topics: Topic[]): void {
  const existing = readPool();
  const kept = (existing?.topics ?? []).filter((topic) => topic.category !== category);
  const now = Date.now();
  writePool({
    fetchedAt: now,
    topics: [...kept, ...topics],
    fetchedByCategory: { ...(existing?.fetchedByCategory ?? {}), [category]: now },
  });
}

async function fetchTopics(category: TopicCategory, avoid: string[]): Promise<Topic[]> {
  const response = await fetch(`/api/topics?category=${encodeURIComponent(category)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ avoid }),
  });
  if (!response.ok) throw new Error(`topic fetch for ${category} failed (${response.status})`);

  const payload = (await response.json()) as { topics?: unknown };
  const list = Array.isArray(payload.topics) ? payload.topics : [];
  return list
    .filter(isTopic)
    .map((topic) => ({ text: topic.text.trim(), category: topic.category }))
    .filter((topic) => topic.category === category)
    .slice(0, BATCH_SIZE);
}

/**
 * Tops up the pool in the background: one category per request, sequentially,
 * never blocking the UI. Failures are silent apart from a console warning and are
 * not retried again this session.
 */
export async function refreshTopicsInBackground(): Promise<void> {
  if (typeof window === "undefined" || refreshStarted) return;
  refreshStarted = true;
  if (failedThisSession) return;

  for (const category of CATEGORIES) {
    if (!needsCategory(readPool(), category, Date.now())) continue;
    try {
      const topics = await fetchTopics(category, buildAvoidList());
      if (topics.length === 0) continue;
      replaceCategory(category, topics);
    } catch (error) {
      failedThisSession = true;
      console.warn("[offscript] background topic refresh failed", error);
      return;
    }
  }
}
