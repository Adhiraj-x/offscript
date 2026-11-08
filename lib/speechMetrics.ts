/**
 * Speaking metrics estimated from Whisper timestamps.
 *
 * Groq's Whisper endpoint returns `verbose_json` with per-segment timings and, when
 * `timestamp_granularities: ["word", "segment"]` is requested, per-word spans. Those
 * timings are the recogniser's alignment, not a voice-activity detector, so every
 * figure here is an ESTIMATE. When the provider returns no timestamps we say so
 * (`pausesAvailable: false`, `wpmBasis: "unavailable"`) instead of inventing numbers.
 *
 * TWO PAUSE THRESHOLDS
 * - Noticeable pause: a gap of 0.5s or more. Normal articulation between adjacent
 *   words sits well below this, so it is not counted.
 * - Long pause: a gap of 1.5s or more (a subset of noticeable pauses).
 *
 * TWO RATES
 * - Speaking rate (`speakingRateWpm`): words / total recording duration. Pauses,
 *   including leading and trailing silence, are inside the denominator. This is the
 *   primary pace figure because it reflects how long the listener actually waited.
 * - Articulation rate (`articulationWpm`): words / estimated active speech time.
 *   Active speech runs from the first recognised span to the last, minus noticeable
 *   pauses, so leading and trailing silence are excluded. Never labelled as overall
 *   pace: it can look normal while the recording as a whole is slow.
 *
 * Pause figures are lower precision when only segment timestamps exist, because a
 * pause that falls inside a segment is invisible.
 */

/** A gap at or above this length counts as a noticeable pause. */
export const NOTICEABLE_PAUSE_THRESHOLD_SECONDS = 0.5;
/** A gap at or above this length counts as a long pause. */
export const LONG_PAUSE_THRESHOLD_SECONDS = 1.5;

export type TimestampGranularity = "word" | "segment";

/** Which denominator the reported pace used. "unavailable" means no usable timing. */
export type RateBasis = "total-duration" | "active-speech" | "unavailable";

/** Where the recording length came from. */
export type DurationBasis = "reported" | "timestamps" | "unavailable";

export type TimedSpan = { start: number; end: number };

export type SpeechMetrics = {
  wordCount: number;
  /** Length of the whole upload in seconds, when Whisper reported it (or spans end). */
  durationSeconds: number | null;
  durationBasis: DurationBasis;
  /** Speech time with noticeable pauses and edge silence removed. Estimate. */
  activeSpeechSeconds: number | null;
  /** Primary pace: words per minute of the whole recording, pauses included. */
  wpm: number;
  wpmBasis: RateBasis;
  /** Words / total recording duration. Null when the duration is unknown. */
  speakingRateWpm: number | null;
  /** Words / estimated active speech time. Null when timings are unusable. */
  articulationWpm: number | null;
  /** Granularity the pause figures came from; null when timestamps were unusable. */
  timestampGranularity: TimestampGranularity | null;
  /** False when the provider gave no timestamps, which makes pause figures unknowable. */
  pausesAvailable: boolean;
  /** True for segment-only timings, where pauses inside a segment cannot be observed. */
  pausesLowPrecision: boolean;
  noticeablePauseThresholdSeconds: number;
  longPauseThresholdSeconds: number;
  noticeablePauseCount: number | null;
  noticeablePauseTotalSeconds: number | null;
  longPauseCount: number | null;
  longPauseTotalSeconds: number | null;
  longestPauseSeconds: number | null;
  /** Noticeable pauses per minute of recording. */
  pauseFrequencyPerMinute: number | null;
  /** @deprecated Sprint 01 field: same value as `longPauseCount`. */
  pauseCount: number | null;
  /** @deprecated Sprint 01 field: always the 1.5s threshold. */
  pauseThresholdSeconds: number;
};

const WORD_SPLIT = /\s+/;

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(WORD_SPLIT).filter(Boolean).length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function finiteNumber(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Keeps only spans with finite, ordered timestamps and sorts them by start time.
 * Whisper occasionally emits overlapping or reversed spans, so callers can't
 * assume the array is clean.
 */
export function normalizeSpans(raw: unknown): TimedSpan[] {
  if (!Array.isArray(raw)) return [];
  const spans: TimedSpan[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const start = finiteNumber((entry as { start?: unknown }).start);
    const end = finiteNumber((entry as { end?: unknown }).end);
    if (start === null || end === null) continue;
    if (start < 0 || end <= start) continue;
    spans.push({ start, end });
  }
  return spans.sort((a, b) => a.start - b.start || a.end - b.end);
}

export type PauseThresholds = {
  noticeable?: number;
  long?: number;
};

export type PauseAnalysis = {
  noticeableCount: number;
  noticeableTotalSeconds: number;
  longCount: number;
  longTotalSeconds: number;
  longestSeconds: number;
  /** Span window (first start to last end) minus noticeable pauses. */
  speechSeconds: number;
};

/**
 * Measures gaps between consecutive spans. Gaps below the noticeable threshold are
 * normal articulation time, not pauses. Overlapping spans (Whisper can return
 * near-duplicate words) are merged so they don't create phantom pauses, and spans
 * are sorted and validated first so reversed timestamps can't manufacture a gap.
 */
export function analyzePauses(
  spans: TimedSpan[],
  thresholds: PauseThresholds = {},
): PauseAnalysis | null {
  if (spans.length === 0) return null;

  const noticeableThreshold = thresholds.noticeable ?? NOTICEABLE_PAUSE_THRESHOLD_SECONDS;
  const longThreshold = thresholds.long ?? LONG_PAUSE_THRESHOLD_SECONDS;

  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const firstStart = sorted[0].start;
  let cursor = sorted[0].end;
  let noticeableCount = 0;
  let noticeableTotal = 0;
  let longCount = 0;
  let longTotal = 0;
  let longest = 0;

  for (let index = 1; index < sorted.length; index += 1) {
    const span = sorted[index];
    if (span.start <= cursor) {
      cursor = Math.max(cursor, span.end);
      continue;
    }
    const gap = span.start - cursor;
    if (gap >= noticeableThreshold) {
      noticeableCount += 1;
      noticeableTotal += gap;
      longest = Math.max(longest, gap);
      if (gap >= longThreshold) {
        longCount += 1;
        longTotal += gap;
      }
    }
    cursor = span.end;
  }

  return {
    noticeableCount,
    noticeableTotalSeconds: round1(noticeableTotal),
    longCount,
    longTotalSeconds: round1(longTotal),
    longestSeconds: round1(longest),
    speechSeconds: round1(Math.max(0, cursor - firstStart - noticeableTotal)),
  };
}

export type SpeechMetricsInput = {
  transcript: string;
  reportedDurationSeconds?: number | null;
  /** Whisper `words` array (word-level timestamps). */
  words?: unknown;
  /** Whisper `segments` array (segment-level timestamps). */
  segments?: unknown;
};

export function computeSpeechMetrics(input: SpeechMetricsInput): SpeechMetrics {
  const wordCount = countWords(input.transcript);

  const reported = finiteNumber(input.reportedDurationSeconds);
  const reportedDuration = reported !== null && reported > 0 ? round1(reported) : null;

  const wordSpans = normalizeSpans(input.words);
  const segmentSpans = normalizeSpans(input.segments);

  // Word spans give finer pause resolution; coarse segments are the fallback.
  let spans: TimedSpan[] = [];
  let granularity: TimestampGranularity | null = null;
  if (wordSpans.length >= 2) {
    spans = wordSpans;
    granularity = "word";
  } else if (segmentSpans.length > 0) {
    spans = segmentSpans;
    granularity = "segment";
  } else if (wordSpans.length === 1) {
    spans = wordSpans;
    granularity = "word";
  }

  const pause = analyzePauses(spans);
  const firstStart = spans.length > 0 ? spans[0].start : null;
  const lastEnd = spans.length > 0 ? spans[spans.length - 1].end : null;
  const durationSeconds =
    reportedDuration ??
    (lastEnd !== null ? round1(lastEnd) : null);
  const durationBasis: DurationBasis =
    reportedDuration !== null ? "reported" : durationSeconds !== null ? "timestamps" : "unavailable";

  const activeSpeechSeconds =
    pause && firstStart !== null && lastEnd !== null
      ? round1(Math.max(0, lastEnd - firstStart - pause.noticeableTotalSeconds))
      : null;

  // A sub-second window is a timestamp glitch, not a speaking rate.
  // Rates keep one decimal: 42 words in 54s is 46.7 WPM, not 47. Rounding to
  // whole numbers made the displayed figure impossible to reconcile with the
  // word count and duration.
  const speakingRateWpm =
    wordCount > 0 && durationSeconds !== null && durationSeconds >= 1
      ? round1(wordCount / (durationSeconds / 60))
      : null;
  const articulationWpm =
    wordCount > 0 && activeSpeechSeconds !== null && activeSpeechSeconds >= 1
      ? round1(wordCount / (activeSpeechSeconds / 60))
      : null;

  const wpm = speakingRateWpm ?? articulationWpm ?? 0;
  const wpmBasis: RateBasis =
    speakingRateWpm !== null ? "total-duration" : articulationWpm !== null ? "active-speech" : "unavailable";

  const pauseFrequencyPerMinute =
    pause && durationSeconds !== null && durationSeconds > 0
      ? round1(pause.noticeableCount / (durationSeconds / 60))
      : null;

  return {
    wordCount,
    durationSeconds,
    durationBasis,
    activeSpeechSeconds,
    wpm,
    wpmBasis,
    speakingRateWpm,
    articulationWpm,
    timestampGranularity: granularity,
    pausesAvailable: pause !== null,
    pausesLowPrecision: granularity === "segment",
    noticeablePauseThresholdSeconds: NOTICEABLE_PAUSE_THRESHOLD_SECONDS,
    longPauseThresholdSeconds: LONG_PAUSE_THRESHOLD_SECONDS,
    noticeablePauseCount: pause ? pause.noticeableCount : null,
    noticeablePauseTotalSeconds: pause ? pause.noticeableTotalSeconds : null,
    longPauseCount: pause ? pause.longCount : null,
    longPauseTotalSeconds: pause ? pause.longTotalSeconds : null,
    longestPauseSeconds: pause ? pause.longestSeconds : null,
    pauseFrequencyPerMinute,
    pauseCount: pause ? pause.longCount : null,
    pauseThresholdSeconds: LONG_PAUSE_THRESHOLD_SECONDS,
  };
}

function optionalNumber(value: unknown): { ok: boolean; value: number | null } {
  if (value === null || value === undefined) return { ok: true, value: null };
  const numeric = finiteNumber(value);
  if (numeric === null) return { ok: false, value: null };
  return { ok: true, value: numeric };
}

function isRateBasis(value: unknown): value is RateBasis {
  return value === "total-duration" || value === "active-speech" || value === "unavailable";
}

/**
 * Validates metrics coming back from the API or out of localStorage. Returns null
 * for anything that doesn't look like a complete record, so callers can fall back
 * to "no metrics" instead of rendering broken numbers.
 *
 * Sprint 01 records lack the newer fields. They are upgraded in place: the old
 * `pauseCount` was the 1.5s count, which is kept as both the long count and a
 * lower bound for the noticeable count, and the old active-speech WPM becomes the
 * articulation rate.
 */
export function coerceSpeechMetrics(raw: unknown): SpeechMetrics | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const wordCount = finiteNumber(record.wordCount);
  const wpm = finiteNumber(record.wpm);
  if (wordCount === null || wordCount < 0) return null;
  if (wpm === null || wpm < 0) return null;

  const basis = record.wpmBasis;
  if (!isRateBasis(basis)) return null;

  const duration = optionalNumber(record.durationSeconds);
  const active = optionalNumber(record.activeSpeechSeconds);
  const longest = optionalNumber(record.longestPauseSeconds);
  const threshold = optionalNumber(record.pauseThresholdSeconds);
  if (!duration.ok || !active.ok || !longest.ok || !threshold.ok) return null;

  const legacyPauseCount = optionalNumber(record.pauseCount);
  const longCountRaw = optionalNumber(record.longPauseCount);
  const noticeableCountRaw = optionalNumber(record.noticeablePauseCount);
  const noticeableTotalRaw = optionalNumber(record.noticeablePauseTotalSeconds);
  const longTotalRaw = optionalNumber(record.longPauseTotalSeconds);
  const speakingRaw = optionalNumber(record.speakingRateWpm);
  const articulationRaw = optionalNumber(record.articulationWpm);
  const frequencyRaw = optionalNumber(record.pauseFrequencyPerMinute);
  const noticeableThresholdRaw = optionalNumber(record.noticeablePauseThresholdSeconds);
  if (
    !legacyPauseCount.ok ||
    !longCountRaw.ok ||
    !noticeableCountRaw.ok ||
    !noticeableTotalRaw.ok ||
    !longTotalRaw.ok ||
    !speakingRaw.ok ||
    !articulationRaw.ok ||
    !frequencyRaw.ok ||
    !noticeableThresholdRaw.ok
  ) {
    return null;
  }

  const pausesAvailable = record.pausesAvailable === true;
  const granularity =
    record.timestampGranularity === "word" || record.timestampGranularity === "segment"
      ? record.timestampGranularity
      : null;

  const longPauseCount = longCountRaw.value ?? legacyPauseCount.value;
  const longPauseTotalSeconds = longTotalRaw.value ?? null;
  const noticeablePauseCount = noticeableCountRaw.value ?? longPauseCount;
  const noticeablePauseTotalSeconds = noticeableTotalRaw.value ?? longPauseTotalSeconds;
  const resolvedDuration = duration.value;

  let pauseFrequencyPerMinute = frequencyRaw.value;
  if (
    pauseFrequencyPerMinute === null &&
    pausesAvailable &&
    resolvedDuration !== null &&
    resolvedDuration > 0 &&
    noticeablePauseCount !== null
  ) {
    pauseFrequencyPerMinute = round1(noticeablePauseCount / (resolvedDuration / 60));
  }

  const speakingRateWpm =
    speakingRaw.value ?? (basis === "total-duration" ? round1(wpm) : null);
  const articulationWpm =
    articulationRaw.value ?? (basis === "active-speech" ? round1(wpm) : null);

  const durationBasis: DurationBasis =
    record.durationBasis === "reported" ||
    record.durationBasis === "timestamps" ||
    record.durationBasis === "unavailable"
      ? record.durationBasis
      : resolvedDuration !== null
        ? "reported"
        : "unavailable";

  return {
    wordCount: Math.round(wordCount),
    durationSeconds: resolvedDuration,
    durationBasis,
    activeSpeechSeconds: active.value,
    wpm: round1(wpm),
    wpmBasis: basis,
    speakingRateWpm: speakingRateWpm !== null ? round1(speakingRateWpm) : null,
    articulationWpm: articulationWpm !== null ? round1(articulationWpm) : null,
    timestampGranularity: granularity,
    pausesAvailable,
    pausesLowPrecision: record.pausesLowPrecision === true || granularity === "segment",
    noticeablePauseThresholdSeconds:
      noticeableThresholdRaw.value ?? NOTICEABLE_PAUSE_THRESHOLD_SECONDS,
    longPauseThresholdSeconds: LONG_PAUSE_THRESHOLD_SECONDS,
    noticeablePauseCount,
    noticeablePauseTotalSeconds,
    longPauseCount,
    longPauseTotalSeconds,
    longestPauseSeconds: longest.value,
    pauseFrequencyPerMinute,
    pauseCount: longPauseCount,
    pauseThresholdSeconds: threshold.value ?? LONG_PAUSE_THRESHOLD_SECONDS,
  };
}
