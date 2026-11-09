/** Shared Groq client config for the API routes. */

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/** Available Groq model identifiers for scoring and general chat */
export const GROQ_MODEL_GPT_OSS_120B = "openai/gpt-oss-120b";
export const GROQ_MODEL_GPT_OSS_20B = "openai/gpt-oss-20b";

/**
 * General chat / topic-generation fallback model.
 * Pin a different one with GROQ_CHAT_MODEL if needed.
 */
export const GROQ_CHAT_MODEL = process.env.GROQ_CHAT_MODEL || GROQ_MODEL_GPT_OSS_120B;

/**
 * Primary model used to rate speaking takes.
 * Defaults to GPT-OSS 120B until the benchmark evaluation is complete.
 */
export const GROQ_SCORING_MODEL =
  process.env.GROQ_SCORING_MODEL || GROQ_MODEL_GPT_OSS_120B;

/**
 * Fallback model used if the primary scoring model encounters unrecoverable errors.
 */
export const GROQ_SCORING_FALLBACK_MODEL =
  process.env.GROQ_SCORING_FALLBACK_MODEL || GROQ_MODEL_GPT_OSS_20B;

/** Token limits and parameter defaults for scoring requests */
export const SCORING_INITIAL_MAX_COMPLETION_TOKENS = 4096;
export const SCORING_RETRY_MAX_COMPLETION_TOKENS = 8192;
export const SCORING_REASONING_EFFORT = "medium" as const;
export const SCORING_TEMPERATURE = 0.3;
