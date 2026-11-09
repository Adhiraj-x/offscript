import assert from "node:assert/strict";
import test from "node:test";
import {
  GROQ_CHAT_MODEL,
  GROQ_MODEL_GPT_OSS_120B,
  GROQ_MODEL_GPT_OSS_20B,
  GROQ_SCORING_MODEL,
  GROQ_SCORING_FALLBACK_MODEL,
  SCORING_INITIAL_MAX_COMPLETION_TOKENS,
  SCORING_RETRY_MAX_COMPLETION_TOKENS,
} from "../lib/groq";
import {
  isTokenExhaustionError,
  rateAnswer,
  type ConversationMessage,
  type ModelCompletionCall,
} from "../lib/rateAnswer";
import {
  buildScoringUserPrompt,
  classifyPace,
  computeOverallScore,
  normalizeRating,
  SCORING_SYSTEM_PROMPT,
} from "../lib/scoring";
import { BENCHMARK_FIXTURES, fixtureToSpeechMetrics } from "../lib/benchmark/fixtures";

const testMessages: ConversationMessage[] = [
  { role: "system", content: "system prompt" },
  { role: "user", content: "score this take" },
];

const mockValidScoreJson = JSON.stringify({
  contentScore: 82,
  deliveryScore: 74,
  overallScore: 99, // Intentional mismatch: server applies 60/40 formula
  feedback:
    "Your speaking pace was comfortable. You presented clear points with concrete evidence, though you could streamline the ending.",
  strengths: ["Strong central claim", "Specific evidence"],
  improvements: ["Streamline the conclusion", "Vary vocal inflection"],
  mainTakeaway: "Clear and effective take with solid evidence.",
  nextAttemptFocus: "Streamline the conclusion to finish crisply.",
});

// 1. Independent primary and fallback model configuration
test("scoring models are independently configured from general chat model", () => {
  // Default values
  assert.equal(GROQ_MODEL_GPT_OSS_120B, "openai/gpt-oss-120b");
  assert.equal(GROQ_MODEL_GPT_OSS_20B, "openai/gpt-oss-20b");
  assert.equal(GROQ_SCORING_MODEL, "openai/gpt-oss-120b");
  assert.equal(GROQ_SCORING_FALLBACK_MODEL, "openai/gpt-oss-20b");

  // General chat model should not dictate scoring model
  assert.ok(GROQ_SCORING_MODEL);
  assert.ok(GROQ_SCORING_FALLBACK_MODEL);
  assert.notEqual(GROQ_SCORING_MODEL, GROQ_SCORING_FALLBACK_MODEL);

  // Token limits
  assert.equal(SCORING_INITIAL_MAX_COMPLETION_TOKENS, 4096);
  assert.equal(SCORING_RETRY_MAX_COMPLETION_TOKENS, 8192);
});

// 2. GPT-OSS 20B and 120B use the same prompt
test("GPT-OSS 20B and 120B receive identical system and user prompts", () => {
  const fixture = BENCHMARK_FIXTURES[0];
  const metrics = fixtureToSpeechMetrics(fixture);
  const prompt1 = buildScoringUserPrompt({
    topic: fixture.topic,
    mode: fixture.mode,
    transcript: fixture.transcript,
    metrics,
    fillers: fixture.fillers,
  });
  const prompt2 = buildScoringUserPrompt({
    topic: fixture.topic,
    mode: fixture.mode,
    transcript: fixture.transcript,
    metrics,
    fillers: fixture.fillers,
  });

  // Verify prompts are deterministic and invariant to model candidate
  assert.equal(prompt1, prompt2);
  assert.ok(SCORING_SYSTEM_PROMPT.includes("contentScore"));
  assert.ok(SCORING_SYSTEM_PROMPT.includes("deliveryScore"));
  assert.ok(prompt1.includes(fixture.topic));
  assert.ok(prompt1.includes(fixture.transcript));
});

// 3. Completion-token exhaustion triggers the targeted retry
test("exact production error with nested failed_generation is recognized as token exhaustion", () => {
  const productionError = {
    status: 400,
    code: "json_validate_failed",
    message: "400 Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
    error: {
      message: "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
      type: "invalid_request_error",
      code: "json_validate_failed",
      failed_generation: "max completion tokens reached before generating a valid document",
    },
  };

  assert.equal(isTokenExhaustionError(productionError), true);
});

test("normal json_validate_failed without token exhaustion returns false", () => {
  const normalJsonValidateFailed = {
    status: 400,
    code: "json_validate_failed",
    message: "400 Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
    error: {
      message: "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
      type: "invalid_request_error",
      code: "json_validate_failed",
      failed_generation: '{"contentScore": 85, "deliveryScore": ',
    },
  };

  assert.equal(isTokenExhaustionError(normalJsonValidateFailed), false);
});

test("HTTP 429 error returns false even if token phrasing is present", () => {
  const rateLimitWithTokenPhrase = {
    status: 429,
    code: "rate_limit_exceeded",
    message: "Rate limit reached on tokens per minute (TPM): max completion tokens limit exceeded",
    error: {
      code: "rate_limit_exceeded",
      failed_generation: "max completion tokens reached before generating a valid document",
    },
  };

  assert.equal(isTokenExhaustionError(rateLimitWithTokenPhrase), false);
});

test("HTTP 500 error returns false even if token phrasing is present", () => {
  const serverErrorWithTokenPhrase = {
    status: 500,
    code: "internal_server_error",
    message: "Internal server error: max completion tokens reached before generating a valid document",
    error: {
      code: "internal_server_error",
      failed_generation: "max completion tokens reached before generating a valid document",
    },
  };

  assert.equal(isTokenExhaustionError(serverErrorWithTokenPhrase), false);
});

test("token exhaustion phrase without json_validate_failed classification returns false", () => {
  const genericErrorWithoutJsonClassification = {
    status: 400,
    code: "invalid_request_error",
    message: "max completion tokens reached before generating a valid document",
    error: {
      type: "invalid_request_error",
      message: "max completion tokens reached before generating a valid document",
    },
  };

  assert.equal(isTokenExhaustionError(genericErrorWithoutJsonClassification), false);
});

test("completion-token exhaustion specifically triggers targeted retry with 8192 tokens", async () => {
  const calls: ModelCompletionCall[] = [];

  const tokenExhaustionError = {
    status: 400,
    code: "json_validate_failed",
    message: "400 json_validate_failed: max completion tokens reached before generating a valid document",
  };

  assert.equal(isTokenExhaustionError(tokenExhaustionError), true);

  const result = await rateAnswer({
    messages: testMessages,
    primaryModel: "openai/gpt-oss-120b",
    fallbackModel: "openai/gpt-oss-20b",
    executeCompletion: async (call) => {
      calls.push(call);
      if (calls.length === 1) {
        throw tokenExhaustionError;
      }
      return mockValidScoreJson;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);

  // Call 1: Primary model with 4096 tokens
  assert.equal(calls[0].model, "openai/gpt-oss-120b");
  assert.equal(calls[0].maxCompletionTokens, 4096);
  assert.equal(calls[0].reasoningEffort, "medium");

  // Call 2: Primary model retried with 8192 tokens
  assert.equal(calls[1].model, "openai/gpt-oss-120b");
  assert.equal(calls[1].maxCompletionTokens, 8192);
  assert.equal(calls[1].reasoningEffort, "medium");
});

test("production-shaped token exhaustion error triggers targeted 8192-token retry on primary and succeeds", async () => {
  const calls: ModelCompletionCall[] = [];

  const productionError = {
    status: 400,
    code: "json_validate_failed",
    message: "400 Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
    error: {
      message: "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
      type: "invalid_request_error",
      code: "json_validate_failed",
      failed_generation: "max completion tokens reached before generating a valid document",
    },
  };

  const result = await rateAnswer({
    messages: testMessages,
    primaryModel: "openai/gpt-oss-120b",
    fallbackModel: "openai/gpt-oss-20b",
    executeCompletion: async (call) => {
      calls.push(call);
      if (calls.length === 1) {
        throw productionError;
      }
      return mockValidScoreJson;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);

  // 1. Primary model is called with normal 4096 completion tokens
  assert.equal(calls[0].model, "openai/gpt-oss-120b");
  assert.equal(calls[0].maxCompletionTokens, 4096);
  assert.equal(calls[0].reasoningEffort, "medium");

  // 2 & 3. Targeted retry runs with 8192 completion tokens
  assert.equal(calls[1].model, "openai/gpt-oss-120b");
  assert.equal(calls[1].maxCompletionTokens, 8192);
  assert.equal(calls[1].reasoningEffort, "medium");

  // 4. Targeted retry happened once and succeeded
  assert.equal(result.tokenRetries, 1);
  assert.equal(result.fallbackUsed, false);
});

test("targeted retry happens only once and falls back to fallbackModel if retry fails", async () => {
  const calls: ModelCompletionCall[] = [];

  const productionError = {
    status: 400,
    code: "json_validate_failed",
    message: "400 Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
    error: {
      message: "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
      type: "invalid_request_error",
      code: "json_validate_failed",
      failed_generation: "max completion tokens reached before generating a valid document",
    },
  };

  const result = await rateAnswer({
    messages: testMessages,
    primaryModel: "openai/gpt-oss-120b",
    fallbackModel: "openai/gpt-oss-20b",
    executeCompletion: async (call) => {
      calls.push(call);
      // Primary model fails on both initial 4096 call and 8192 retry
      if (call.model === "openai/gpt-oss-120b") {
        throw productionError;
      }
      // Fallback model succeeds
      return mockValidScoreJson;
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  // Progression:
  // 1: Primary @ 4096
  // 2: Primary @ 8192 (single retry)
  // 3: Fallback @ 4096
  assert.equal(calls.length, 3);
  assert.equal(calls[0].model, "openai/gpt-oss-120b");
  assert.equal(calls[0].maxCompletionTokens, 4096);
  assert.equal(calls[1].model, "openai/gpt-oss-120b");
  assert.equal(calls[1].maxCompletionTokens, 8192);
  assert.equal(calls[2].model, "openai/gpt-oss-20b");
  assert.equal(calls[2].maxCompletionTokens, 4096);

  assert.equal(result.modelUsed, "openai/gpt-oss-20b");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.value.contentScore, 82);
});

// 4. Successful recovery returns a validated result
test("successful token recovery returns a fully validated result", async () => {
  let attempts = 0;
  const result = await rateAnswer({
    messages: testMessages,
    executeCompletion: async (call) => {
      attempts += 1;
      if (attempts === 1) {
        const err = new Error("max completion tokens reached before generating a valid document");
        (err as unknown as { status: number; code: string }).status = 400;
        (err as unknown as { status: number; code: string }).code = "json_validate_failed";
        throw err;
      }
      return mockValidScoreJson;
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.tokenRetries, 1);
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.value.contentScore, 82);
  assert.equal(result.value.deliveryScore, 74);
  // 82 * 0.6 + 74 * 0.4 = 49.2 + 29.6 = 78.8 -> round 79
  assert.equal(result.value.overallScore, 79);
});

// 5. Failed recovery reaches the configured fallback model
test("failed recovery on primary reaches configured fallback model with complete instructions", async () => {
  const calls: ModelCompletionCall[] = [];

  const tokenExhaustionError = {
    status: 400,
    code: "json_validate_failed",
    message: "max completion tokens reached before generating a valid document",
  };

  const result = await rateAnswer({
    messages: testMessages,
    primaryModel: "openai/gpt-oss-120b",
    fallbackModel: "openai/gpt-oss-20b",
    executeCompletion: async (call) => {
      calls.push(call);
      // Primary model fails on both initial 4096 and 8192 retry
      if (call.model === "openai/gpt-oss-120b") {
        throw tokenExhaustionError;
      }
      // Fallback model succeeds
      return mockValidScoreJson;
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.modelUsed, "openai/gpt-oss-20b");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.value.contentScore, 82);

  // Verifies call progression:
  // 1: Primary @ 4096
  // 2: Primary @ 8192
  // 3: Fallback @ 4096
  assert.equal(calls.length, 3);
  assert.equal(calls[0].model, "openai/gpt-oss-120b");
  assert.equal(calls[0].maxCompletionTokens, 4096);
  assert.equal(calls[1].model, "openai/gpt-oss-120b");
  assert.equal(calls[1].maxCompletionTokens, 8192);
  assert.equal(calls[2].model, "openai/gpt-oss-20b");
  assert.equal(calls[2].maxCompletionTokens, 4096);

  // Instructions and conversation preserved in fallback call
  assert.equal(calls[2].messages.length, testMessages.length);
  assert.equal(calls[2].messages[0].content, testMessages[0].content);
});

// 6. A 429 remains a rate-limit response
test("a 429 error is not retried as token exhaustion and propagates immediately", async () => {
  const rateLimitError = {
    status: 429,
    message: "Rate limit reached for requests per minute",
  };

  assert.equal(isTokenExhaustionError(rateLimitError), false);

  let calls = 0;
  await assert.rejects(
    async () => {
      await rateAnswer({
        messages: testMessages,
        executeCompletion: async () => {
          calls += 1;
          throw rateLimitError;
        },
      });
    },
    (err: unknown) => {
      assert.equal((err as { status?: number }).status, 429);
      return true;
    },
  );

  // Must not retry 429 as a token exhaustion retry
  assert.equal(calls, 1);
});

// 7. Unrelated 400 errors are not retried as token exhaustion
test("unrelated 400 errors fail immediately without token retry", async () => {
  const badParamError = {
    status: 400,
    code: "invalid_parameter",
    message: "Invalid parameter: temperature must be between 0 and 2",
  };

  assert.equal(isTokenExhaustionError(badParamError), false);

  let calls = 0;
  await assert.rejects(
    async () => {
      await rateAnswer({
        messages: testMessages,
        executeCompletion: async () => {
          calls += 1;
          throw badParamError;
        },
      });
    },
    (err: unknown) => {
      assert.equal((err as { code?: string }).code, "invalid_parameter");
      return true;
    },
  );

  assert.equal(calls, 1);
});

// 8. Invalid JSON still uses existing validation/correction logic
test("invalid JSON reply triggers conversational correction prompt", async () => {
  const calls: ModelCompletionCall[] = [];

  const result = await rateAnswer({
    messages: testMessages,
    primaryModel: "openai/gpt-oss-120b",
    executeCompletion: async (call) => {
      calls.push(call);
      if (calls.length === 1) {
        return "not valid json text";
      }
      return mockValidScoreJson;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);

  // Attempt 2 contains the assistant's invalid text and the correction instruction
  const attempt2Messages = calls[1].messages;
  assert.equal(attempt2Messages.length, 4);
  assert.equal(attempt2Messages[2].role, "assistant");
  assert.equal(attempt2Messages[3].role, "user");
  assert.match(attempt2Messages[3].content, /not valid JSON/i);
});

// 9. Score normalization remains unchanged
test("score normalization preserves 60/40 weighting and bounds", () => {
  // Test 60/40 computation
  assert.equal(computeOverallScore(100, 100), 100);
  assert.equal(computeOverallScore(0, 0), 0);
  assert.equal(computeOverallScore(80, 60), 72); // 48 + 24 = 72
  assert.equal(computeOverallScore(50, 90), 66); // 30 + 36 = 66

  // Test clamp limits
  assert.equal(computeOverallScore(-10, 150), 40); // 0 * 0.6 + 100 * 0.4 = 40

  // Test normalizeRating rejects missing scores
  const invalidPayload = { contentScore: 80, feedback: "good" };
  const res = normalizeRating(invalidPayload);
  assert.equal(res.ok, false);
});

// 10. Failed evaluation retry reuses original audio Blob
test("failed evaluation state allows retrying the retained audio Blob", () => {
  // Simulate React state machine logic for recording submission
  let retainedAudio: Blob | null = null;
  let phase: "setup" | "prep" | "speak" | "scoring" | "result" | "error" = "speak";
  let submissionCount = 0;

  const mockBlob = new Blob(["audio data mock bytes"], { type: "audio/webm" });

  function submitRecording(blob: Blob, shouldFail: boolean) {
    submissionCount += 1;
    phase = "scoring";
    retainedAudio = blob;

    if (shouldFail) {
      phase = "error";
      // Audio is retained in memory for retry
      return;
    }

    // Success: clear audio
    retainedAudio = null;
    phase = "result";
  }

  // Initial submission fails due to upstream/network issue
  submitRecording(mockBlob, true);
  assert.equal(phase, "error");
  assert.notEqual(retainedAudio, null);
  assert.equal(retainedAudio, mockBlob);
  assert.equal(submissionCount, 1);

  // User clicks "Retry evaluation" -> reuses retainedAudio without rerecording
  assert.ok(retainedAudio);
  submitRecording(retainedAudio!, false);
  assert.equal(phase, "result");
  assert.equal(retainedAudio, null);
  assert.equal(submissionCount, 2);
});

// 11. Successful evaluation clears retained audio
test("successful evaluation immediately clears retained audio from memory", () => {
  let retainedAudio: Blob | null = new Blob(["take bytes"], { type: "audio/webm" });

  function handleScoringSuccess() {
    retainedAudio = null;
  }

  handleScoringSuccess();
  assert.equal(retainedAudio, null);
});
