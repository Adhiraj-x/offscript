import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  GEMINI_TOPIC_MODEL,
  GEMINI_TIMEOUT_MS,
  GROQ_CHAT_MODEL,
  getGeminiClient,
  getGroqClient,
} from "@/lib/llm";
import {
  DOMAINS,
  normalizeCategory,
  type CanonicalTopicCategory,
  type Topic,
} from "@/lib/topics";
import {
  getStaticFallbackTopic,
  sanitizeAvoidList,
  selectBalancedCategory,
  type NormalizedAvoidItem,
} from "@/lib/recentTopics";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MAX_TOPIC_WORDS = 25;

type Provider = "gemini" | "groq" | "static";

const CATEGORY_GUIDELINES: Record<CanonicalTopicCategory, string> = {
  CONCEPT:
    "A single evocative word or short abstract concept (e.g. 'Nostalgia', 'Ambition', 'Freedom', 'Resilience', 'Symmetry', 'Curiosity'). One to three words only. Never a phrase, sentence, or question.",
  TREND:
    "An interesting development, behavioral shift, or emerging theme in technology, society, culture, business, work, or daily life. Focus on discussable cultural or human shifts rather than unverified breaking news.",
  STATEMENT:
    "A bold, provocative, debatable proposition or assertion that challenges assumptions and asks the speaker to agree, disagree, or defend a perspective.",
  WHAT_IF:
    "A thought-provoking hypothetical scenario testing imagination, reasoning, and mental models (e.g. 'What if cities completely banned private cars?').",
  DILEMMA:
    "A difficult choice involving competing values, trade-offs, or imperfect outcomes (e.g. 'Would you choose absolute job security with zero growth, or high risk with infinite upside?').",
};

const SYSTEM_PROMPT = `You generate speaking-practice topics for Offscript, an application where users prepare and give a 2-minute spoken response.

Category definitions:
- CONCEPT: A single word or short abstract idea (e.g. "Nostalgia", "Ambition", "Freedom", "Resilience", "Symmetry"). 1 to 3 words only. Never a sentence or question.
- TREND: An interesting shift or development in technology, society, culture, business, work, or daily life.
- STATEMENT: A bold, debatable proposition or assertion asking the speaker to agree, disagree, or defend a perspective.
- WHAT_IF: A hypothetical scenario testing imagination, consequences, values, or mental models.
- DILEMMA: A difficult choice involving competing values, trade-offs, or imperfect outcomes.

Internal domain taxonomy:
${DOMAINS.map((d, i) => `${i + 1}. ${d}`).join("\n")}

Topic Quality & Safety Rules:
- Produce exactly 1 speaking topic suitable for a structured 2-minute spoken response.
- Easy to understand without specialist knowledge, statistics, or academic research.
- Interesting, specific, and open-ended.
- No partisan politics, elections, politicians, or culture-war framing.
- No tragedies, disasters, violence, death, or graphic events.
- No hate, profanity, or discriminatory framing.
- No emojis, hashtags, or surrounding quotation marks around the topic text.
- Must pick 1 matching domain from the taxonomy above.

Repetition Prevention Rules:
- Strictly DO NOT repeat any topic in the recent avoid list.
- DO NOT reword, rephrase, or produce minor variations of recent topics.
- DO NOT explore the same underlying arguments, scenarios, or viewpoints as recent topics.
- Provide a fresh, distinct discussion angle.

Return ONLY a valid JSON object matching this schema:
{
  "topic": "The generated topic text here",
  "domain": "One of the 12 domains from the taxonomy"
}`;

class TopicGenerationError extends Error {
  kind: "parse" | "config" | "provider";

  constructor(message: string, kind: TopicGenerationError["kind"]) {
    super(message);
    this.name = "TopicGenerationError";
    this.kind = kind;
  }
}

function parseJsonObject(text: string): { topic?: unknown; domain?: unknown } | null {
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

function buildUserPrompt(
  category: CanonicalTopicCategory,
  avoid: NormalizedAvoidItem[],
): string {
  const lines: string[] = [
    `Generate exactly 1 topic for the following category:`,
    `Category: ${category}`,
    `Category Guidance: ${CATEGORY_GUIDELINES[category]}`,
  ];

  if (avoid.length > 0) {
    lines.push(
      `\nRecent topics to strictly avoid repeating, paraphrasing, or mirroring:\n${avoid
        .map((item) => `- "${item.text}" (${item.category ?? "Topic"}${item.domain ? ` — ${item.domain}` : ""})`)
        .join("\n")}`,
    );

    const recentDomains = Array.from(
      new Set(avoid.map((item) => item.domain).filter((d): d is string => Boolean(d))),
    );
    if (recentDomains.length > 0) {
      lines.push(
        `\nRecently covered domains: ${recentDomains.join(", ")}. Please choose a DIFFERENT domain from the taxonomy if feasible.`,
      );
    }
  } else {
    lines.push(`\nThere are no previous topics in the avoid list.`);
  }

  lines.push(
    `\nRespond with ONLY the JSON object {"topic": "...", "domain": "..."}. No markdown and no other text.`,
  );

  return lines.join("\n");
}

function validateAndCleanTopic(
  parsed: unknown,
  requestedCategory: CanonicalTopicCategory,
  avoidSet: Set<string>,
): { text: string; category: CanonicalTopicCategory; domain: string } | null {
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { topic?: unknown; domain?: unknown };
  if (typeof record.topic !== "string") return null;

  let text = record.topic.replace(/\s+/g, " ").trim();
  // Strip surrounding quotes if model added them
  text = text.replace(/^["'“](.*)["'”]$/, "$1").trim();
  if (!text) return null;

  const words = text.split(" ");
  if (requestedCategory === "CONCEPT") {
    if (words.length > 5) return null;
  } else if (words.length > MAX_TOPIC_WORDS) {
    return null;
  }

  if (avoidSet.has(text.toLowerCase())) return null;

  let domain = DOMAINS[0] as string;
  if (typeof record.domain === "string" && record.domain.trim()) {
    const candidateDomain = record.domain.trim();
    const matched = DOMAINS.find((d) => d.toLowerCase() === candidateDomain.toLowerCase());
    domain = matched ?? candidateDomain;
  }

  return { text, category: requestedCategory, domain };
}

async function requestTopicFromModel(
  client: OpenAI,
  model: string,
  category: CanonicalTopicCategory,
  avoid: NormalizedAvoidItem[],
  avoidSet: Set<string>,
): Promise<{ text: string; category: CanonicalTopicCategory; domain: string }> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(category, avoid) },
  ];

  let lastReason = "invalid JSON";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.85,
      max_tokens: 150,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const parsed = parseJsonObject(content);

    if (parsed) {
      const cleaned = validateAndCleanTopic(parsed, category, avoidSet);
      if (cleaned) return cleaned;
      lastReason = "topic duplicated, empty, or unsuitable for category";
    } else {
      lastReason = "invalid JSON";
    }

    messages.push({ role: "assistant", content: content || "{}" });
    messages.push({
      role: "user",
      content: `The previous response had ${lastReason}. Return ONLY valid JSON with 1 fresh ${category} topic: {"topic": "...", "domain": "..."}.`,
    });
  }

  throw new TopicGenerationError(`${model} returned ${lastReason} twice`, "parse");
}

async function generateSingleTopic(
  category: CanonicalTopicCategory,
  avoid: NormalizedAvoidItem[],
): Promise<{ topic: Topic; provider: Provider }> {
  const avoidSet = new Set(avoid.map((item) => item.text.toLowerCase()));

  // 1. Primary: Gemini API
  const gemini = getGeminiClient();
  if (gemini) {
    try {
      const result = await requestTopicFromModel(
        gemini,
        GEMINI_TOPIC_MODEL,
        category,
        avoid,
        avoidSet,
      );
      return { topic: result, provider: "gemini" };
    } catch (error) {
      console.warn(
        `[api/topics] Gemini (${GEMINI_TOPIC_MODEL}) generation failed; falling back to Groq.`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // 2. Secondary: Groq API
  const groq = getGroqClient();
  if (groq) {
    try {
      const result = await requestTopicFromModel(
        groq,
        GROQ_CHAT_MODEL,
        category,
        avoid,
        avoidSet,
      );
      return { topic: result, provider: "groq" };
    } catch (error) {
      console.warn(
        `[api/topics] Groq (${GROQ_CHAT_MODEL}) fallback failed; falling back to static pool.`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // 3. Tertiary: Curated Static Fallback
  const staticResult = getStaticFallbackTopic(category, avoidSet);
  return { topic: staticResult, provider: "static" };
}

async function handleTopicRequest(request: NextRequest, body: { avoid?: unknown; category?: unknown } | null) {
  const fromQuery = request.nextUrl.searchParams.get("category");
  const fromBody = body && typeof body.category === "string" ? body.category : null;
  const rawCategory = fromQuery ?? fromBody;

  const avoid = sanitizeAvoidList(body?.avoid);

  let category: CanonicalTopicCategory;
  if (rawCategory && typeof rawCategory === "string" && rawCategory.trim()) {
    category = normalizeCategory(rawCategory);
  } else {
    category = selectBalancedCategory(avoid);
  }

  const { topic, provider } = await generateSingleTopic(category, avoid);

  return NextResponse.json({
    topic,
    topics: [topic],
    provider,
  });
}

export async function GET(request: NextRequest) {
  return handleTopicRequest(request, null);
}

export async function POST(request: NextRequest) {
  let body: { avoid?: unknown; category?: unknown } | null = null;
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object") {
      body = parsed as { avoid?: unknown; category?: unknown };
    }
  } catch {
    body = null;
  }
  return handleTopicRequest(request, body);
}
