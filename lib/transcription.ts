/**
 * Groq Whisper request configuration, kept in one place so the shape can be tested
 * without making an API call.
 *
 * `prompt` is decoded as if it were the text immediately before the recording, not
 * read as an instruction. Two consequences:
 * - Imperative sentences ("Never insert words that were not spoken.") can be echoed
 *   into the transcript as if the speaker had said them. Real testing produced that
 *   exact sentence in a transcript, so the prompt is now lexical only: a short list
 *   of hesitations, no commands and no sentence structure to copy.
 * - It can only bias the decoder towards keeping fillers; it cannot guarantee them.
 *   See the audio verification procedure in the README before trusting filler counts.
 */

export const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
export const TRANSCRIBE_LANGUAGE = "en";
export const TRANSCRIBE_TEMPERATURE = 0;

/**
 * Lexical priming for verbatim-style decoding. Kept as a hesitation list rather than
 * instructions: Whisper treats this as preceding transcript text, and a distinctive
 * instruction sentence is reproducible output. Deliberately short.
 */
export const VERBATIM_TRANSCRIPTION_PROMPT =
  "Um, uh, erm, er, ah, hmm, so, like, well, I mean, you know, sort of, kind of";

export type TimestampGranularityRequest = Array<"word" | "segment">;

export type TranscriptionRequest = {
  model: string;
  response_format: "verbose_json";
  language: string;
  temperature: number;
  prompt: string;
  timestamp_granularities?: TimestampGranularityRequest;
};

/**
 * Word + segment timestamps are the primary request. The fallback keeps the model,
 * language and lexical prime and drops only the granularity request, which is the
 * parameter older deployments reject.
 */
export function buildTranscriptionRequest(withTimestamps: boolean): TranscriptionRequest {
  return {
    model: TRANSCRIBE_MODEL,
    response_format: "verbose_json",
    language: TRANSCRIBE_LANGUAGE,
    temperature: TRANSCRIBE_TEMPERATURE,
    prompt: VERBATIM_TRANSCRIPTION_PROMPT,
    ...(withTimestamps
      ? { timestamp_granularities: ["word", "segment"] as TimestampGranularityRequest }
      : {}),
  };
}
