import { normalizeRating, type PaceBand, type RatedAnswer } from "./scoring";

/**
 * The scoring request loop, kept out of the route so the retry behaviour can be
 * tested with a mocked model. It knows nothing about Groq or OpenAI: the caller
 * supplies a function that performs one completion.
 */

export type ConversationMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type CompletionFn = (messages: ConversationMessage[]) => Promise<string>;

export type RateAnswerResult =
  | { ok: true; value: RatedAnswer; attempts: number }
  | { ok: false; reason: string; attempts: number };

export type RateAnswerOptions = {
  messages: ConversationMessage[];
  requestCompletion: CompletionFn;
  /** Measured pace band, used only to keep the feedback's wording consistent. */
  paceBand?: PaceBand | null;
  /** Total attempts, including the first. Defaults to two (one corrected retry). */
  attempts?: number;
};

export const MAX_SCORING_ATTEMPTS = 2;

/** Parses a JSON object even when the model wraps it in prose or a code fence. */
export function parseJsonObject(text: string): unknown | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
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

function retryMessage(reason: string, paceLabel: string | null): string {
  return `That reply could not be used because ${reason}. Reply again with ONLY the JSON object from the system prompt: a 0-100 contentScore, a 0-100 deliveryScore judged holistically from the evidence${
    paceLabel ? `, 3-5 sentences of feedback that name the pace exactly "${paceLabel}"` : ""
  }, and 2-3 strengths plus 2-3 improvements.`;
}

/**
 * Asks the model for content and delivery scores and validates the reply. One
 * corrective retry on an unusable reply; no fabricated fallback scores. On the final
 * attempt a reply that only misnames the pace is accepted, because the prompt already
 * carries the correct label and losing a whole take over one adjective is worse.
 */
export async function rateAnswer(options: RateAnswerOptions): Promise<RateAnswerResult> {
  const messages = [...options.messages];
  const attemptLimit = Math.max(1, options.attempts ?? MAX_SCORING_ATTEMPTS);
  const paceLabel = options.paceBand?.label ?? null;
  let lastReason = "no reply was produced";

  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    const text = await options.requestCompletion(messages);
    const parsed = parseJsonObject(text);
    const validation =
      parsed === null ? null : normalizeRating(parsed, { paceBand: options.paceBand });

    if (validation?.ok) return { ok: true, value: validation.value, attempts: attempt };

    const reason = validation ? validation.reason : "the reply was not valid JSON";
    lastReason = reason;

    if (
      attempt === attemptLimit &&
      parsed !== null &&
      validation !== null &&
      !validation.ok &&
      validation.code === "pace-label"
    ) {
      const relaxed = normalizeRating(parsed);
      if (relaxed.ok) return { ok: true, value: relaxed.value, attempts: attempt };
    }

    if (attempt < attemptLimit) {
      messages.push({ role: "assistant", content: text || "(empty reply)" });
      messages.push({ role: "user", content: retryMessage(reason, paceLabel) });
    }
  }

  return { ok: false, reason: lastReason, attempts: attemptLimit };
}
