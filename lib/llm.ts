/**
 * Gemini free tier is for non-sensitive topic generation only.
 * User speech and transcripts go to Groq only.
 */

import OpenAI from "openai";
import { GROQ_BASE_URL, GROQ_CHAT_MODEL } from "./groq";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
export const GEMINI_TIMEOUT_MS = 10_000;
export const GROQ_TIMEOUT_MS = 8_000;

/**
 * Google retires model names often, so this must come from the environment.
 * The default only covers a fresh checkout that hasn't set the var yet.
 */
export const GEMINI_TOPIC_MODEL = process.env.GEMINI_TOPIC_MODEL || "gemini-3.5-flash-lite";

export { GROQ_CHAT_MODEL };

/** Gemini through its OpenAI-compatible endpoint. Null when no key is configured. */
export function getGeminiClient(): OpenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: GEMINI_BASE_URL,
    timeout: GEMINI_TIMEOUT_MS,
    maxRetries: 0,
  });
}

/** Groq client (also used as the topic-generation fallback). */
export function getGroqClient(): OpenAI | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: GROQ_BASE_URL,
    timeout: GROQ_TIMEOUT_MS,
    maxRetries: 0,
  });
}
