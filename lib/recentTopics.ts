import {
  CATEGORIES,
  DOMAINS,
  TOPICS,
  normalizeCategory,
  type CanonicalTopicCategory,
  type Domain,
  type TopicCategory,
} from "./topics";

export const RECENT_TOPICS_KEY = "offscript:recent-topics:v1";
export const MAX_RECENT_TOPICS = 30;
export const EXCLUSION_LIMIT = 20;

export interface RecentTopic {
  text: string;
  category: CanonicalTopicCategory;
  domain: string;
  timestamp: number;
}

export interface NormalizedAvoidItem {
  text: string;
  category?: CanonicalTopicCategory;
  domain?: string;
}

function isValidRecentTopic(item: unknown): item is RecentTopic {
  if (!item || typeof item !== "object") return false;
  const cand = item as Partial<RecentTopic>;
  return (
    typeof cand.text === "string" &&
    cand.text.trim().length > 0 &&
    typeof cand.timestamp === "number" &&
    Number.isFinite(cand.timestamp) &&
    typeof cand.domain === "string"
  );
}

export function loadRecentTopics(): RecentTopic[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_TOPICS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const valid: RecentTopic[] = [];
    for (const item of parsed) {
      if (isValidRecentTopic(item)) {
        valid.push({
          text: item.text.trim(),
          category: normalizeCategory(item.category),
          domain: item.domain.trim() || DOMAINS[0],
          timestamp: item.timestamp,
        });
      }
    }
    return valid.slice(-MAX_RECENT_TOPICS);
  } catch {
    return [];
  }
}

export function saveRecentTopic(entry: {
  text: string;
  category: TopicCategory | string;
  domain?: string;
  timestamp?: number;
}): void {
  if (typeof window === "undefined") return;
  const trimmedText = typeof entry?.text === "string" ? entry.text.trim() : "";
  if (!trimmedText) return;

  try {
    const existing = loadRecentTopics();
    const normalizedKey = trimmedText.toLowerCase();

    // Deduplicate by case-insensitive text match
    const filtered = existing.filter((item) => item.text.toLowerCase() !== normalizedKey);

    const newRecord: RecentTopic = {
      text: trimmedText,
      category: normalizeCategory(entry.category),
      domain:
        entry.domain && typeof entry.domain === "string" && entry.domain.trim()
          ? entry.domain.trim()
          : DOMAINS[0],
      timestamp:
        typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)
          ? entry.timestamp
          : Date.now(),
    };

    const updated = [...filtered, newRecord].slice(-MAX_RECENT_TOPICS);
    window.localStorage.setItem(RECENT_TOPICS_KEY, JSON.stringify(updated));
  } catch {
    // Quota exceeded or private browsing mode: fail silently
  }
}

/** Return the most recent entries (up to limit) for the generation avoid list. */
export function getRecentForExclusion(limit = EXCLUSION_LIMIT): RecentTopic[] {
  const all = loadRecentTopics();
  return all.slice(-Math.max(1, limit));
}

export function clearRecentTopics(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RECENT_TOPICS_KEY);
  } catch {
    // Safe no-op
  }
}

/** Sanitize, validate and cap incoming avoid payload to at most 20 entries. */
export function sanitizeAvoidList(raw: unknown): NormalizedAvoidItem[] {
  if (!Array.isArray(raw)) return [];
  const items: NormalizedAvoidItem[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    let text = "";
    let category: CanonicalTopicCategory | undefined;
    let domain: string | undefined;

    if (typeof entry === "string") {
      text = entry.replace(/\s+/g, " ").trim();
    } else if (entry && typeof entry === "object") {
      const cand = entry as { text?: unknown; category?: unknown; domain?: unknown };
      if (typeof cand.text === "string") {
        text = cand.text.replace(/\s+/g, " ").trim();
      }
      if (typeof cand.category === "string") {
        category = normalizeCategory(cand.category);
      }
      if (typeof cand.domain === "string") {
        domain = cand.domain.replace(/\s+/g, " ").trim();
      }
    }

    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({ text: text.slice(0, 200), category, domain });
    if (items.length >= EXCLUSION_LIMIT) break;
  }

  return items;
}

/** Curated static fallback topic when AI providers are unavailable. */
export function getStaticFallbackTopic(
  category: CanonicalTopicCategory,
  avoidSet: Set<string>,
): { text: string; category: CanonicalTopicCategory; domain: string } {
  const inCategory = TOPICS.filter((t) => normalizeCategory(t.category) === category);
  const unseen = inCategory.filter((t) => !avoidSet.has(t.text.toLowerCase()));
  const pool = unseen.length > 0 ? unseen : inCategory.length > 0 ? inCategory : TOPICS;
  const picked = pool[Math.floor(Math.random() * pool.length)];

  return {
    text: picked.text,
    category,
    domain: picked.domain ?? DOMAINS[0],
  };
}

/**
 * Category balancing algorithm:
 * 1. Counts frequencies across all 5 canonical categories in recent history.
 * 2. Excludes the most recently used category from candidates to prevent consecutive repeats.
 * 3. Among remaining candidates, identifies the least-represented categories.
 * 4. Selects uniformly at random among equally underrepresented categories.
 */
export function selectBalancedCategory(
  history?: RecentTopic[] | { category?: unknown }[],
): CanonicalTopicCategory {
  const records = history ?? (typeof window !== "undefined" ? loadRecentTopics() : []);
  const allCategories = [...CATEGORIES];

  if (records.length === 0) {
    return allCategories[Math.floor(Math.random() * allCategories.length)];
  }

  const counts: Record<CanonicalTopicCategory, number> = {
    CONCEPT: 0,
    TREND: 0,
    STATEMENT: 0,
    WHAT_IF: 0,
    DILEMMA: 0,
  };

  for (const item of records) {
    const cat = normalizeCategory(item.category);
    counts[cat] = (counts[cat] ?? 0) + 1;
  }

  // Avoid consecutive same-category picks
  const lastRecord = records[records.length - 1];
  const lastCategory = lastRecord ? normalizeCategory(lastRecord.category) : null;

  let candidates = allCategories.filter((c) => c !== lastCategory);
  if (candidates.length === 0) {
    candidates = allCategories;
  }

  // Find minimum count among eligible candidates
  let minCount = Infinity;
  for (const c of candidates) {
    if (counts[c] < minCount) {
      minCount = counts[c];
    }
  }

  const underrepresented = candidates.filter((c) => counts[c] === minCount);
  return underrepresented[Math.floor(Math.random() * underrepresented.length)];
}
