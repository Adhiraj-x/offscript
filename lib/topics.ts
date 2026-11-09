export type CanonicalTopicCategory =
  | "CONCEPT"
  | "TREND"
  | "STATEMENT"
  | "WHAT_IF"
  | "DILEMMA";

export type LegacyTopicCategory = "word" | "statement" | "general" | "trend";

export type TopicCategory = CanonicalTopicCategory | LegacyTopicCategory;

export const CATEGORIES: readonly CanonicalTopicCategory[] = [
  "CONCEPT",
  "TREND",
  "STATEMENT",
  "WHAT_IF",
  "DILEMMA",
];

export const CATEGORY_LABEL: Record<CanonicalTopicCategory, string> &
  Record<LegacyTopicCategory, string> = {
  CONCEPT: "CONCEPT",
  TREND: "TREND",
  STATEMENT: "STATEMENT",
  WHAT_IF: "WHAT IF",
  DILEMMA: "DILEMMA",
  // Legacy mappings for backwards compatibility with saved sessions
  word: "CONCEPT",
  statement: "STATEMENT",
  general: "STATEMENT",
  trend: "TREND",
};

export const DOMAINS = [
  "Technology and AI",
  "Business and entrepreneurship",
  "Personal finance",
  "Society and culture",
  "Psychology and human behaviour",
  "Education and learning",
  "Science and discovery",
  "Ethics and philosophy",
  "Environment and sustainability",
  "Work and careers",
  "Creativity and entertainment",
  "Everyday life and relationships",
] as const;

export type Domain = (typeof DOMAINS)[number];

export function isDomain(val: unknown): val is Domain {
  return typeof val === "string" && (DOMAINS as readonly string[]).includes(val);
}

export function normalizeCategory(category: unknown): CanonicalTopicCategory {
  if (typeof category !== "string") return "STATEMENT";
  const cleaned = category.trim().toUpperCase().replace(/[-\s]+/g, "_");
  if (cleaned === "CONCEPT" || cleaned === "WORD") return "CONCEPT";
  if (cleaned === "TREND") return "TREND";
  if (cleaned === "STATEMENT" || cleaned === "GENERAL") return "STATEMENT";
  if (cleaned === "WHAT_IF" || cleaned === "WHATIF") return "WHAT_IF";
  if (cleaned === "DILEMMA") return "DILEMMA";
  return "STATEMENT";
}

export interface Topic {
  text: string;
  category: TopicCategory;
  domain?: string;
}

export const TOPICS: Topic[] = [
  // CONCEPT — A single word or abstract idea that encourages interpretation and reflection
  { text: "Nostalgia", category: "CONCEPT", domain: "Psychology and human behaviour" },
  { text: "Ambition", category: "CONCEPT", domain: "Work and careers" },
  { text: "Freedom", category: "CONCEPT", domain: "Ethics and philosophy" },
  { text: "Symmetry", category: "CONCEPT", domain: "Science and discovery" },
  { text: "Identity", category: "CONCEPT", domain: "Society and culture" },
  { text: "Resilience", category: "CONCEPT", domain: "Psychology and human behaviour" },
  { text: "Curiosity", category: "CONCEPT", domain: "Education and learning" },
  { text: "Silence", category: "CONCEPT", domain: "Everyday life and relationships" },
  { text: "Solitude", category: "CONCEPT", domain: "Psychology and human behaviour" },
  { text: "Friction", category: "CONCEPT", domain: "Science and discovery" },
  { text: "Vulnerability", category: "CONCEPT", domain: "Everyday life and relationships" },
  { text: "Velocity", category: "CONCEPT", domain: "Business and entrepreneurship" },
  { text: "Authenticity", category: "CONCEPT", domain: "Society and culture" },
  { text: "Patience", category: "CONCEPT", domain: "Everyday life and relationships" },
  { text: "Legacy", category: "CONCEPT", domain: "Ethics and philosophy" },

  // TREND — Developments in technology, society, culture, business, work and everyday life
  { text: "Why are more people building multiple income streams?", category: "TREND", domain: "Personal finance" },
  { text: "Is remote work changing how people build relationships?", category: "TREND", domain: "Work and careers" },
  { text: "Why are digital minimalism and offline hobbies becoming appealing?", category: "TREND", domain: "Everyday life and relationships" },
  { text: "The rise of micro-credentials over traditional university degrees", category: "TREND", domain: "Education and learning" },
  { text: "How algorithmic feeds are shaping personal taste and culture", category: "TREND", domain: "Technology and AI" },
  { text: "The decline of third places and where people meet now", category: "TREND", domain: "Society and culture" },
  { text: "Why quick-commerce is transforming consumer expectations", category: "TREND", domain: "Business and entrepreneurship" },
  { text: "The impact of subscription business models on personal ownership", category: "TREND", domain: "Business and entrepreneurship" },
  { text: "How AI tools are shifting the definition of entry-level skills", category: "TREND", domain: "Technology and AI" },
  { text: "The growing popularity of low-stimulation travel and retreats", category: "TREND", domain: "Environment and sustainability" },
  { text: "The shift from public social media to private group chats", category: "TREND", domain: "Society and culture" },
  { text: "Why personal branding has become an expectation in modern careers", category: "TREND", domain: "Work and careers" },

  // STATEMENT — A debatable proposition asking the user to agree, disagree or defend
  { text: "A university degree is less valuable than practical experience.", category: "STATEMENT", domain: "Education and learning" },
  { text: "Financial freedom is more important than job security.", category: "STATEMENT", domain: "Personal finance" },
  { text: "Social media has made meaningful friendships harder to maintain.", category: "STATEMENT", domain: "Society and culture" },
  { text: "You cannot be both universally liked and deeply respected.", category: "STATEMENT", domain: "Psychology and human behaviour" },
  { text: "Working from anywhere makes people less loyal to their company.", category: "STATEMENT", domain: "Work and careers" },
  { text: "Most people do not actually want true freedom of choice.", category: "STATEMENT", domain: "Ethics and philosophy" },
  { text: "Passion is a dangerous guide for career decisions.", category: "STATEMENT", domain: "Work and careers" },
  { text: "True expertise is becoming harder to recognise.", category: "STATEMENT", domain: "Society and culture" },
  { text: "Failure is the best teacher.", category: "STATEMENT", domain: "Education and learning" },
  { text: "Talent is overrated compared to consistency.", category: "STATEMENT", domain: "Psychology and human behaviour" },
  { text: "An uncomfortable truth is always better than a comforting lie.", category: "STATEMENT", domain: "Ethics and philosophy" },
  { text: "Productivity culture has damaged our relationship with rest.", category: "STATEMENT", domain: "Everyday life and relationships" },

  // WHAT_IF — Hypothetical scenarios testing imagination, reasoning and structured thinking
  { text: "What if cities completely banned private cars?", category: "WHAT_IF", domain: "Environment and sustainability" },
  { text: "What if money stopped existing tomorrow?", category: "WHAT_IF", domain: "Society and culture" },
  { text: "What if everyone had to work only four days a week?", category: "WHAT_IF", domain: "Work and careers" },
  { text: "What if all internet comments required real verified identity?", category: "WHAT_IF", domain: "Technology and AI" },
  { text: "What if money expired after twelve months of inactivity?", category: "WHAT_IF", domain: "Personal finance" },
  { text: "What if humans lost the ability to lie for 24 hours?", category: "WHAT_IF", domain: "Ethics and philosophy" },
  { text: "What if AI graded every political speech in real time?", category: "WHAT_IF", domain: "Technology and AI" },
  { text: "What if college education was completely free but admissions were a lottery?", category: "WHAT_IF", domain: "Education and learning" },
  { text: "What if social media algorithms were legally required to show opposing views?", category: "WHAT_IF", domain: "Society and culture" },
  { text: "What if everyone received a guaranteed universal basic income?", category: "WHAT_IF", domain: "Personal finance" },
  { text: "What if all personal devices shut down automatically at 9 PM?", category: "WHAT_IF", domain: "Everyday life and relationships" },
  { text: "What if scientific research funding was decided by public vote?", category: "WHAT_IF", domain: "Science and discovery" },

  // DILEMMA — A difficult choice involving competing priorities or values
  { text: "Would you choose a high-paying job with little free time or a lower-paying job with more freedom?", category: "DILEMMA", domain: "Work and careers" },
  { text: "Would you prioritise personal happiness or financial security?", category: "DILEMMA", domain: "Personal finance" },
  { text: "Would you rather be respected by everyone or deeply understood by a few?", category: "DILEMMA", domain: "Psychology and human behaviour" },
  { text: "Would you choose absolute job security with zero growth, or high risk with infinite upside?", category: "DILEMMA", domain: "Business and entrepreneurship" },
  { text: "Is it better to tell a painful truth or a protective lie?", category: "DILEMMA", domain: "Ethics and philosophy" },
  { text: "Should an autonomous car save its passenger or five pedestrians?", category: "DILEMMA", domain: "Ethics and philosophy" },
  { text: "Would you sacrifice personal privacy for complete physical safety?", category: "DILEMMA", domain: "Society and culture" },
  { text: "Is it better to be exceptionally skilled in one area or competent in twenty?", category: "DILEMMA", domain: "Education and learning" },
  { text: "Would you report a close friend's unethical conduct at work or protect your loyalty to them?", category: "DILEMMA", domain: "Work and careers" },
  { text: "Would you rather live in a world where everyone knows your thoughts or you know everyone else's?", category: "DILEMMA", domain: "Psychology and human behaviour" },
  { text: "Would you prefer unlimited creative freedom with no audience or massive reach with rigid constraints?", category: "DILEMMA", domain: "Creativity and entertainment" },
  { text: "Would you choose a peaceful life with few achievements or a stressful life of notable impact?", category: "DILEMMA", domain: "Everyday life and relationships" },
];

const RECENT_LIMIT = 5;
const HISTORY_LIMIT = 30;

let recentTopics: string[] = [];

/** A random topic for the spinning reel. Candidates may include AI topics. */
export function randomReelTopic(candidates: Topic[] = TOPICS): Topic {
  const pool = candidates.length > 0 ? candidates : TOPICS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Uniform over categories first, then uniform within the chosen category.
 * Respects recent memory so repeated topics are avoided.
 */
export function pickTopic(candidates: Topic[] = TOPICS, avoidTexts: string[] = []): Topic {
  const available = candidates.length > 0 ? candidates : TOPICS;
  const blocked = new Set([
    ...recentTopics.slice(-RECENT_LIMIT).map((t) => t.toLowerCase()),
    ...avoidTexts.map((t) => t.toLowerCase()),
  ]);

  const unseen = available.filter((topic) => !blocked.has(topic.text.toLowerCase()));
  const source = unseen.length > 0 ? unseen : available;

  const presentCategories = CATEGORIES.filter((category) =>
    source.some((topic) => normalizeCategory(topic.category) === category),
  );
  const selectedCategory =
    presentCategories.length > 0
      ? presentCategories[Math.floor(Math.random() * presentCategories.length)]
      : CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];

  const pool = source.filter((topic) => normalizeCategory(topic.category) === selectedCategory);
  const candidatePool = pool.length > 0 ? pool : source;
  const chosen = candidatePool[Math.floor(Math.random() * candidatePool.length)];

  recentTopics = [...recentTopics, chosen.text].slice(-HISTORY_LIMIT);
  return chosen;
}

/** Most recent picks, newest last. */
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
