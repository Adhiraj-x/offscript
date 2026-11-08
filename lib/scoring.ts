import { clampScore } from "./format";
import type { FillerBreakdown } from "./fillers";
import { fillersPer100Words, summarizeFillers } from "./fillers";
import type { SpeechMetrics } from "./speechMetrics";

/**
 * Scoring architecture (Sprint 2.3).
 *
 * The model judges both the content and the delivery of a take. The measurements in
 * `lib/speechMetrics.ts` and `lib/fillers.ts` are supplied as evidence; they do not
 * compute the delivery score. The server only validates the two scores and applies
 * the documented 60/40 overall formula, so the weighting cannot drift between
 * responses. There is deliberately no deterministic delivery formula here: real
 * A/B testing showed that a weighted subscores model disagreed with the speaker's own
 * assessment on a slow, filler-heavy take.
 */

/**
 * Overall score formula: 60% content, 40% delivery. The model's own overallScore is
 * ignored on the server so the weighting can't drift between responses.
 */
export const SCORING_WEIGHTS = { content: 0.6, delivery: 0.4 } as const;

export type ScoreBand = {
  min: number;
  max: number;
  label: string;
};

export const SCORE_BANDS: ScoreBand[] = [
  { min: 0, max: 39, label: "Very weak" },
  { min: 40, max: 59, label: "Needs improvement" },
  { min: 60, max: 74, label: "Competent" },
  { min: 75, max: 89, label: "Strong" },
  { min: 90, max: 100, label: "Excellent" },
];

export function computeOverallScore(contentScore: number, deliveryScore: number): number {
  const content = clampScore(contentScore);
  const delivery = clampScore(deliveryScore);
  return clampScore(SCORING_WEIGHTS.content * content + SCORING_WEIGHTS.delivery * delivery);
}

export function scoreBand(score: number): ScoreBand {
  const safe = clampScore(score);
  return SCORE_BANDS.find((band) => safe >= band.min && safe <= band.max) ?? SCORE_BANDS[0];
}

export function bandLabel(score: number): string {
  return scoreBand(score).label;
}

/* -------------------------------------------------------------------------- */
/* Pace classification (evidence, not a score)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Speaking-rate calibration, applied to the primary rate (words / total recording
 * duration, pauses included). These labels describe the measurement and appear in the
 * UI and the prompt; the delivery score itself is the model's judgement.
 */
export type PaceBandId =
  | "very-slow"
  | "slow"
  | "somewhat-slow"
  | "comfortable"
  | "somewhat-fast"
  | "very-fast";

export type PaceBand = {
  id: PaceBandId;
  label: string;
  /** Lower edge; inclusive unless `minExclusive` is set. */
  minWpm: number;
  /** Upper edge; inclusive unless `maxExclusive` is set. */
  maxWpm: number;
  minExclusive?: boolean;
  maxExclusive?: boolean;
};

/**
 * True when a measured rate falls inside the band. Edges are explicit rather than
 * implied by integer bounds: an earlier version used max 69 / min 70 and left every
 * rate in between (69.9, 89.9, 160.1...) unclassified, so a measured pace was treated
 * as missing.
 */
function rateInBand(wpm: number, band: PaceBand): boolean {
  const aboveMin = band.minExclusive ? wpm > band.minWpm : wpm >= band.minWpm;
  const belowMax = band.maxExclusive ? wpm < band.maxWpm : wpm <= band.maxWpm;
  return aboveMin && belowMax;
}

export const PACE_BANDS: PaceBand[] = [
  { id: "very-slow", label: "Very slow", minWpm: 0, maxWpm: 70, maxExclusive: true },
  { id: "slow", label: "Slow", minWpm: 70, maxWpm: 90, maxExclusive: true },
  { id: "somewhat-slow", label: "Somewhat slow", minWpm: 90, maxWpm: 110, maxExclusive: true },
  { id: "comfortable", label: "Comfortable", minWpm: 110, maxWpm: 160 },
  {
    id: "somewhat-fast",
    label: "Somewhat fast",
    minWpm: 160,
    maxWpm: 180,
    minExclusive: true,
  },
  {
    id: "very-fast",
    label: "Very fast",
    minWpm: 180,
    maxWpm: Number.POSITIVE_INFINITY,
    minExclusive: true,
  },
];

/** Bands whose pace should be named as too slow / too fast in feedback. */
export const SLOW_PACE_BANDS: PaceBandId[] = ["very-slow", "slow", "somewhat-slow"];
export const FAST_PACE_BANDS: PaceBandId[] = ["somewhat-fast", "very-fast"];

export function classifyPace(wpm: number | null | undefined): PaceBand | null {
  if (wpm === null || wpm === undefined) return null;
  if (!Number.isFinite(wpm) || wpm <= 0) return null;
  return PACE_BANDS.find((band) => rateInBand(wpm, band)) ?? null;
}

/** Display label for a stored WPM figure; old sessions may have no measurement. */
export function describePace(wpm: number | null | undefined): string {
  return classifyPace(wpm)?.label ?? "pace not measured";
}

/**
 * Immediate repeated words ("the the", "I I") are the one fluency signal text can
 * carry. Reported to the model as evidence; it does not feed a formula.
 */
export function countAdjacentRepetitions(transcript: string): number {
  const tokens = transcript
    .toLowerCase()
    .replace(/[^a-z'\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const fillerTokens = new Set(["um", "uh", "erm", "er", "ah", "hmm", "hm"]);

  let runs = 0;
  for (let index = 1; index < tokens.length; index += 1) {
    const previous = tokens[index - 1];
    const current = tokens[index];
    if (previous !== current) continue;
    // Hesitations are already counted by the filler dimension.
    if (fillerTokens.has(current) || fillerTokens.has(previous)) continue;
    runs += 1;
  }
  return runs;
}

/* -------------------------------------------------------------------------- */
/* Model reply validation                                                      */
/* -------------------------------------------------------------------------- */

export type RatedAnswer = {
  contentScore: number;
  deliveryScore: number;
  overallScore: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
};

/**
 * Why a reply was rejected. The route needs the code to distinguish a broken reply
 * from a usable one that only misnamed the pace.
 */
export type RatingFailureCode =
  | "not-object"
  | "content-score"
  | "delivery-score"
  | "feedback"
  | "strengths"
  | "improvements"
  | "pace-label";

export type RatingValidation =
  | { ok: true; value: RatedAnswer }
  | { ok: false; reason: string; code: RatingFailureCode };

export const MIN_FEEDBACK_CHARS = 20;
export const MIN_LIST_ITEMS = 2;
export const MAX_LIST_ITEMS = 3;

function toScore(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) return null;
  return clampScore(numeric);
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, MAX_LIST_ITEMS);
}

export type NormalizeRatingOptions = {
  /**
   * The band classifyPace produced. When supplied, feedback that names a different
   * pace band is rejected instead of being shown next to a contradicting label.
   */
  paceBand?: PaceBand | null;
};

const NEGATION_CUE =
  /\b(?:not|never|no|hardly|anything but|far from|instead of|rather than|isn'?t|wasn'?t|aren'?t|don'?t|doesn'?t|without being)\b[\w\s',-]{0,24}$/i;

/**
 * True when the band label at `index` is being denied rather than claimed, e.g.
 * "not slow", "anything but comfortable", "instead of very slow".
 */
function isNegatedAt(text: string, index: number): boolean {
  return NEGATION_CUE.test(text.slice(Math.max(0, index - 40), index));
}

/**
 * Deterministic pace-label guard. classifyPace is the only source of truth for what
 * the measurement is called, so the prose must not name a different band: 79 WPM is
 * "Slow", never "Very slow". This constrains wording only, never the score.
 * Negated mentions are allowed ("you were not slow"); only a competing claim fails.
 */
export function checkPaceLabelConsistency(
  feedback: string,
  band: PaceBand | null | undefined,
): { ok: true } | { ok: false; reason: string; code: "pace-label" } {
  if (!band) return { ok: true };

  // Longest label first so "very slow" is consumed before "slow" is scanned.
  const labels = [...PACE_BANDS].sort((a, b) => b.label.length - a.label.length);
  const consumed = new Array<boolean>(feedback.length).fill(false);

  for (const candidate of labels) {
    const pattern = new RegExp(`\\b${candidate.label}\\b`, "gi");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(feedback)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (consumed[start]) continue;
      for (let index = start; index < end; index += 1) consumed[index] = true;
      if (isNegatedAt(feedback, start)) continue;
      if (candidate.id !== band.id) {
        return {
          ok: false,
          code: "pace-label",
          reason: `the feedback called the pace "${match[0]}" but the measured classification is "${band.label}"`,
        };
      }
    }
  }

  return { ok: true };
}

/**
 * Validates a model reply. Both content and delivery are the model's to award, but a
 * missing or non-numeric score is a failure, never a default: the caller retries once
 * and then reports an honest error. Numeric values outside 0-100 are clamped, which is
 * deterministic rather than invented. The overall score is always recomputed here, so
 * the model cannot override the 60/40 formula.
 */
export function normalizeRating(
  raw: unknown,
  options: NormalizeRatingOptions = {},
): RatingValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "the reply was not a JSON object", code: "not-object" };
  }
  const record = raw as Record<string, unknown>;

  const contentScore = toScore(record.contentScore ?? record.content);
  if (contentScore === null) {
    return { ok: false, reason: "contentScore was missing or not a number", code: "content-score" };
  }

  const deliveryScore = toScore(record.deliveryScore ?? record.delivery);
  if (deliveryScore === null) {
    return {
      ok: false,
      reason: "deliveryScore was missing or not a number",
      code: "delivery-score",
    };
  }

  const feedback = typeof record.feedback === "string" ? record.feedback.trim() : "";
  if (feedback.length < MIN_FEEDBACK_CHARS) {
    return { ok: false, reason: "feedback was missing or too short", code: "feedback" };
  }

  const strengths = toStringList(record.strengths);
  if (strengths.length < MIN_LIST_ITEMS) {
    return { ok: false, reason: "fewer than two strengths", code: "strengths" };
  }

  const improvements = toStringList(record.improvements);
  if (improvements.length < MIN_LIST_ITEMS) {
    return { ok: false, reason: "fewer than two improvements", code: "improvements" };
  }

  // The pace label in the prose must match the measurement the UI shows.
  const paceCheck = checkPaceLabelConsistency(feedback, options.paceBand);
  if (!paceCheck.ok) return paceCheck;

  return {
    ok: true,
    value: {
      contentScore,
      deliveryScore,
      overallScore: computeOverallScore(contentScore, deliveryScore),
      feedback,
      strengths,
      improvements,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Prompts                                                                     */
/* -------------------------------------------------------------------------- */

const BAND_GUIDE = `0-39 Very weak / 40-59 Needs improvement / 60-74 Competent / 75-89 Strong / 90-100 Excellent`;

export const SCORING_SYSTEM_PROMPT = `You are Offscript, a direct but fair speaking coach. You grade one spoken answer from a machine-generated transcript plus measured timing data.

YOU JUDGE; THE NUMBERS INFORM YOU
- You award both scores: contentScore for the content, deliveryScore for how effectively it was delivered.
- The measurements are evidence, not a formula. Do not average, weight or mechanically convert them into a delivery score.
- Judge delivery holistically. Pace, pauses, fillers, hesitation and repetition matter through their combined effect on clarity and listening effort, not as line items to tally.
- A very slow, pause-heavy, filler-heavy take can deserve 40-50 even when its words are clean. A comfortable, fluent take with a clear through-line can score in the 80s.
- Do not force scores into a high range. Do not assume a low score is harsh or a high score is encouraging.
- Zero detected fillers must not by itself mean good delivery: the transcript may simply have dropped them.
- Frequent pauses that break the flow should lower the score; a few natural pauses should not be penalised heavily.
- A high filler count matters, but weigh whether the fillers actually disrupted communication.

YOU DO NOT HEAR THE AUDIO
- Never claim or imply that you assessed vocal confidence, pronunciation, accent, volume, pitch, intonation, emphasis, or emotional expression. You cannot.
- The transcript is machine-generated: expect misheard words, invented homophones, missing or wrong punctuation, run-together sentences, and dropped hesitation sounds.
- Every judgement must be traceable to words in the transcript or to the supplied measurements. Do not invent statements the speaker did not make.
- Timing and filler figures are estimates from timestamps and a text heuristic. If a measurement is missing or marked low precision, say the picture is partial; never present a guess as exact.

CONTENT SCORE (0-100) - only relevance to the topic, clarity of the central claim, structure, depth of explanation, supporting examples, coherence and logical reasoning. Anchors:
- 0-39: off-topic or incoherent; no identifiable claim.
- 40-59: a claim exists but is vague, unsupported, or hard to follow.
- 60-74: relevant and understandable, with thin support or an uneven structure.
- 75-89: clear central claim, ordered reasoning, at least one concrete example.
- 90-100: sharply focused, well structured, developed with specific examples or qualifications, and fully on topic.
- A short, informal answer that makes a relevant point is not automatically weak. Judge what is there, not what a formal essay would contain.

DELIVERY SCORE (0-100) - how effectively the speaker communicated: pace, pause behaviour, fillers, hesitation and repetition as they affect clarity and listening effort. Use the supplied measurements as supporting evidence, then make a holistic judgement.

OVERALL
- overallScore is 60% content + 40% delivery. The server recomputes it from your two scores and ignores whatever you return, so do not spend effort on it.

FEEDBACK
- 3-5 sentences, second person, direct but not harsh, ending with a concise overall assessment.
- Explain why the delivery score is what it is, referring to the actual measurements (rate, pauses, fillers) and to what they did to clarity.
- Refer to actual parts of the answer: name the claim, the example, or the moment it drifted.
- Include at least one short direct quote from the transcript, in double quotes.
- If a pace classification is supplied, name it with that exact label and never substitute another pace label.
- Do not contradict the measurements: never call a slow, hesitant take smooth or well-paced, and never call a comfortable pace rushed.
- No generic motivation ("great job", "keep practising", "you've got this"), no markdown, no emojis, no headings.
- strengths: exactly 2-3 items, each one sentence, specific to this answer.
- improvements: exactly 2-3 items, each one concrete change for the next attempt.

Return ONLY a JSON object:
{
  "contentScore": number,
  "deliveryScore": number,
  "overallScore": number,
  "feedback": string,
  "strengths": string[],
  "improvements": string[]
}
Bands: ${BAND_GUIDE}.`;

export type ScoringPromptInput = {
  topic: string;
  mode: string;
  transcript: string;
  metrics: SpeechMetrics;
  fillers: FillerBreakdown;
};

function seconds(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
}

function rateText(metrics: SpeechMetrics): string {
  if (metrics.speakingRateWpm !== null) {
    return `${metrics.speakingRateWpm} WPM across the whole recording (pauses included)`;
  }
  if (metrics.articulationWpm !== null) {
    return `${metrics.articulationWpm} WPM while speaking (pauses excluded)`;
  }
  return "not measurable";
}

/**
 * The requirement list is what keeps the prose honest: every measurement that bears on
 * the delivery score appears here as something the feedback must address. It never
 * dictates the score itself.
 */
export function feedbackRequirements(
  metrics: SpeechMetrics,
  fillers: FillerBreakdown,
  band: PaceBand | null,
): string[] {
  const out: string[] = [];

  if (band === null) {
    out.push(
      "No usable pace measurement exists for this take. Do not describe the pacing and do not name a pace band.",
    );
  } else if (SLOW_PACE_BANDS.includes(band.id)) {
    out.push(
      `The measured speaking rate is ${rateText(metrics)} and the pace is classified exactly "${band.label}". Say plainly that the pace was too slow; state the label as "${band.label}" and never substitute another pace label. Do not call it smooth, steady, comfortable or well-paced.`,
    );
  } else if (FAST_PACE_BANDS.includes(band.id)) {
    out.push(
      `The measured speaking rate is ${rateText(metrics)} and the pace is classified exactly "${band.label}". Say plainly that the pace was too fast and cost clarity; state the label as "${band.label}" and never substitute another pace label.`,
    );
  } else {
    out.push(
      `The measured speaking rate is ${rateText(metrics)} and the pace is classified exactly "${band.label}". State it as "${band.label}" and never substitute another pace label.`,
    );
  }

  if (metrics.pausesAvailable && metrics.noticeablePauseCount !== null && metrics.longPauseCount !== null) {
    out.push(
      `Pauses of 0.5s or longer were measured: ${metrics.noticeablePauseCount}, of which ${metrics.longPauseCount} reached 1.5s. Refer to them when they bear on fluency.`,
    );
  } else {
    out.push("No pause measurement exists for this take. Do not describe the pausing.");
  }

  if (fillers.total > 0) {
    out.push(`Detected fillers: ${summarizeFillers(fillers)}. Mention at least one of them.`);
  } else {
    out.push(
      "No fillers appeared in the transcript. Do not claim the speaker used no fillers: say the transcript shows none, and note that transcription can drop them.",
    );
  }

  if (metrics.pausesLowPrecision) {
    out.push("Pause figures come from coarse segment timestamps, so do not quote them as exact.");
  }

  out.push("Explain why the delivery score is what it is, tying it to these measurements.");
  out.push("Use at least one short direct quote from the transcript.");
  out.push("Do not claim to have heard the audio or assessed the speaker's voice.");
  return out;
}

export function buildScoringUserPrompt(input: ScoringPromptInput): string {
  const { metrics, fillers, transcript } = input;
  const band = classifyPace(metrics.speakingRateWpm);
  const lines: string[] = [
    `Topic: ${input.topic}`,
    `Mode: ${input.mode}`,
    `Words spoken: ${metrics.wordCount}`,
  ];

  if (metrics.durationSeconds !== null) {
    const lengthNote =
      metrics.durationBasis === "reported"
        ? "reported by the transcriber"
        : "taken from the last timestamp";
    lines.push(`Recording length: ${seconds(metrics.durationSeconds)} (${lengthNote})`);
  } else {
    lines.push("Recording length: not reported by the transcriber.");
  }

  if (metrics.speakingRateWpm !== null) {
    lines.push(`Speaking rate: ${metrics.speakingRateWpm} WPM across the whole recording, pauses included.`);
  } else {
    lines.push("Speaking rate: not measurable (no timing data).");
  }

  if (band) {
    lines.push(
      `Pace classification: ${band.label}. This is the only correct pace label for this take; use it verbatim and never substitute another pace label.`,
    );
  } else {
    lines.push("Pace classification: none. Do not name a pace label at all.");
  }

  if (metrics.articulationWpm !== null) {
    lines.push(
      `Articulation rate: ${metrics.articulationWpm} WPM while actually speaking, pauses excluded. Do not treat this as the overall pace.`,
    );
  } else {
    lines.push("Articulation rate: not measurable (no usable speech timings).");
  }

  if (metrics.activeSpeechSeconds !== null) {
    lines.push(
      `Estimated speaking time: ${seconds(metrics.activeSpeechSeconds)} (gaps of ${metrics.noticeablePauseThresholdSeconds}s or more removed).`,
    );
  }

  if (metrics.pausesAvailable && metrics.noticeablePauseCount !== null) {
    lines.push(
      `Pauses of ${metrics.noticeablePauseThresholdSeconds}s or longer: ${metrics.noticeablePauseCount} (${metrics.longPauseCount ?? 0} of ${metrics.longPauseThresholdSeconds}s or longer; longest ${seconds(
        metrics.longestPauseSeconds ?? 0,
      )}; ${metrics.pauseFrequencyPerMinute ?? 0} per minute). Estimated from ${
        metrics.timestampGranularity === "segment" ? "segment" : "word"
      } timestamps.`,
    );
  } else {
    lines.push("Pauses: not measured (no usable timestamps). Do not comment on pauses.");
  }

  if (metrics.pausesLowPrecision) {
    lines.push(
      "Pause precision: segment timestamps only, so pauses inside a segment cannot be seen. Treat pause figures as a lower bound.",
    );
  }

  lines.push(
    `Filler estimate: ${fillers.total} detected (${summarizeFillers(fillers)}), ${
      fillers.per100Words ?? fillersPer100Words(fillers.total, metrics.wordCount) ?? 0
    } per 100 transcribed words. Text heuristic; Whisper often drops audible fillers, so treat this as a floor rather than a true count.`,
  );
  lines.push(
    `Hesitation detail: ${fillers.definiteCount} definite hesitations, ${fillers.contextualCount} contextual markers, ${fillers.repeatedRunCount} repeated hesitation runs.`,
  );
  lines.push(
    `Transcript-supported repetition: ${countAdjacentRepetitions(transcript)} adjacent repeated word pairs (text only).`,
  );

  lines.push("");
  lines.push("How to score:");
  lines.push(
    "- contentScore: relevance to the topic, clarity of the claim, structure, depth, examples, coherence.",
  );
  lines.push(
    "- deliveryScore: your holistic judgement of how effectively the speaker communicated, using the measurements above as evidence rather than as a formula. Very slow pace plus frequent pauses plus many fillers should land far below a clean, comfortable take.",
  );
  lines.push(
    "- Use the measurements as estimates, and do not project certainty about anything that was not measured.",
  );

  lines.push("");
  lines.push("Required in your feedback:");
  for (const requirement of feedbackRequirements(metrics, fillers, band)) {
    lines.push(`- ${requirement}`);
  }

  lines.push("");
  lines.push("Transcript:");
  lines.push(`"""${input.transcript}"""`);
  lines.push("");
  lines.push(
    "Award both scores from this evidence and return the JSON object. The server computes overallScore.",
  );

  return lines.join("\n");
}
