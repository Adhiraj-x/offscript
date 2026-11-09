import {
  GROQ_SCORING_MODEL,
  GROQ_SCORING_FALLBACK_MODEL,
  SCORING_INITIAL_MAX_COMPLETION_TOKENS,
  SCORING_RETRY_MAX_COMPLETION_TOKENS,
  SCORING_REASONING_EFFORT,
  SCORING_TEMPERATURE,
} from "./groq";
import { normalizeRating, type PaceBand, type RatedAnswer } from "./scoring";

/**
 * The scoring request loop, kept out of the route so the retry behaviour can be
 * tested with a mocked model.
 */

export type ConversationMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type CompletionFn = (messages: ConversationMessage[]) => Promise<string>;

export type ModelCompletionCall = {
  model: string;
  messages: ConversationMessage[];
  temperature: number;
  maxCompletionTokens: number;
  reasoningEffort: "low" | "medium" | "high";
};

export type ModelCompletionFn = (call: ModelCompletionCall) => Promise<string>;

export type ScoringLogEvent = {
  type: "token_retry" | "fallback" | "validation_retry" | "success" | "error";
  model: string;
  message: string;
  details?: Record<string, unknown>;
};

export type RateAnswerResult =
  | {
      ok: true;
      value: RatedAnswer;
      attempts: number;
      modelUsed: string;
      tokenRetries: number;
      fallbackUsed: boolean;
    }
  | {
      ok: false;
      reason: string;
      attempts: number;
      modelUsed?: string;
      tokenRetries: number;
      fallbackUsed: boolean;
    };

export type RateAnswerOptions = {
  messages: ConversationMessage[];
  /** Optional completion function supporting model and token budget configuration */
  executeCompletion?: ModelCompletionFn;
  /** Legacy completion function for backwards compatibility with tests */
  requestCompletion?: CompletionFn;
  /** Measured pace band, used only to keep the feedback's wording consistent. */
  paceBand?: PaceBand | null;
  /** Primary scoring model identifier. Defaults to GROQ_SCORING_MODEL. */
  primaryModel?: string;
  /** Fallback scoring model identifier. Defaults to GROQ_SCORING_FALLBACK_MODEL. */
  fallbackModel?: string;
  /** Total conversational JSON correction attempts per model. Defaults to two. */
  attempts?: number;
  /** Optional telemetry/logging callback. */
  onLog?: (event: ScoringLogEvent) => void;
};

export const MAX_SCORING_ATTEMPTS = 2;

/**
 * Detects whether an upstream API error is specifically Groq's completion-token exhaustion
 * in JSON mode (400 json_validate_failed: max completion tokens reached before generating a valid document).
 * Unrelated 400 errors, 429 rate limits, and 500 server errors strictly return false.
 */
export function isTokenExhaustionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const errObj = error as Record<string, unknown>;
  const status =
    typeof errObj.status === "number"
      ? errObj.status
      : typeof errObj.statusCode === "number"
        ? errObj.statusCode
        : undefined;

  // Never treat 429 rate limit or 5xx server errors as token exhaustion
  if (status !== undefined && status !== 400 && status !== 422) {
    return false;
  }

  const code = String(errObj.code ?? "");
  const message = String(errObj.message ?? "").toLowerCase();

  const nestedError =
    errObj.error && typeof errObj.error === "object"
      ? (errObj.error as Record<string, unknown>)
      : undefined;

  const nestedCode = String(nestedError?.code ?? "");
  const nestedMessage = String(nestedError?.message ?? "").toLowerCase();

  const hasJsonValidateCode =
    code === "json_validate_failed" || nestedCode === "json_validate_failed";

  const hasTokenExhaustionMessage =
    message.includes("max completion tokens") ||
    message.includes("max_completion_tokens") ||
    message.includes("tokens reached before generating a valid document") ||
    nestedMessage.includes("max completion tokens") ||
    nestedMessage.includes("max_completion_tokens") ||
    nestedMessage.includes("tokens reached before generating a valid document");

  const messageContainsBoth =
    message.includes("json_validate_failed") &&
    (message.includes("max completion tokens") || message.includes("tokens reached"));

  return (hasJsonValidateCode && hasTokenExhaustionMessage) || messageContainsBoth;
}

export function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number") return statusCode;
  }
  return undefined;
}

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
 * Asks the model for content and delivery scores, manages targeted completion-token
 * recovery (4096 -> 8192 tokens), fallback model switching if primary fails,
 * and validates the reply with conversational JSON correction.
 */
export async function rateAnswer(options: RateAnswerOptions): Promise<RateAnswerResult> {
  const messages = [...options.messages];
  const attemptLimit = Math.max(1, options.attempts ?? MAX_SCORING_ATTEMPTS);
  const paceLabel = options.paceBand?.label ?? null;
  const primaryModel = options.primaryModel || GROQ_SCORING_MODEL;
  const fallbackModel = options.fallbackModel || GROQ_SCORING_FALLBACK_MODEL;

  const execute: ModelCompletionFn =
    options.executeCompletion ??
    (options.requestCompletion
      ? async (call: ModelCompletionCall) => options.requestCompletion!(call.messages)
      : null as unknown as ModelCompletionFn);

  if (!execute) {
    throw new Error("rateAnswer requires either executeCompletion or requestCompletion.");
  }

  // Helper: Executes completion with single targeted token exhaustion retry (4096 -> 8192)
  async function callModelWithTokenBudget(
    model: string,
    msgs: ConversationMessage[]
  ): Promise<{ text: string; tokenRetried: boolean }> {
    try {
      const text = await execute({
        model,
        messages: msgs,
        temperature: SCORING_TEMPERATURE,
        maxCompletionTokens: SCORING_INITIAL_MAX_COMPLETION_TOKENS, // 4096
        reasoningEffort: SCORING_REASONING_EFFORT, // "medium"
      });
      return { text, tokenRetried: false };
    } catch (err) {
      if (isTokenExhaustionError(err)) {
        options.onLog?.({
          type: "token_retry",
          model,
          message: `Token limit exhausted at ${SCORING_INITIAL_MAX_COMPLETION_TOKENS}. Retrying once with ${SCORING_RETRY_MAX_COMPLETION_TOKENS} tokens.`,
          details: { error: String(err) },
        });
        const text = await execute({
          model,
          messages: msgs,
          temperature: SCORING_TEMPERATURE,
          maxCompletionTokens: SCORING_RETRY_MAX_COMPLETION_TOKENS, // 8192
          reasoningEffort: SCORING_REASONING_EFFORT, // "medium"
        });
        return { text, tokenRetried: true };
      }
      throw err;
    }
  }

  // Helper: Manages conversational JSON validation retry loop on a given model
  async function attemptScoringOnModel(
    model: string,
    initialMessages: ConversationMessage[]
  ): Promise<{
    ok: true;
    value: RatedAnswer;
    attempts: number;
    tokenRetries: number;
  } | {
    ok: false;
    reason: string;
    attempts: number;
    tokenRetries: number;
    fatalError?: unknown;
  }> {
    const conversation = [...initialMessages];
    let totalTokenRetries = 0;
    let lastReason = "no reply was produced";

    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
      let text: string;
      try {
        const res = await callModelWithTokenBudget(model, conversation);
        text = res.text;
        if (res.tokenRetried) totalTokenRetries += 1;
      } catch (err) {
        return {
          ok: false,
          reason: `Completion call failed: ${err instanceof Error ? err.message : String(err)}`,
          attempts: attempt,
          tokenRetries: totalTokenRetries,
          fatalError: err,
        };
      }

      const parsed = parseJsonObject(text);
      const validation =
        parsed === null ? null : normalizeRating(parsed, { paceBand: options.paceBand });

      if (validation?.ok) {
        return {
          ok: true,
          value: validation.value,
          attempts: attempt,
          tokenRetries: totalTokenRetries,
        };
      }

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
        if (relaxed.ok) {
          return {
            ok: true,
            value: relaxed.value,
            attempts: attempt,
            tokenRetries: totalTokenRetries,
          };
        }
      }

      if (attempt < attemptLimit) {
        options.onLog?.({
          type: "validation_retry",
          model,
          message: `Unusable reply on attempt ${attempt} (${reason}). Requesting correction.`,
        });
        conversation.push({ role: "assistant", content: text || "(empty reply)" });
        conversation.push({ role: "user", content: retryMessage(reason, paceLabel) });
      }
    }

    return {
      ok: false,
      reason: lastReason,
      attempts: attemptLimit,
      tokenRetries: totalTokenRetries,
    };
  }

  // 1. Attempt scoring with primary model
  let primaryResult: Awaited<ReturnType<typeof attemptScoringOnModel>>;
  try {
    primaryResult = await attemptScoringOnModel(primaryModel, messages);
  } catch (err) {
    if (statusOf(err) === 429) throw err;
    if (statusOf(err) === 400 && !isTokenExhaustionError(err)) throw err;
    primaryResult = {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      attempts: 1,
      tokenRetries: 0,
      fatalError: err,
    };
  }

  // If primary model encountered fatal 429 or unrelated 400, propagate immediately
  if (!primaryResult.ok && primaryResult.fatalError) {
    const err = primaryResult.fatalError;
    if (statusOf(err) === 429) throw err;
    if (statusOf(err) === 400 && !isTokenExhaustionError(err)) throw err;
  }

  // If primary succeeded, return result immediately
  if (primaryResult.ok) {
    return {
      ok: true,
      value: primaryResult.value,
      attempts: primaryResult.attempts,
      modelUsed: primaryModel,
      tokenRetries: primaryResult.tokenRetries,
      fallbackUsed: false,
    };
  }

  // 2. If primary model failed and fallback model is configured and different, attempt fallback model
  const canFallback =
    Boolean(fallbackModel) &&
    fallbackModel !== primaryModel &&
    Boolean(options.executeCompletion);

  if (canFallback) {
    options.onLog?.({
      type: "fallback",
      model: fallbackModel!,
      message: `Primary model (${primaryModel}) failed: ${primaryResult.reason}. Attempting fallback model (${fallbackModel}).`,
    });

    try {
      const fallbackResult = await attemptScoringOnModel(fallbackModel!, messages);

      if (!fallbackResult.ok && fallbackResult.fatalError) {
        const err = fallbackResult.fatalError;
        if (statusOf(err) === 429) throw err;
        if (statusOf(err) === 400 && !isTokenExhaustionError(err)) throw err;
      }

      if (fallbackResult.ok) {
        return {
          ok: true,
          value: fallbackResult.value,
          attempts: primaryResult.attempts + fallbackResult.attempts,
          modelUsed: fallbackModel!,
          tokenRetries: primaryResult.tokenRetries + fallbackResult.tokenRetries,
          fallbackUsed: true,
        };
      }

      return {
        ok: false,
        reason: `Primary model (${primaryModel}) failed: ${primaryResult.reason}. Fallback model (${fallbackModel}) failed: ${fallbackResult.reason}`,
        attempts: primaryResult.attempts + fallbackResult.attempts,
        modelUsed: fallbackModel!,
        tokenRetries: primaryResult.tokenRetries + fallbackResult.tokenRetries,
        fallbackUsed: true,
      };
    } catch (fbErr) {
      if (statusOf(fbErr) === 429) throw fbErr;
      if (statusOf(fbErr) === 400 && !isTokenExhaustionError(fbErr)) throw fbErr;
      return {
        ok: false,
        reason: `Primary model (${primaryModel}) failed: ${primaryResult.reason}. Fallback model (${fallbackModel}) error: ${fbErr instanceof Error ? fbErr.message : String(fbErr)}`,
        attempts: primaryResult.attempts + 1,
        modelUsed: fallbackModel!,
        tokenRetries: primaryResult.tokenRetries,
        fallbackUsed: true,
      };
    }
  }

  // Fallback not available or same model; return primary failure
  return {
    ok: false,
    reason: primaryResult.reason,
    attempts: primaryResult.attempts,
    modelUsed: primaryModel,
    tokenRetries: primaryResult.tokenRetries,
    fallbackUsed: false,
  };
}
