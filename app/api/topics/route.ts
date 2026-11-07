import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { XMLParser } from "fast-xml-parser";
import {
  GEMINI_TOPIC_MODEL,
  GEMINI_TIMEOUT_MS,
  GROQ_CHAT_MODEL,
  getGeminiClient,
  getGroqClient,
} from "@/lib/llm";
import type { Topic } from "@/lib/topics";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const TOPIC_COUNT = 25;
const MAX_TOPIC_WORDS = 18;
const MAX_AVOID = 60;
const HEADLINE_LIMIT = 15;
const FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 30 * 60 * 1000;
/** Don't serve a cached batch that the current avoid list has eaten into. */
const MIN_CACHED_TOPICS = 5;

const CATEGORIES = ["word", "statement", "general", "trend"] as const;
type Category = (typeof CATEGORIES)[number];
type Provider = "gemini" | "groq";

type CachedBatch = { topics: Topic[]; provider: Provider; expiresAt: number };

/** In-memory per category so repeated refreshes don't hit a provider again. */
const topicCache = new Map<Category, CachedBatch>();

const CATEGORY_BRIEF: Record<Category, string> = {
  word: "Single evocative words, concrete or abstract, that a person could talk about for one to two minutes. One or two words only — never a phrase or a sentence.",
  statement:
    'Provocative sentences, debate prompts, or questions such as "What would you...", "Is it better to...", "Convince me that...". Each must be arguable out loud in one to two minutes.',
  general:
    "Broad evergreen topics across psychology, habits, society, money, learning and culture. Short title-like phrases, never questions.",
  trend:
    "Speaking prompts built from the headlines below. Turn the underlying themes into discussable topics someone can argue about; never recap or reference a specific news story, headline, company announcement or outlet name.",
};

const SYSTEM_PROMPT = `You generate speaking-practice topics for Offscript, an app where a person talks out loud for one to two minutes.

Return ONLY a JSON object shaped exactly like this:
{"topics":[{"text":"...","category":"..."}]}

Every topic must follow these rules:
- Under 14 words. Shorter is better.
- No partisan politics, political figures, elections, or culture-war framing.
- No tragedies, disasters, wars, violence, deaths, or graphic events.
- Nothing that needs specialist knowledge, statistics, or research to discuss.
- Nothing offensive, hateful, profane, or aimed at a group of people.
- No emojis, hashtags, or quotation marks around the topic.
- Never repeat or closely paraphrase any text in the avoid list.
- Vary style and length: the batch must not read like twenty-five versions of one idea.
- "category" is always the requested category, exactly.

Return exactly ${TOPIC_COUNT} topics. No markdown, no commentary, no extra keys.`;

type Body = { avoid?: unknown; category?: unknown } | null;

class TopicGenerationError extends Error {
  kind: "parse" | "config";

  constructor(message: string, kind: TopicGenerationError["kind"]) {
    super(message);
    this.name = "TopicGenerationError";
    this.kind = kind;
  }
}

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof OpenAI.APIConnectionTimeoutError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /timed? ?out|timeout|ETIMEDOUT|aborted/i.test(message);
}

/** Strips code fences as well, since some providers wrap JSON in markdown. */
function parseJsonObject(text: string): unknown | null {
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
}

function normalizeAvoid(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const avoid: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    avoid.push(text);
    if (avoid.length >= MAX_AVOID) break;
  }
  return avoid;
}

function normalizeTopics(raw: unknown, category: Category, avoid: Set<string>): Topic[] {
  const record = (raw && typeof raw === "object" ? raw : {}) as { topics?: unknown };
  const list = Array.isArray(record.topics) ? record.topics : [];

  const seen = new Set<string>();
  const topics: Topic[] = [];
  for (const entry of list) {
    let candidate = "";
    if (typeof entry === "string") candidate = entry;
    else if (entry && typeof entry === "object") {
      const text = (entry as { text?: unknown }).text;
      if (typeof text === "string") candidate = text;
    }

    const text = candidate.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (text.split(" ").length > MAX_TOPIC_WORDS) continue;

    const key = text.toLowerCase();
    if (seen.has(key) || avoid.has(key)) continue;
    seen.add(key);
    topics.push({ text, category });
    if (topics.length >= TOPIC_COUNT) break;
  }
  return topics;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "user-agent": "Offscript/1.0 (speaking practice demo)" },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Hacker News front page: the first 15 story titles. */
async function hackerNewsHeadlines(): Promise<string[]> {
  try {
    const response = await fetchWithTimeout("https://hacker-news.firebaseio.com/v0/topstories.json");
    if (!response.ok) return [];
    const ids: unknown = await response.json();
    if (!Array.isArray(ids)) return [];

    const storyIds = ids
      .filter((id): id is number => typeof id === "number")
      .slice(0, HEADLINE_LIMIT);

    const settled = await Promise.allSettled(
      storyIds.map(async (id) => {
        const itemResponse = await fetchWithTimeout(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
        );
        if (!itemResponse.ok) return "";
        const item = (await itemResponse.json()) as { title?: unknown };
        return typeof item.title === "string" ? item.title.replace(/\s+/g, " ").trim() : "";
      }),
    );

    return settled
      .map((result) => (result.status === "fulfilled" ? result.value : ""))
      .filter((title) => title.length > 0)
      .slice(0, HEADLINE_LIMIT);
  } catch {
    return [];
  }
}

function headlineText(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const title = (item as { title?: unknown }).title;

  let raw = "";
  if (typeof title === "string") raw = title;
  else if (title && typeof title === "object") {
    const text = (title as { "#text"?: unknown })["#text"];
    if (typeof text === "string") raw = text;
  }

  // Google News appends " - Outlet"; keep the story, drop the attribution.
  return raw.replace(/\s+-\s+[^-]{2,40}$/, "").replace(/\s+/g, " ").trim();
}

/** Google News RSS (India edition) item titles. */
async function googleNewsHeadlines(): Promise<string[]> {
  try {
    const response = await fetchWithTimeout(
      "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en",
    );
    if (!response.ok) return [];
    const xml = await response.text();
    const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });
    const parsed = parser.parse(xml) as { rss?: { channel?: { item?: unknown } } };
    const items = parsed?.rss?.channel?.item;
    const list = Array.isArray(items) ? items : items ? [items] : [];

    return list
      .map((item) => headlineText(item))
      .filter((title) => title.length > 0)
      .slice(0, HEADLINE_LIMIT);
  } catch {
    return [];
  }
}

/** Both feeds in parallel with individual 5s timeouts; either may fail. */
async function collectHeadlines(): Promise<string[]> {
  const [hackerNews, googleNews] = await Promise.all([hackerNewsHeadlines(), googleNewsHeadlines()]);
  if (hackerNews.length === 0 && googleNews.length === 0) return [];
  return [...hackerNews, ...googleNews].slice(0, 30);
}

function buildUserPrompt(category: Category, avoid: string[], headlines: string[]): string {
  const parts = [
    `Category: ${category}`,
    CATEGORY_BRIEF[category],
    avoid.length > 0
      ? `Do not repeat or closely paraphrase these existing topics:\n${avoid.map((text) => `- ${text}`).join("\n")}`
      : "There are no existing topics to avoid.",
  ];

  if (category === "trend" && headlines.length > 0) {
    parts.push(
      `Today's headlines, for themes only (never recap them, never name the outlet):\n${headlines
        .map((headline) => `- ${headline}`)
        .join("\n")}`,
    );
  }

  parts.push(`Return only JSON: exactly ${TOPIC_COUNT} ${category} topics in the object described above.`);
  return parts.join("\n\n");
}

/** One provider: retries once on unparseable/empty output, then gives up. */
async function generateTopics(
  client: OpenAI,
  model: string,
  category: Category,
  avoid: string[],
  avoidSet: Set<string>,
  headlines: string[],
): Promise<Topic[]> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(category, avoid, headlines) },
  ];

  let lastReason = "invalid JSON";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Request-level failures (429, 404, 5xx, timeout) propagate and trigger the fallback.
    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.9,
      max_tokens: 2600,
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0]?.message?.content ?? "";
    const parsed = parseJsonObject(text);

    if (parsed) {
      const topics = normalizeTopics(parsed, category, avoidSet);
      if (topics.length > 0) return topics;
      lastReason = "no usable topics (empty, duplicated, or already avoided)";
    } else {
      lastReason = "invalid JSON";
    }

    messages.push({ role: "assistant", content: text || "(empty reply)" });
    messages.push({
      role: "user",
      content: `Return only JSON. That reply had ${lastReason}. Reply again with ONLY the JSON object described in the system prompt, containing ${TOPIC_COUNT} fresh ${category} topics.`,
    });
  }

  throw new TopicGenerationError(`${model} returned ${lastReason} twice`, "parse");
}

function warnGeminiFallback(error: unknown): void {
  const status = statusOf(error);
  const model = GEMINI_TOPIC_MODEL;

  if (status === 429) {
    console.warn(`[api/topics] Gemini 429 for model "${model}"; falling back to Groq.`);
  } else if (status === 404) {
    console.warn(
      `[api/topics] Gemini model "${model}" not found (404) — set GEMINI_TOPIC_MODEL to a current model. Falling back to Groq.`,
    );
  } else if (typeof status === "number" && status >= 500) {
    console.warn(`[api/topics] Gemini ${status} for model "${model}"; falling back to Groq.`);
  } else if (isTimeoutError(error)) {
    console.warn(
      `[api/topics] Gemini timed out after ${GEMINI_TIMEOUT_MS}ms for model "${model}"; falling back to Groq.`,
    );
  } else if (error instanceof TopicGenerationError) {
    console.warn(`[api/topics] Gemini ${error.message}; falling back to Groq.`);
  } else {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[api/topics] Gemini failed for model "${model}" (${status ?? "no status"}: ${message}); falling back to Groq.`,
    );
  }
}

async function generateForCategory(
  category: Category,
  avoid: string[],
  avoidSet: Set<string>,
  headlines: string[],
): Promise<{ topics: Topic[]; provider: Provider }> {
  const gemini = getGeminiClient();
  if (!gemini) {
    console.warn("[api/topics] GEMINI_API_KEY is not set; using Groq for topics.");
  } else {
    try {
      const topics = await generateTopics(
        gemini,
        GEMINI_TOPIC_MODEL,
        category,
        avoid,
        avoidSet,
        headlines,
      );
      return { topics, provider: "gemini" };
    } catch (error) {
      warnGeminiFallback(error);
    }
  }

  const groq = getGroqClient();
  if (!groq) throw new TopicGenerationError("No topic provider is configured", "config");

  try {
    const topics = await generateTopics(groq, GROQ_CHAT_MODEL, category, avoid, avoidSet, headlines);
    return { topics, provider: "groq" };
  } catch (error) {
    const status = statusOf(error);
    console.warn(`[api/topics] Groq fallback failed (${status ?? "no status"}).`);
    throw error;
  }
}

async function handleRequest(request: NextRequest, body: Body) {
  const fromQuery = request.nextUrl.searchParams.get("category");
  const fromBody = body && typeof body.category === "string" ? body.category : null;
  const requested = fromQuery ?? fromBody ?? "";
  const category = CATEGORIES.find((entry) => entry === requested);

  if (!category) {
    return NextResponse.json(
      { error: "BAD_CATEGORY", message: `category must be one of: ${CATEGORIES.join(", ")}.` },
      { status: 400 },
    );
  }

  if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
    return NextResponse.json(
      {
        error: "CONFIG",
        message:
          "Server has no topic provider configured. Add GEMINI_API_KEY (and GROQ_API_KEY) to .env.local.",
      },
      { status: 500 },
    );
  }

  const avoid = normalizeAvoid(body?.avoid);
  const avoidSet = new Set(avoid.map((text) => text.toLowerCase()));

  const cached = topicCache.get(category);
  if (cached && cached.expiresAt > Date.now()) {
    const topics = cached.topics.filter((topic) => !avoidSet.has(topic.text.toLowerCase()));
    if (topics.length >= Math.min(MIN_CACHED_TOPICS, cached.topics.length)) {
      return NextResponse.json({ topics, provider: cached.provider, cached: true });
    }
  }

  let headlines: string[] = [];
  if (category === "trend") {
    headlines = await collectHeadlines();
    if (headlines.length === 0) {
      return NextResponse.json(
        { error: "NO_HEADLINES", message: "Couldn't reach the news right now. Try again in a minute." },
        { status: 502 },
      );
    }
  }

  try {
    const result = await generateForCategory(category, avoid, avoidSet, headlines);
    topicCache.set(category, {
      topics: result.topics,
      provider: result.provider,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return NextResponse.json({ topics: result.topics, provider: result.provider, cached: false });
  } catch (error) {
    console.error("[api/topics] both providers failed", error);
    return NextResponse.json(
      {
        error: "GENERATION_FAILED",
        message: "Couldn't generate topics right now. Try again in a moment.",
      },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handleRequest(request, null);
}

export async function POST(request: NextRequest) {
  let body: Body = null;
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object") body = parsed as Exclude<Body, null>;
  } catch {
    body = null;
  }
  return handleRequest(request, body);
}
