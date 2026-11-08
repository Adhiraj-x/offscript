/**
 * Context-aware, transcript-based filler detection.
 *
 * Two tiers:
 *
 * DEFINITE hesitations (um, uh, er/erm, ah, hmm) are counted wherever they appear as
 * standalone words. Spelling variants collapse onto one display key ("umm", "ummm"
 * -> um), and hyphenated forms ("uh-huh", "mm-hmm") are left alone because they are
 * words, not hesitations.
 *
 * CONTEXTUAL markers (like, so, well, look, actually, basically, I mean, you know)
 * are counted only when there is positive evidence that they are doing discourse
 * work: they are marked off by punctuation, they sit next to a definite hesitation,
 * or the word timestamps show a hesitation gap around them. Grammar wins over that
 * evidence: a comparison ("is like a portable light"), a verb ("I like coffee"),
 * a prepositional verb ("Look at that building") or a real object ("You know the
 * answer") is never counted, even when Whisper inserted a comma.
 *
 * Punctuation alone is deliberately not enough for "like": Whisper puts commas
 * inside perfectly ordinary comparisons, which is exactly how the Sprint 2.1
 * detector counted "A lantern is like, a portable light".
 *
 * Repeated hesitations ("uh uh", "um um", "hmm um") are counted token by token and
 * also recorded as runs, so a run is never counted as extra fillers. Total always
 * equals definite + contextual, and the breakdown always sums to the total.
 *
 * Known limits: this runs on machine transcription, so counts are an ESTIMATE. A
 * filler Whisper dropped cannot be recovered here, and an unpunctuated "well I
 * think" has no evidence to justify counting, so it is left alone. Nothing is
 * invented.
 */

import { countWords } from "./speechMetrics";

export type FillerBreakdown = {
  /** Definite + contextual detections. */
  total: number;
  definiteCount: number;
  contextualCount: number;
  /** Number of consecutive hesitation runs, e.g. "uh uh" counts once. */
  repeatedRunCount: number;
  /** Detected fillers per 100 transcribed words. Null when there is no text. */
  per100Words: number | null;
  /** Canonical term -> count. Only terms that occurred are present. */
  counts: Record<string, number>;
  isEstimate: true;
};

/** Counted whenever they appear as standalone words. Canonical display keys. */
export const DEFINITE_FILLERS = ["um", "uh", "er", "ah", "hmm"] as const;

/** Counted only with discourse-marker evidence. */
export const CONTEXTUAL_FILLERS = [
  "like",
  "so",
  "well",
  "look",
  "actually",
  "basically",
  "i mean",
  "you know",
] as const;

/** A gap at least this long around a contextual marker is hesitation evidence. */
export const HESITATION_GAP_SECONDS = 0.25;

/* -------------------------------------------------------------------------- */
/* Tokenising                                                                  */
/* -------------------------------------------------------------------------- */

type Token = {
  /** Lowercase word with internal apostrophes kept, punctuation stripped. */
  word: string;
  start: number;
  end: number;
  /** Raw text between the previous token and this one. */
  before: string;
  /** Raw text between this token and the next one. */
  after: string;
};

function tokenize(source: string): Token[] {
  const pattern = /[A-Za-z]+(?:['\u2019][A-Za-z]+)*/g;
  const tokens: Token[] = [];
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    tokens.push({
      word: match[0].toLowerCase().replace(/\u2019/g, "'"),
      start,
      end,
      before: source.slice(cursor, start),
      after: "",
    });
    cursor = end;
  }
  for (let index = 0; index < tokens.length; index += 1) {
    tokens[index].after =
      index + 1 < tokens.length ? tokens[index + 1].before : source.slice(cursor);
  }
  return tokens;
}

/**
 * Punctuation that marks a spoken aside. A full stop, question mark or exclamation
 * mark is not enough on its own: "Look! A bird." and "what I mean?" are not asides.
 */
const ASIDE_PUNCTUATION = /[,;:]/;

function isHyphenated(token: Token): boolean {
  return (
    /[-\u2013\u2014]\s*$/.test(token.before) || /^\s*[-\u2013\u2014]/.test(token.after)
  );
}

/* -------------------------------------------------------------------------- */
/* Definite hesitations                                                        */
/* -------------------------------------------------------------------------- */

/** Maps every accepted spelling onto one stable display key. */
function definiteKey(word: string): string | null {
  if (/^u+m+$/.test(word)) return "um";
  if (/^u+h+$/.test(word)) return "uh";
  if (/^e+r+m*$/.test(word)) return "er";
  if (/^a+h+$/.test(word)) return "ah";
  if (/^h+m+$/.test(word)) return "hmm";
  return null;
}

/* -------------------------------------------------------------------------- */
/* Contextual markers                                                          */
/* -------------------------------------------------------------------------- */

/** Forms of "to be" and perception verbs that introduce a comparison. */
const COPULA_BEFORE = new Set([
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "it's",
  "that's",
  "there's",
  "he's",
  "she's",
  "looks",
  "looked",
  "look",
  "sounds",
  "sounded",
  "sound",
  "feels",
  "felt",
  "seems",
  "seemed",
  "seem",
]);

/** Subjects that turn "like" into the verb "to like". */
const LIKE_VERB_SUBJECT = new Set([
  "i",
  "we",
  "you",
  "they",
  "he",
  "she",
  "it",
  "people",
  "everyone",
  "someone",
  "anyone",
  "who",
  "don't",
  "doesn't",
  "didn't",
  "wouldn't",
  "can't",
]);

/** Adverbs between a subject and "like" ("I really like it"). */
const LIKE_VERB_ADVERB = new Set([
  "really",
  "also",
  "still",
  "just",
  "never",
  "always",
  "definitely",
  "genuinely",
]);

/** Prepositions that make "look" a real verb. */
const LOOK_PREPOSITION_AFTER = new Set([
  "at",
  "for",
  "like",
  "into",
  "through",
  "up",
  "down",
  "back",
  "around",
  "after",
  "forward",
  "to",
  "in",
  "on",
  "over",
  "out",
  "under",
]);

const LOOK_VERB_BEFORE = new Set([
  "i",
  "we",
  "you",
  "they",
  "he",
  "she",
  "it",
  "to",
  "don't",
  "can't",
  "didn't",
  "will",
  "would",
  "could",
  "should",
  "let's",
]);

/** Degree words that make "well" an adverb ("works well", "as well"). */
const WELL_ADVERB_BEFORE = new Set([
  "as",
  "very",
  "quite",
  "really",
  "pretty",
  "fairly",
  "so",
  "too",
  "how",
  "least",
  "most",
]);

/** Complements that make "so" a conjunction or intensifier, not a marker. */
const SO_COMPLEMENT_AFTER = new Set([
  "that",
  "much",
  "many",
  "far",
  "long",
  "on",
  "to",
  "few",
  "little",
]);

/** Objects that make "I mean" a literal statement. */
const MEAN_LITERAL_AFTER = new Set([
  "that",
  "it",
  "you",
  "the",
  "this",
  "these",
  "those",
  "what",
  "yes",
  "no",
  "him",
  "her",
  "them",
]);

/** Objects that make "you know" a real clause, not a tag. */
const KNOW_LITERAL_AFTER = new Set([
  "the",
  "that",
  "this",
  "these",
  "those",
  "a",
  "an",
  "what",
  "who",
  "how",
  "why",
  "where",
  "when",
  "if",
  "it",
  "him",
  "her",
  "them",
  "everything",
  "nothing",
  "anything",
  "something",
  "my",
  "your",
  "his",
  "their",
  "our",
]);

type WordTiming = { start: number; end: number };

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
 * Word timestamps are only useful if they line up one-to-one with the transcript
 * tokens. A count mismatch, a broken entry or too many different words means the
 * alignment can't be trusted, so timings are ignored rather than misapplied.
 */
function alignTimings(tokens: Token[], raw: unknown): WordTiming[] | null {
  if (!Array.isArray(raw) || raw.length !== tokens.length || raw.length === 0) return null;

  const timings: WordTiming[] = [];
  let matchedWords = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    if (!entry || typeof entry !== "object") return null;
    const record = entry as { word?: unknown; start?: unknown; end?: unknown };
    const start = finiteNumber(record.start);
    const end = finiteNumber(record.end);
    if (start === null || end === null || start < 0 || end <= start) return null;
    if (typeof record.word === "string") {
      const cleaned = record.word.toLowerCase().replace(/[^a-z']/g, "");
      if (cleaned === tokens[index].word) matchedWords += 1;
    }
    timings.push({ start, end });
  }

  return matchedWords / raw.length >= 0.9 ? timings : null;
}

/** True when a hesitation gap sits before or after the marker. */
function pauseSupport(
  timings: WordTiming[] | null,
  index: number,
  length: number,
): boolean {
  if (timings === null) return false;
  const first = timings[index];
  const last = timings[index + length - 1];
  if (!first || !last) return false;

  const previous = index > 0 ? timings[index - 1] : null;
  const next = index + length < timings.length ? timings[index + length] : null;
  const gapBefore = previous ? first.start - previous.end : 0;
  const gapAfter = next ? next.start - last.end : 0;

  return gapBefore >= HESITATION_GAP_SECONDS || gapAfter >= HESITATION_GAP_SECONDS;
}

/**
 * Grammar that proves the word is carrying its literal meaning. Checked before the
 * evidence, because Whisper's commas are not reliable inside comparisons.
 */
function isLiteralUse(
  term: string,
  context: { previous: string | null; next: string | null; asideBefore: boolean; asideAfter: boolean },
): boolean {
  const { previous, next, asideBefore, asideAfter } = context;

  switch (term) {
    case "like":
      if (
        !asideBefore &&
        previous !== null &&
        (COPULA_BEFORE.has(previous) ||
          LIKE_VERB_SUBJECT.has(previous) ||
          LIKE_VERB_ADVERB.has(previous))
      ) {
        return true;
      }
      return false;
    case "look":
      if (!asideAfter && next !== null && LOOK_PREPOSITION_AFTER.has(next)) return true;
      if (!asideBefore && previous !== null && LOOK_VERB_BEFORE.has(previous)) return true;
      return false;
    case "well":
      if (!asideBefore && previous !== null && WELL_ADVERB_BEFORE.has(previous)) return true;
      return false;
    case "so":
      if (!asideAfter && next !== null && SO_COMPLEMENT_AFTER.has(next)) return true;
      return false;
    case "i mean":
      if (!asideAfter && next !== null && MEAN_LITERAL_AFTER.has(next)) return true;
      return false;
    case "you know":
      if (!asideAfter && next !== null && KNOW_LITERAL_AFTER.has(next)) return true;
      return false;
    default:
      return false;
  }
}

function isContextualFiller(
  tokens: Token[],
  index: number,
  length: number,
  timings: WordTiming[] | null,
): boolean {
  const first = tokens[index];
  const last = tokens[index + length - 1];
  const term = tokens
    .slice(index, index + length)
    .map((token) => token.word)
    .join(" ");
  const previous = index > 0 ? tokens[index - 1].word : null;
  const next = index + length < tokens.length ? tokens[index + length].word : null;
  const asideBefore = ASIDE_PUNCTUATION.test(first.before);
  const asideAfter = ASIDE_PUNCTUATION.test(last.after);

  if (isLiteralUse(term, { previous, next, asideBefore, asideAfter })) return false;

  // Marked off as an aside, e.g. "So, ..." / "It was, like, really ...".
  if (asideBefore || asideAfter) return true;

  // "um, like" / "like, uh": next to a definite hesitation.
  if (previous !== null && definiteKey(previous) !== null) return true;
  if (next !== null && definiteKey(next) !== null) return true;

  // "you know?" / "... , you know." — tag position.
  if (term === "you know") {
    if (!next) return true;
    if (/^[.!?]/.test(last.after.trim())) return true;
  }

  // A measurable hesitation gap around the marker.
  return pauseSupport(timings, index, length);
}

/* -------------------------------------------------------------------------- */
/* Detection                                                                   */
/* -------------------------------------------------------------------------- */

export type FillerDetectionOptions = {
  wordCount?: number;
  /**
   * Whisper's `words` array. Only used when it aligns one-to-one with the
   * transcript; otherwise it is ignored and detection stays text-only.
   */
  wordTimings?: unknown;
};

/** Consecutive definite fillers are one hesitation run, counted once. */
function countRepeatedRuns(definiteIndices: number[]): number {
  let runs = 0;
  let runLength = 1;
  for (let index = 1; index < definiteIndices.length; index += 1) {
    if (definiteIndices[index] === definiteIndices[index - 1] + 1) {
      runLength += 1;
      if (runLength === 2) runs += 1;
    } else {
      runLength = 1;
    }
  }
  return runs;
}

const SINGLE_CONTEXTUAL = new Set(["like", "so", "well", "look", "actually", "basically"]);

export function detectFillers(
  text: string,
  options: FillerDetectionOptions = {},
): FillerBreakdown {
  const source = typeof text === "string" ? text : "";
  const tokens = tokenize(source);
  const timings = alignTimings(tokens, options.wordTimings);

  const counts: Record<string, number> = {};
  const bump = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };

  let definiteCount = 0;
  const definiteIndices: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const key = definiteKey(token.word);
    if (key === null) continue;
    // "uh-huh" and "mm-hmm" are affirmations written as hyphenated words.
    if (isHyphenated(token)) continue;
    bump(key);
    definiteCount += 1;
    definiteIndices.push(index);
  }

  let contextualCount = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const following = index + 1 < tokens.length ? tokens[index + 1].word : null;

    let term: string | null = null;
    let length = 1;
    if (token.word === "you" && following === "know") {
      term = "you know";
      length = 2;
    } else if (token.word === "i" && following === "mean") {
      term = "i mean";
      length = 2;
    } else if (SINGLE_CONTEXTUAL.has(token.word)) {
      term = token.word;
    }

    if (term === null) continue;
    if (!isContextualFiller(tokens, index, length, timings)) continue;

    bump(term);
    contextualCount += 1;
    index += length - 1;
  }

  const total = definiteCount + contextualCount;
  const wordCount = options.wordCount ?? countWords(source);

  return {
    total,
    definiteCount,
    contextualCount,
    repeatedRunCount: countRepeatedRuns(definiteIndices),
    per100Words: fillersPer100Words(total, wordCount),
    counts,
    isEstimate: true,
  };
}

/** Detected fillers per 100 transcribed words, one decimal. */
export function fillersPer100Words(total: number, wordCount: number): number | null {
  if (!Number.isFinite(total) || !Number.isFinite(wordCount) || wordCount <= 0) return null;
  return Math.round((Math.max(0, total) / wordCount) * 1000) / 10;
}

/** Short human-readable summary, e.g. "um 3, uh 1, like 2". */
export function summarizeFillers(breakdown: FillerBreakdown): string {
  const entries = Object.entries(breakdown.counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "none detected";
  return entries.map(([term, count]) => `${term} ${count}`).join(", ");
}

function countOrNull(value: unknown): { ok: boolean; value: number | null } {
  if (value === null || value === undefined) return { ok: true, value: null };
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return { ok: false, value: null };
  return { ok: true, value: Math.round(numeric) };
}

/** Rates keep one decimal, unlike whole-word counts. */
function rateOrNull(value: unknown): { ok: boolean; value: number | null } {
  if (value === null || value === undefined) return { ok: true, value: null };
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return { ok: false, value: null };
  return { ok: true, value: Math.round(numeric * 10) / 10 };
}

/**
 * Validates a stored breakdown. A malformed or self-contradictory blob is dropped
 * rather than rendered, so the totals on screen can always be reconciled. Sessions
 * saved before fillers were stored simply have no breakdown, and an old record whose
 * keys predate normalisation (e.g. "erm") is kept as stored.
 */
export function coerceFillers(raw: unknown): FillerBreakdown | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const total = countOrNull(record.total);
  const definite = countOrNull(record.definiteCount);
  const contextual = countOrNull(record.contextualCount);
  if (!total.ok || !definite.ok || !contextual.ok) return null;
  if (total.value === null || definite.value === null || contextual.value === null) return null;
  if (definite.value + contextual.value !== total.value) return null;

  const repeated = countOrNull(record.repeatedRunCount);
  const per100 = rateOrNull(record.per100Words);
  if (!repeated.ok || !per100.ok) return null;

  const counts: Record<string, number> = {};
  if (record.counts && typeof record.counts === "object" && !Array.isArray(record.counts)) {
    for (const [term, value] of Object.entries(record.counts as Record<string, unknown>)) {
      const count = countOrNull(value);
      if (count.ok && count.value !== null && count.value > 0) counts[term] = count.value;
    }
  }

  // The breakdown has to add up to the headline number it is displayed next to.
  const breakdownTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (breakdownTotal !== total.value) return null;

  return {
    total: total.value,
    definiteCount: definite.value,
    contextualCount: contextual.value,
    repeatedRunCount: repeated.value ?? 0,
    per100Words: per100.value,
    counts,
    isEstimate: true,
  };
}
