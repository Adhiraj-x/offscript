import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SCORING_ATTEMPTS,
  parseJsonObject,
  rateAnswer,
  type ConversationMessage,
} from "../lib/rateAnswer";
import { classifyPace } from "../lib/scoring";

const messages: ConversationMessage[] = [
  { role: "system", content: "system prompt" },
  { role: "user", content: "score this take" },
];

const validReply = {
  contentScore: 70,
  deliveryScore: 42,
  overallScore: 100,
  feedback:
    "You made one clear point about bus reliability and kept returning to it, but the pace stayed slow and the pauses broke up the middle section.",
  strengths: ["Clear central claim", "Concrete example about the wait time"],
  improvements: ["Pick the pace up in the opening", "Cut the repeated summary at the end"],
};

const validJson = JSON.stringify(validReply);

test("a valid first reply is accepted without a retry", async () => {
  const calls: ConversationMessage[][] = [];
  const result = await rateAnswer({
    messages,
    requestCompletion: async (conversation) => {
      calls.push(conversation);
      return validJson;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  if (!result.ok) return;
  assert.equal(result.attempts, 1);
  assert.equal(result.value.contentScore, 70);
  assert.equal(result.value.deliveryScore, 42);
  // The model claimed 100 overall; the server applies 60/40 instead.
  assert.equal(result.value.overallScore, 59);
});

test("invalid JSON receives exactly one corrective retry", async () => {
  const calls: ConversationMessage[][] = [];
  const result = await rateAnswer({
    messages,
    requestCompletion: async (conversation) => {
      calls.push([...conversation]);
      return calls.length === 1 ? "not json at all" : validJson;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(MAX_SCORING_ATTEMPTS, 2);
  if (!result.ok) return;
  assert.equal(result.attempts, 2);

  // The second request carries the failed reply plus the correction.
  assert.equal(calls[1].length, 4);
  assert.equal(calls[1][2].role, "assistant");
  assert.equal(calls[1][3].role, "user");
  assert.match(calls[1][3].content, /not valid JSON/i);
  assert.match(calls[1][3].content, /0-100 deliveryScore/);
});

test("two unusable replies fail honestly instead of fabricating scores", async () => {
  let calls = 0;
  const result = await rateAnswer({
    messages,
    requestCompletion: async () => {
      calls += 1;
      return "{}";
    },
  });

  assert.equal(result.ok, false);
  assert.equal(calls, 2);
  if (result.ok) return;
  assert.equal(result.attempts, 2);
  assert.match(result.reason, /contentScore/);
});

test("a missing delivery score is rejected, not defaulted", async () => {
  const result = await rateAnswer({
    messages,
    attempts: 1,
    requestCompletion: async () =>
      JSON.stringify({
        contentScore: 70,
        feedback: validReply.feedback,
        strengths: validReply.strengths,
        improvements: validReply.improvements,
      }),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /deliveryScore/);
});

test("a pace-label mismatch is retried and accepted once corrected", async () => {
  const band = classifyPace(79);
  assert.ok(band);
  if (!band) return;

  let calls = 0;
  const result = await rateAnswer({
    messages,
    paceBand: band,
    requestCompletion: async () => {
      calls += 1;
      return calls === 1
        ? JSON.stringify({
            ...validReply,
            feedback:
              "Your pace was very slow throughout, and the pauses broke the middle section up badly.",
          })
        : JSON.stringify({
            ...validReply,
            feedback:
              "Your pace was slow throughout, and the pauses broke the middle section up badly.",
          });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  if (!result.ok) return;
  assert.equal(result.attempts, 2);
  assert.equal(result.value.deliveryScore, 42);
});

test("a final reply that only misnames the pace is kept rather than losing the take", async () => {
  const band = classifyPace(79);
  assert.ok(band);
  if (!band) return;

  const result = await rateAnswer({
    messages,
    paceBand: band,
    requestCompletion: async () =>
      JSON.stringify({
        ...validReply,
        feedback:
          "Your pace was very slow throughout, and the pauses broke the middle section up badly.",
      }),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.attempts, 2);
  assert.equal(result.value.deliveryScore, 42);
  assert.equal(result.value.overallScore, 59);
});

test("parseJsonObject accepts fenced and embedded objects", () => {
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonObject('Here you go: {"a":1} — done.'), { a: 1 });
  assert.equal(parseJsonObject("no object here"), null);
});
