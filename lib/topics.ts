export type TopicCategory = "word" | "statement" | "general" | "trend";

export interface Topic {
  text: string;
  category: TopicCategory;
}

export const CATEGORY_LABEL: Record<TopicCategory, string> = {
  word: "Word",
  statement: "Statement",
  general: "Topic",
  trend: "Trend",
};

const CATEGORIES: TopicCategory[] = ["word", "statement", "general", "trend"];

export const TOPICS: Topic[] = [
  // Single words
  { text: "Silence", category: "word" },
  { text: "Nostalgia", category: "word" },
  { text: "Luck", category: "word" },
  { text: "Home", category: "word" },
  { text: "Ambition", category: "word" },
  { text: "Trust", category: "word" },
  { text: "Boredom", category: "word" },
  { text: "Midnight", category: "word" },
  { text: "Maps", category: "word" },
  { text: "Failure", category: "word" },
  { text: "Currency", category: "word" },
  { text: "Mirrors", category: "word" },
  { text: "Rumors", category: "word" },
  { text: "Patience", category: "word" },
  { text: "Shortcuts", category: "word" },

  // Statements and prompts
  { text: "Failure is the best teacher.", category: "statement" },
  { text: "You can't be both liked and respected.", category: "statement" },
  { text: "What would you tell your 15-year-old self?", category: "statement" },
  { text: "If you could un-invent one thing, what would it be?", category: "statement" },
  { text: "Talent is overrated.", category: "statement" },
  { text: "Convince me that mornings are better than nights.", category: "statement" },
  { text: "Describe your perfect day without using your phone.", category: "statement" },
  { text: "Is it better to be a big fish in a small pond?", category: "statement" },
  { text: "Why do we fear public speaking more than almost anything?", category: "statement" },
  { text: "What's the best advice you've ever ignored?", category: "statement" },
  { text: "Is social media making us lonelier?", category: "statement" },
  { text: "Should everyone learn to code?", category: "statement" },
  { text: "Rules are meant to be broken.", category: "statement" },
  { text: "Sell me something you hate.", category: "statement" },
  { text: "Is it better to be early or on time?", category: "statement" },

  // Broad topics
  { text: "Why we dream", category: "general" },
  { text: "How habits form", category: "general" },
  { text: "The value of travel", category: "general" },
  { text: "Friendship in adulthood", category: "general" },
  { text: "Minimalism", category: "general" },
  { text: "Learning a second language", category: "general" },
  { text: "The psychology of money", category: "general" },
  { text: "Why people procrastinate", category: "general" },
  { text: "Teamwork vs. working solo", category: "general" },
  { text: "The role of luck in success", category: "general" },
  { text: "What makes a good leader", category: "general" },
  { text: "City life vs. village life", category: "general" },
  { text: "The future of education", category: "general" },
  { text: "Why we love stories", category: "general" },
  { text: "The power of routines", category: "general" },

  // Current themes
  { text: "AI and the future of jobs", category: "trend" },
  { text: "Short-form video and attention spans", category: "trend" },
  { text: "Remote work vs. the office", category: "trend" },
  { text: "The creator economy", category: "trend" },
  { text: "10-minute quick-commerce delivery", category: "trend" },
  { text: "UPI and cashless payments", category: "trend" },
  { text: "Electric vehicles", category: "trend" },
  { text: "Personal branding on LinkedIn", category: "trend" },
  { text: "Side hustles and multiple income streams", category: "trend" },
  { text: "Digital detox", category: "trend" },
  { text: "Subscription fatigue", category: "trend" },
  { text: "AI-generated art and music", category: "trend" },
  { text: "Wearables and fitness tracking", category: "trend" },
  { text: "Microlearning", category: "trend" },
  { text: "The gig economy", category: "trend" },
];

const RECENT_LIMIT = 5;
const HISTORY_LIMIT = 30;

/**
 * Topics handed out this session, in memory only (deliberately not persisted).
 * The last 5 block repeats; the full 30 feed the "avoid" list for AI generation.
 */
let recentTopics: string[] = [];

/** A random topic for the spinning reel (not a real pick). Candidates may include AI topics. */
export function randomReelTopic(candidates: Topic[] = TOPICS): Topic {
  const pool = candidates.length > 0 ? candidates : TOPICS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Uniform over categories first, then uniform within the chosen category, so the
 * 15 single words don't dominate the 45 sentences/topics by sheer count.
 * Never repeats any of the last 5 topics handed out.
 */
export function pickTopic(candidates: Topic[] = TOPICS): Topic {
  const available = candidates.length > 0 ? candidates : TOPICS;
  const blocked = recentTopics.slice(-RECENT_LIMIT);
  const unseen = available.filter((topic) => !blocked.includes(topic.text));
  const source = unseen.length > 0 ? unseen : available;

  const categories = CATEGORIES.filter((category) =>
    source.some((topic) => topic.category === category),
  );
  const category = categories[Math.floor(Math.random() * categories.length)];
  const pool = source.filter((topic) => topic.category === category);
  const chosen = pool[Math.floor(Math.random() * pool.length)];

  recentTopics = [...recentTopics, chosen.text].slice(-HISTORY_LIMIT);
  return chosen;
}

/** Most recent picks, newest last — used so AI generation avoids topics already seen. */
export function recentTopicTexts(limit = HISTORY_LIMIT): string[] {
  return recentTopics.slice(-limit);
}

/** Font size scaled by text length, so a single word is huge and a sentence still wraps. */
export function topicTextClass(text: string): string {
  const length = text.length;
  if (length <= 14) return "text-4xl font-semibold tracking-tight sm:text-6xl";
  if (length <= 40) return "text-2xl font-medium leading-snug tracking-tight sm:text-3xl";
  if (length <= 85) return "text-xl font-medium leading-snug sm:text-2xl";
  return "text-lg font-medium leading-snug sm:text-xl";
}
