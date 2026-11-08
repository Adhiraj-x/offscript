import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTranscriptionRequest,
  TRANSCRIBE_MODEL,
  VERBATIM_TRANSCRIPTION_PROMPT,
} from "../lib/transcription";

test("primary transcription request keeps the Sprint 01 configuration", () => {
  const request = buildTranscriptionRequest(true);

  assert.equal(request.model, "whisper-large-v3-turbo");
  assert.equal(request.model, TRANSCRIBE_MODEL);
  assert.equal(request.response_format, "verbose_json");
  assert.equal(request.language, "en");
  assert.equal(request.temperature, 0);
  assert.deepEqual(request.timestamp_granularities, ["word", "segment"]);
  assert.equal(request.prompt, VERBATIM_TRANSCRIPTION_PROMPT);
});

test("fallback request drops timestamps but keeps the model, language and prompt", () => {
  const primary = buildTranscriptionRequest(true);
  const fallback = buildTranscriptionRequest(false);

  assert.equal(fallback.timestamp_granularities, undefined);
  assert.equal(fallback.model, primary.model);
  assert.equal(fallback.language, primary.language);
  assert.equal(fallback.response_format, "verbose_json");
  assert.equal(fallback.prompt, VERBATIM_TRANSCRIPTION_PROMPT);
});

test("the prompt primes hesitations as lexical context only", () => {
  const prompt = VERBATIM_TRANSCRIPTION_PROMPT.toLowerCase();

  for (const term of ["um", "uh", "erm", "er", "ah", "hmm", "like", "so", "well", "you know"]) {
    assert.ok(prompt.includes(term), `prompt should mention ${term}`);
  }

  // Whisper decodes the prompt as preceding text: sentence punctuation and newlines
  // make it look like speakable content that the decoder can reproduce.
  assert.ok(!/[.!?](\s|$)/.test(VERBATIM_TRANSCRIPTION_PROMPT), "prompt must not contain sentences");
  assert.ok(!VERBATIM_TRANSCRIPTION_PROMPT.includes("\n"), "prompt must stay on one line");
  assert.ok(
    VERBATIM_TRANSCRIPTION_PROMPT.split(/\s+/).length <= 30,
    "prompt must stay short enough to behave as context",
  );
});

test("prompt leakage regression: no instruction sentences remain in the prompt", () => {
  const prompt = VERBATIM_TRANSCRIPTION_PROMPT.toLowerCase();

  // The exact sentence that leaked into a real transcript, plus the other
  // instruction phrases from the previous prompt.
  for (const phrase of [
    "never insert words that were not spoken",
    "never insert words",
    "do not clean up",
    "produce a faithful",
    "preserve all audible",
    "this is a spontaneous",
    "include these only when",
  ]) {
    assert.ok(!prompt.includes(phrase), `prompt must not contain "${phrase}"`);
  }

  for (const imperative of ["never", "do not", "must", "include", "produce", "preserve"]) {
    assert.ok(!prompt.includes(imperative), `prompt must not instruct: ${imperative}`);
  }
});
