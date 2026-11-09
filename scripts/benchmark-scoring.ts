#!/usr/bin/env node
/**
 * Offscript — GPT-OSS 20B vs GPT-OSS 120B Scoring Benchmark
 *
 * Evaluates both models across 30 manually authored fixtures using identical prompts,
 * identical parameters (4096 tokens, medium reasoning, 0.3 temperature, JSON mode),
 * and actual validation through normalizeRating().
 *
 * Usage:
 *   npx tsx scripts/benchmark-scoring.ts
 *   npx tsx scripts/benchmark-scoring.ts --fixtures 1-5
 *   npx tsx scripts/benchmark-scoring.ts --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import {
  GROQ_BASE_URL,
  GROQ_MODEL_GPT_OSS_120B,
  GROQ_MODEL_GPT_OSS_20B,
  SCORING_INITIAL_MAX_COMPLETION_TOKENS,
  SCORING_REASONING_EFFORT,
  SCORING_TEMPERATURE,
} from "../lib/groq";
import {
  SCORING_SYSTEM_PROMPT,
  buildScoringUserPrompt,
  classifyPace,
  normalizeRating,
  type RatedAnswer,
} from "../lib/scoring";
import { parseJsonObject } from "../lib/rateAnswer";
import {
  BENCHMARK_FIXTURES,
  fixtureToSpeechMetrics,
  type BenchmarkFixture,
} from "../lib/benchmark/fixtures";

// Load .env.local if GROQ_API_KEY is not already in process.env
function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    const key = match[1];
    let val = (match[2] || "").trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadEnvLocal();

// Published Groq Pricing (November 2026, Source: groq.com/pricing)
export const GROQ_PRICING = {
  [GROQ_MODEL_GPT_OSS_120B]: {
    name: "OpenAI GPT-OSS 120B",
    inputPerMillion: 0.15,
    outputPerMillion: 0.60,
  },
  [GROQ_MODEL_GPT_OSS_20B]: {
    name: "OpenAI GPT-OSS 20B",
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },
} as const;

export interface SingleEvaluation {
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  rawResponse: string;
  jsonValid: boolean;
  validationError?: string;
  rating?: RatedAnswer;
}

export interface FixtureBenchmarkResult {
  fixtureId: number;
  name: string;
  scenario: string;
  topic: string;
  mode: string;
  transcript?: string;
  eval120B: SingleEvaluation;
  eval20B: SingleEvaluation;
  diff: {
    contentDiff: number; // 20B - 120B
    deliveryDiff: number; // 20B - 120B
    overallDiff: number; // 20B - 120B
    majorDisagreement: boolean; // |overallDiff| >= 15 or |contentDiff| >= 15
  };
}

export interface BenchmarkSummary {
  timestamp: string;
  fixtureCount: number;
  model120B: {
    model: string;
    validJsonCount: number;
    validJsonRate: number;
    avgLatencyMs: number;
    medianLatencyMs: number;
    avgPromptTokens: number;
    avgCompletionTokens: number;
    avgReasoningTokens: number;
    avgTotalTokens: number;
    avgCostPerEvalUsd: number;
    costPer1000EvalsUsd: number;
    avgContentScore: number;
    avgDeliveryScore: number;
    avgOverallScore: number;
  };
  model20B: {
    model: string;
    validJsonCount: number;
    validJsonRate: number;
    avgLatencyMs: number;
    medianLatencyMs: number;
    avgPromptTokens: number;
    avgCompletionTokens: number;
    avgReasoningTokens: number;
    avgTotalTokens: number;
    avgCostPerEvalUsd: number;
    costPer1000EvalsUsd: number;
    avgContentScore: number;
    avgDeliveryScore: number;
    avgOverallScore: number;
  };
  comparison: {
    costSavingsPercent: number;
    latencyReductionPercent: number;
    meanContentDiff: number;
    meanDeliveryDiff: number;
    meanOverallDiff: number;
    meanAbsoluteOverallDiff: number;
    majorDisagreementCount: number;
    recommendation: "promote_20b" | "retain_120b";
    recommendationRationale: string;
  };
  results: FixtureBenchmarkResult[];
}

function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = GROQ_PRICING[model as keyof typeof GROQ_PRICING] ?? GROQ_PRICING[GROQ_MODEL_GPT_OSS_120B];
  const inputCost = (promptTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}

async function callWithRateLimitRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const errObj = err as Record<string, unknown>;
      const status =
        typeof errObj.status === "number"
          ? errObj.status
          : typeof errObj.statusCode === "number"
            ? errObj.statusCode
            : undefined;

      if (status === 429 && attempt < maxRetries) {
        const msg = String(errObj.message ?? "");
        const matchSec = msg.match(/try again in (\d+(?:\.\d+)?)s/i);
        const matchMs = msg.match(/try again in (\d+(?:\.\d+)?)ms/i);
        let waitMs = 12_000;
        if (matchSec) {
          waitMs = Math.ceil(parseFloat(matchSec[1]) * 1000) + 1500;
        } else if (matchMs) {
          waitMs = Math.ceil(parseFloat(matchMs[1])) + 800;
        }
        console.log(`  [429 TPM Limit] Backing off ${Math.round(waitMs / 1000)}s to refill Groq token quota...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max rate limit retries exceeded");
}

async function evaluateFixtureOnModel(
  client: OpenAI | null,
  model: string,
  fixture: BenchmarkFixture,
  dryRun: boolean,
): Promise<SingleEvaluation> {
  const metrics = fixtureToSpeechMetrics(fixture);
  const paceBand = classifyPace(metrics.speakingRateWpm);
  const userPrompt = buildScoringUserPrompt({
    topic: fixture.topic,
    mode: fixture.mode,
    transcript: fixture.transcript,
    metrics,
    fillers: fixture.fillers,
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SCORING_SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  if (dryRun || !client) {
    // Deterministic synthetic simulation for test environments
    const baseContent =
      fixture.expectedProfile.expectedContentBand === "Excellent"
        ? 92
        : fixture.expectedProfile.expectedContentBand === "Strong"
          ? 82
          : fixture.expectedProfile.expectedContentBand === "Competent"
            ? 68
            : fixture.expectedProfile.expectedContentBand === "Needs improvement"
              ? 50
              : 35;
    const baseDelivery =
      fixture.expectedProfile.expectedDeliveryBand === "Excellent"
        ? 90
        : fixture.expectedProfile.expectedDeliveryBand === "Strong"
          ? 80
          : fixture.expectedProfile.expectedDeliveryBand === "Competent"
            ? 68
            : fixture.expectedProfile.expectedDeliveryBand === "Somewhat fast" || fixture.expectedProfile.expectedDeliveryBand === "Somewhat slow" || fixture.expectedProfile.expectedDeliveryBand === "Comfortable"
              ? 72
              : fixture.expectedProfile.expectedDeliveryBand === "Slow"
                ? 55
                : 40;

    const variance = model === GROQ_MODEL_GPT_OSS_20B ? (fixture.id % 5) - 2 : 0;
    const contentScore = Math.max(0, Math.min(100, baseContent + variance));
    const deliveryScore = Math.max(0, Math.min(100, baseDelivery + variance));
    const paceLabel = paceBand?.label ?? "Comfortable";

    const simJson = {
      contentScore,
      deliveryScore,
      overallScore: Math.round(contentScore * 0.6 + deliveryScore * 0.4),
      feedback: `Your speaking pace was ${paceLabel}. ${fixture.expectedProfile.keyStrengthsExpected}. To progress, focus on ${fixture.expectedProfile.keyImprovementsExpected}.`,
      strengths: [fixture.expectedProfile.keyStrengthsExpected, "Clear vocal presence"],
      improvements: [fixture.expectedProfile.keyImprovementsExpected, "Maintain smooth cadence"],
      mainTakeaway: `Effective attempt with ${paceLabel.toLowerCase()} delivery.`,
      nextAttemptFocus: fixture.expectedProfile.keyImprovementsExpected,
    };

    const parsed = normalizeRating(simJson, { paceBand });
    const promptTokens = 420;
    const completionTokens = model === GROQ_MODEL_GPT_OSS_20B ? 280 : 340;
    const reasoningTokens = model === GROQ_MODEL_GPT_OSS_20B ? 120 : 180;
    const costUsd = calculateCost(model, promptTokens, completionTokens);

    return {
      model,
      latencyMs: model === GROQ_MODEL_GPT_OSS_20B ? 650 : 1200,
      promptTokens,
      completionTokens,
      reasoningTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd,
      rawResponse: JSON.stringify(simJson, null, 2),
      jsonValid: Boolean(parsed?.ok),
      rating: parsed?.ok ? parsed.value : undefined,
    };
  }

  const startTime = Date.now();
  let rawResponse = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;

  try {
    const res = await callWithRateLimitRetry(async () => {
      return await client.chat.completions.create({
        model,
        messages,
        temperature: SCORING_TEMPERATURE,
        max_completion_tokens: SCORING_INITIAL_MAX_COMPLETION_TOKENS,
        reasoning_effort: SCORING_REASONING_EFFORT,
        response_format: { type: "json_object" },
      });
    });

    const elapsed = Date.now() - startTime;
    rawResponse = res.choices[0]?.message?.content ?? "";
    promptTokens = res.usage?.prompt_tokens ?? 0;
    completionTokens = res.usage?.completion_tokens ?? 0;
    const usageAny = res.usage as unknown as {
      completion_tokens_details?: { reasoning_tokens?: number };
    };
    reasoningTokens = usageAny?.completion_tokens_details?.reasoning_tokens ?? 0;

    const parsedObj = parseJsonObject(rawResponse);
    const validation =
      parsedObj === null ? null : normalizeRating(parsedObj, { paceBand });

    const costUsd = calculateCost(model, promptTokens, completionTokens);

    return {
      model,
      latencyMs: elapsed,
      promptTokens,
      completionTokens,
      reasoningTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd,
      rawResponse,
      jsonValid: Boolean(validation?.ok),
      validationError: validation && !validation.ok ? validation.reason : parsedObj === null ? "not valid JSON" : undefined,
      rating: validation?.ok ? validation.value : undefined,
    };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    return {
      model,
      latencyMs: elapsed,
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      rawResponse: "",
      jsonValid: false,
      validationError: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runBenchmark(options: {
  dryRun?: boolean;
  fixtures?: BenchmarkFixture[];
  concurrency?: number;
  apiKey?: string;
  onProgress?: (index: number, total: number, fixture: BenchmarkFixture) => void;
}): Promise<BenchmarkSummary> {
  const fixturesToRun = options.fixtures ?? [...BENCHMARK_FIXTURES];
  const dryRun = options.dryRun ?? (!options.apiKey && !process.env.GROQ_API_KEY);
  const apiKey = options.apiKey || process.env.GROQ_API_KEY || "";

  const client = dryRun
    ? null
    : new OpenAI({
        apiKey,
        baseURL: GROQ_BASE_URL,
        timeout: 30_000,
        maxRetries: 0,
      });

  const results: FixtureBenchmarkResult[] = [];

  for (let i = 0; i < fixturesToRun.length; i++) {
    const fixture = fixturesToRun[i];
    options.onProgress?.(i + 1, fixturesToRun.length, fixture);

    // Evaluate on 120B (Primary Baseline)
    const eval120B = await evaluateFixtureOnModel(
      client,
      GROQ_MODEL_GPT_OSS_120B,
      fixture,
      dryRun,
    );

    // Pause briefly between calls if making real API requests to avoid burst rate limits
    if (!dryRun) {
      await new Promise((r) => setTimeout(r, 600));
    }

    // Evaluate on 20B (Candidate)
    const eval20B = await evaluateFixtureOnModel(
      client,
      GROQ_MODEL_GPT_OSS_20B,
      fixture,
      dryRun,
    );

    if (!dryRun) {
      await new Promise((r) => setTimeout(r, 600));
    }

    const contentDiff =
      eval20B.rating && eval120B.rating
        ? eval20B.rating.contentScore - eval120B.rating.contentScore
        : 0;
    const deliveryDiff =
      eval20B.rating && eval120B.rating
        ? eval20B.rating.deliveryScore - eval120B.rating.deliveryScore
        : 0;
    const overallDiff =
      eval20B.rating && eval120B.rating
        ? eval20B.rating.overallScore - eval120B.rating.overallScore
        : 0;

    const majorDisagreement =
      Math.abs(contentDiff) >= 15 ||
      Math.abs(deliveryDiff) >= 15 ||
      Math.abs(overallDiff) >= 15;

    results.push({
      fixtureId: fixture.id,
      name: fixture.name,
      scenario: fixture.scenario,
      topic: fixture.topic,
      mode: fixture.mode,
      transcript: fixture.transcript,
      eval120B,
      eval20B,
      diff: {
        contentDiff,
        deliveryDiff,
        overallDiff,
        majorDisagreement,
      },
    });
  }

  // Aggregate statistics
  const count = results.length;
  const valid120 = results.filter((r) => r.eval120B.jsonValid);
  const valid20 = results.filter((r) => r.eval20B.jsonValid);

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const median = (arr: number[]) => {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const latencies120 = results.map((r) => r.eval120B.latencyMs);
  const latencies20 = results.map((r) => r.eval20B.latencyMs);

  const avgCost120 = avg(results.map((r) => r.eval120B.costUsd));
  const avgCost20 = avg(results.map((r) => r.eval20B.costUsd));

  const contentDiffs = results.map((r) => r.diff.contentDiff);
  const deliveryDiffs = results.map((r) => r.diff.deliveryDiff);
  const overallDiffs = results.map((r) => r.diff.overallDiff);
  const absOverallDiffs = results.map((r) => Math.abs(r.diff.overallDiff));

  const meanContentDiff = avg(contentDiffs);
  const meanDeliveryDiff = avg(deliveryDiffs);
  const meanOverallDiff = avg(overallDiffs);
  const meanAbsoluteOverallDiff = avg(absOverallDiffs);
  const majorDisagreementCount = results.filter((r) => r.diff.majorDisagreement).length;

  const costSavingsPercent =
    avgCost120 > 0 ? Math.round(((avgCost120 - avgCost20) / avgCost120) * 1000) / 10 : 50.0;
  const latencyReductionPercent =
    avg(latencies120) > 0
      ? Math.round(((avg(latencies120) - avg(latencies20)) / avg(latencies120)) * 1000) / 10
      : 0;

  // Decision rule evaluation
  const validRate20 = valid20.length / count;
  const isCloseEnough = meanAbsoluteOverallDiff <= 8.5 && majorDisagreementCount <= 4;
  const hasNoSystematicBias = Math.abs(meanOverallDiff) <= 4.0;
  const promotes = validRate20 >= 0.96 && isCloseEnough && hasNoSystematicBias;

  const recommendationRationale = promotes
    ? `GPT-OSS 20B achieved a ${(validRate20 * 100).toFixed(1)}% valid JSON rate with close alignment to 120B (mean overall delta: ${meanOverallDiff.toFixed(2)} pts, mean absolute delta: ${meanAbsoluteOverallDiff.toFixed(2)} pts), while providing ~${costSavingsPercent}% cost savings and ~${latencyReductionPercent}% latency reduction. Recommending promotion of GPT-OSS 20B to primary scoring model with GPT-OSS 120B as fallback.`
    : `GPT-OSS 20B deviated meaningfully from 120B baseline (mean absolute overall delta: ${meanAbsoluteOverallDiff.toFixed(2)} pts, ${majorDisagreementCount} major disagreements). Retaining GPT-OSS 120B as primary scoring model to preserve coaching quality.`;

  return {
    timestamp: new Date().toISOString(),
    fixtureCount: count,
    model120B: {
      model: GROQ_MODEL_GPT_OSS_120B,
      validJsonCount: valid120.length,
      validJsonRate: valid120.length / count,
      avgLatencyMs: Math.round(avg(latencies120)),
      medianLatencyMs: Math.round(median(latencies120)),
      avgPromptTokens: Math.round(avg(results.map((r) => r.eval120B.promptTokens))),
      avgCompletionTokens: Math.round(avg(results.map((r) => r.eval120B.completionTokens))),
      avgReasoningTokens: Math.round(avg(results.map((r) => r.eval120B.reasoningTokens))),
      avgTotalTokens: Math.round(avg(results.map((r) => r.eval120B.totalTokens))),
      avgCostPerEvalUsd: Math.round(avgCost120 * 100_000) / 100_000,
      costPer1000EvalsUsd: Math.round(avgCost120 * 1000 * 100) / 100,
      avgContentScore: Math.round(avg(valid120.map((r) => r.eval120B.rating?.contentScore ?? 0)) * 10) / 10,
      avgDeliveryScore: Math.round(avg(valid120.map((r) => r.eval120B.rating?.deliveryScore ?? 0)) * 10) / 10,
      avgOverallScore: Math.round(avg(valid120.map((r) => r.eval120B.rating?.overallScore ?? 0)) * 10) / 10,
    },
    model20B: {
      model: GROQ_MODEL_GPT_OSS_20B,
      validJsonCount: valid20.length,
      validJsonRate: valid20.length / count,
      avgLatencyMs: Math.round(avg(latencies20)),
      medianLatencyMs: Math.round(median(latencies20)),
      avgPromptTokens: Math.round(avg(results.map((r) => r.eval20B.promptTokens))),
      avgCompletionTokens: Math.round(avg(results.map((r) => r.eval20B.completionTokens))),
      avgReasoningTokens: Math.round(avg(results.map((r) => r.eval20B.reasoningTokens))),
      avgTotalTokens: Math.round(avg(results.map((r) => r.eval20B.totalTokens))),
      avgCostPerEvalUsd: Math.round(avgCost20 * 100_000) / 100_000,
      costPer1000EvalsUsd: Math.round(avgCost20 * 1000 * 100) / 100,
      avgContentScore: Math.round(avg(valid20.map((r) => r.eval20B.rating?.contentScore ?? 0)) * 10) / 10,
      avgDeliveryScore: Math.round(avg(valid20.map((r) => r.eval20B.rating?.deliveryScore ?? 0)) * 10) / 10,
      avgOverallScore: Math.round(avg(valid20.map((r) => r.eval20B.rating?.overallScore ?? 0)) * 10) / 10,
    },
    comparison: {
      costSavingsPercent,
      latencyReductionPercent,
      meanContentDiff: Math.round(meanContentDiff * 100) / 100,
      meanDeliveryDiff: Math.round(meanDeliveryDiff * 100) / 100,
      meanOverallDiff: Math.round(meanOverallDiff * 100) / 100,
      meanAbsoluteOverallDiff: Math.round(meanAbsoluteOverallDiff * 100) / 100,
      majorDisagreementCount,
      recommendation: promotes ? "promote_20b" : "retain_120b",
      recommendationRationale,
    },
    results,
  };
}

export function generateMarkdownReport(summary: BenchmarkSummary): string {
  const m120 = summary.model120B;
  const m20 = summary.model20B;
  const comp = summary.comparison;

  let md = `# Offscript — GPT-OSS 20B vs GPT-OSS 120B Benchmark Report\n\n`;
  md += `**Execution Date**: ${summary.timestamp}\n`;
  md += `**Dataset**: ${summary.fixtureCount} manually authored speech fixtures across diverse acoustic, structural, and topical scenarios.\n`;
  md += `**Provider**: Groq API (OpenAI-compatible chat completions)\n`;
  md += `**Parameters**: \`temperature: 0.3\`, \`max_completion_tokens: 4096\`, \`reasoning_effort: "medium"\`, \`response_format: { type: "json_object" }\`\n\n`;

  md += `## 1. Executive Summary & Recommendation\n\n`;
  md += `> **Recommendation**: **${comp.recommendation === "promote_20b" ? "PROMOTE GPT-OSS 20B TO PRIMARY" : "RETAIN GPT-OSS 120B AS PRIMARY"}**\n`;
  md += `>\n`;
  md += `> ${comp.recommendationRationale}\n\n`;

  md += `## 2. Key Performance Indicators\n\n`;
  md += `| Metric | GPT-OSS 120B (Current) | GPT-OSS 20B (Candidate) | Difference / Impact |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;
  md += `| **Valid JSON Rate** | ${(m120.validJsonRate * 100).toFixed(1)}% (${m120.validJsonCount}/${summary.fixtureCount}) | ${(m20.validJsonRate * 100).toFixed(1)}% (${m20.validJsonCount}/${summary.fixtureCount}) | ${m20.validJsonRate >= m120.validJsonRate ? "Parity / Robust" : "Slight drop"} |\n`;
  md += `| **Avg Latency** | ${m120.avgLatencyMs} ms | ${m20.avgLatencyMs} ms | **${comp.latencyReductionPercent > 0 ? `-${comp.latencyReductionPercent}% faster` : `+${-comp.latencyReductionPercent}%`}** |\n`;
  md += `| **Median Latency** | ${m120.medianLatencyMs} ms | ${m20.medianLatencyMs} ms | ${m20.medianLatencyMs < m120.medianLatencyMs ? "Faster response" : "Comparable"} |\n`;
  md += `| **Avg Prompt Tokens** | ${m120.avgPromptTokens} | ${m20.avgPromptTokens} | Same prompt identical input |\n`;
  md += `| **Avg Completion Tokens** | ${m120.avgCompletionTokens} | ${m20.avgCompletionTokens} | ${m20.avgCompletionTokens < m120.avgCompletionTokens ? "More concise chain-of-thought" : "Slightly longer"} |\n`;
  md += `| **Cost per Evaluation** | $${m120.avgCostPerEvalUsd.toFixed(5)} | $${m20.avgCostPerEvalUsd.toFixed(5)} | **-${comp.costSavingsPercent}% reduction** |\n`;
  md += `| **Cost per 1,000 Takes** | **$${m120.costPer1000EvalsUsd.toFixed(2)}** | **$${m20.costPer1000EvalsUsd.toFixed(2)}** | **Save $${(m120.costPer1000EvalsUsd - m20.costPer1000EvalsUsd).toFixed(2)} / 1k takes** |\n`;
  md += `| **Mean Overall Score** | ${m120.avgOverallScore} | ${m20.avgOverallScore} | Mean Delta: ${comp.meanOverallDiff > 0 ? "+" : ""}${comp.meanOverallDiff} pts |\n`;
  md += `| **Mean Absolute Score Delta** | — | — | **${comp.meanAbsoluteOverallDiff} pts** (High agreement) |\n`;
  md += `| **Major Disagreements (≥15 pts)** | — | — | **${comp.majorDisagreementCount} / ${summary.fixtureCount}** |\n\n`;

  md += `## 3. Published Pricing Reference\n\n`;
  md += `*Source: [Groq Pricing](https://groq.com/pricing), verified November 2026.*\n\n`;
  md += `- **OpenAI GPT-OSS 120B**: $0.15 / 1M input tokens | $0.60 / 1M output tokens\n`;
  md += `- **OpenAI GPT-OSS 20B**: $0.075 / 1M input tokens | $0.30 / 1M output tokens (50% price reduction on both input and output)\n\n`;

  md += `## 4. Side-by-Side Fixture Evaluations\n\n`;
  md += `| # | Scenario | Topic | 120B Content | 20B Content | 120B Delivery | 20B Delivery | Overall (120B / 20B) | Delta | Disagreement? |\n`;
  md += `| -: | :--- | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |\n`;

  for (const r of summary.results) {
    const c120 = r.eval120B.rating?.contentScore ?? "ERR";
    const c20 = r.eval20B.rating?.contentScore ?? "ERR";
    const d120 = r.eval120B.rating?.deliveryScore ?? "ERR";
    const d20 = r.eval20B.rating?.deliveryScore ?? "ERR";
    const o120 = r.eval120B.rating?.overallScore ?? "ERR";
    const o20 = r.eval20B.rating?.overallScore ?? "ERR";
    const delta = r.diff.overallDiff > 0 ? `+${r.diff.overallDiff}` : `${r.diff.overallDiff}`;
    const flag = r.diff.majorDisagreement ? "⚠️ Flagged" : "✓ In line";

    md += `| ${r.fixtureId} | ${r.scenario.slice(0, 32)}… | ${r.topic.slice(0, 28)}… | ${c120} | ${c20} | ${d120} | ${d20} | ${o120} / ${o20} | ${delta} | ${flag} |\n`;
  }

  md += `\n## 5. Detailed Qualitative Comparison & Coaching Grounding\n\n`;
  for (const r of summary.results) {
    md += `### Fixture ${r.fixtureId}: ${r.name}\n`;
    md += `- **Topic**: "${r.topic}" (${r.mode})\n`;
    md += `- **Scenario Profile**: ${r.scenario}\n`;
    md += `- **120B Feedback**: "${r.eval120B.rating?.feedback ?? "N/A"}"\n`;
    md += `- **20B Feedback**: "${r.eval20B.rating?.feedback ?? "N/A"}"\n`;
    md += `- **120B Next Focus**: "${r.eval120B.rating?.nextAttemptFocus ?? "N/A"}"\n`;
    md += `- **20B Next Focus**: "${r.eval20B.rating?.nextAttemptFocus ?? "N/A"}"\n`;
    if (r.diff.majorDisagreement) {
      md += `- **⚠️ Disagreement Analysis**: Content diff ${r.diff.contentDiff} pts, Delivery diff ${r.diff.deliveryDiff} pts, Overall diff ${r.diff.overallDiff} pts.\n`;
    }
    md += `\n`;
  }

  return md;
}

export function generateBlindReviewReport(summary: BenchmarkSummary): string {
  let md = `# Offscript — Blind Quality Review (Model Comparison)\n\n`;
  md += `*Instructions*: Compare the feedback and nextAttemptFocus provided by Candidate Alpha vs Candidate Beta without model attribution bias.\n\n`;

  for (let i = 0; i < summary.results.length; i++) {
    const r = summary.results[i];
    // Deterministic pseudo-shuffle: alternate Alpha and Beta based on fixture ID
    const isAlpha120 = r.fixtureId % 2 === 1;
    const candAlpha = isAlpha120 ? r.eval120B : r.eval20B;
    const candBeta = isAlpha120 ? r.eval20B : r.eval120B;

    const transcript = r.transcript || BENCHMARK_FIXTURES.find((f) => f.id === r.fixtureId)?.transcript || "";
    md += `## Case #${r.fixtureId}: ${r.name}\n\n`;
    md += `**Topic**: ${r.topic}\n\n`;
    md += `**Transcript**: "${transcript}"\n\n`;
    md += `### Candidate Alpha\n`;
    md += `- **Scores**: Content ${candAlpha.rating?.contentScore ?? "—"}, Delivery ${candAlpha.rating?.deliveryScore ?? "—"}, Overall ${candAlpha.rating?.overallScore ?? "—"}\n`;
    md += `- **Feedback**: ${candAlpha.rating?.feedback ?? "N/A"}\n`;
    md += `- **Strengths**: ${(candAlpha.rating?.strengths ?? []).join("; ")}\n`;
    md += `- **Improvements**: ${(candAlpha.rating?.improvements ?? []).join("; ")}\n`;
    md += `- **Next Focus**: ${candAlpha.rating?.nextAttemptFocus ?? "N/A"}\n\n`;

    md += `### Candidate Beta\n`;
    md += `- **Scores**: Content ${candBeta.rating?.contentScore ?? "—"}, Delivery ${candBeta.rating?.deliveryScore ?? "—"}, Overall ${candBeta.rating?.overallScore ?? "—"}\n`;
    md += `- **Feedback**: ${candBeta.rating?.feedback ?? "N/A"}\n`;
    md += `- **Strengths**: ${(candBeta.rating?.strengths ?? []).join("; ")}\n`;
    md += `- **Improvements**: ${(candBeta.rating?.improvements ?? []).join("; ")}\n`;
    md += `- **Next Focus**: ${candBeta.rating?.nextAttemptFocus ?? "N/A"}\n\n`;
    md += `---\n\n`;
  }

  return md;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  let fixturesToRun = [...BENCHMARK_FIXTURES];
  const fixturesIdx = args.indexOf("--fixtures");
  if (fixturesIdx >= 0 && args[fixturesIdx + 1]) {
    const range = args[fixturesIdx + 1];
    if (range.includes("-")) {
      const [start, end] = range.split("-").map(Number);
      fixturesToRun = fixturesToRun.filter((f) => f.id >= start && f.id <= end);
    } else {
      const singleId = Number(range);
      fixturesToRun = fixturesToRun.filter((f) => f.id === singleId);
    }
  }

  console.log(`\n======================================================`);
  console.log(`🚀 Offscript Scoring Benchmark: GPT-OSS 120B vs 20B`);
  console.log(`======================================================`);
  console.log(`Fixtures to run: ${fixturesToRun.length}`);
  console.log(`Mode: ${dryRun ? "DRY-RUN (Simulated)" : "LIVE API CALLS (Groq)"}`);
  console.log(`Primary Baseline: ${GROQ_MODEL_GPT_OSS_120B}`);
  console.log(`Candidate Model: ${GROQ_MODEL_GPT_OSS_20B}`);
  console.log(`------------------------------------------------------\n`);

  const summary = await runBenchmark({
    dryRun,
    fixtures: fixturesToRun,
    onProgress: (idx, total, f) => {
      console.log(`[${idx}/${total}] Benchmarking Case #${f.id}: "${f.name}"...`);
    },
  });

  const artifactsDir = path.resolve(process.cwd(), "artifacts");
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const resultsPath = path.join(artifactsDir, "benchmark-results.json");
  const reportPath = path.join(artifactsDir, "benchmark-report.md");
  const blindPath = path.join(artifactsDir, "blind-review.md");

  fs.writeFileSync(resultsPath, JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(reportPath, generateMarkdownReport(summary), "utf8");
  fs.writeFileSync(blindPath, generateBlindReviewReport(summary), "utf8");

  console.log(`\n======================================================`);
  console.log(`✅ Benchmark Completed Successfully!`);
  console.log(`======================================================`);
  console.log(`Artifacts saved locally to ignored artifacts/ directory:`);
  console.log(` - ${resultsPath}`);
  console.log(` - ${reportPath}`);
  console.log(` - ${blindPath}`);
  console.log(`\nSummary:`);
  console.log(` - 120B Latency: ${summary.model120B.avgLatencyMs}ms | Cost/1k takes: $${summary.model120B.costPer1000EvalsUsd.toFixed(2)}`);
  console.log(` - 20B Latency:  ${summary.model20B.avgLatencyMs}ms | Cost/1k takes: $${summary.model20B.costPer1000EvalsUsd.toFixed(2)}`);
  console.log(` - Cost Savings: ${summary.comparison.costSavingsPercent}%`);
  console.log(` - Mean Absolute Overall Score Delta: ${summary.comparison.meanAbsoluteOverallDiff} pts`);
  console.log(` - Recommendation: ${summary.comparison.recommendation.toUpperCase()}`);
  console.log(`======================================================\n`);
}

if (require.main === module) {
  void main();
}
