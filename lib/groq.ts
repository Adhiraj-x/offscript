/** Shared Groq client config for the API routes. */

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * Groq retired `llama-3.3-70b-versatile`, so the default is the current JSON-mode
 * flag model. Pin a different one with GROQ_CHAT_MODEL if the catalog moves again.
 */
export const GROQ_CHAT_MODEL = process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b";
