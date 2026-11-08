# Offscript

A speaking practice tool with AI feedback. Pick a mode, spin a debate-style topic, prep, then
talk for up to two minutes. Groq transcribes the take and grades content and delivery; your
sessions are kept in `localStorage` so streaks and history work without a database or an account.

Next.js 14 (App Router) · TypeScript · Tailwind · OpenAI SDK pointed at Groq.

## Setup

1. Get a free Groq key at [console.groq.com/keys](https://console.groq.com/keys) (transcription +
   scoring) and a free Gemini key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   (topic generation).
2. Create `.env.local` in the project root:

   ```bash
   cp .env.example .env.local
   ```

   Then set the key (server-side only — it is never exposed to the browser):

   ```
   GROQ_API_KEY=gsk_your_key_here
   GEMINI_API_KEY=your_gemini_key_here
   GEMINI_TOPIC_MODEL=gemini-3.5-flash-lite
   ```

3. Install and run:

   ```bash
   npm install
   npm run dev
   ```

4. Open <http://localhost:3000> and allow microphone access when prompted.

## How it works

- **Modes** — _Off the Cuff_ (60s prep) or _Deep Research_ (10 min prep), defined in `lib/modes.ts`.
- **Topics** — 60 hardcoded prompts in `lib/topics.ts` across four categories (word, statement,
  general, trend), picked category-first so no shape dominates. `GET/POST /api/topics` asks Gemini
  (free tier) for 25 topics per category, retries once on bad JSON, and falls back to Groq on any
  failure; a 30-minute per-category cache in the route keeps repeat refreshes off both providers.
  Trend prompts are built from live Hacker News + Google News headlines. `lib/topicPool.ts` caches
  batches in `localStorage` under `offscript_topics_v1`, tops a category up in the background only
  when it has fewer than 5 unused topics (trends at most every 24h, others every 7 days), and
  removes a topic once used. The static list is always the offline fallback. Voice audio and
  transcripts never reach Gemini — see the note in `lib/llm.ts`.
- **Speak** — `MediaRecorder` records up to 2 minutes as `audio/webm` (`audio/mp4` on Safari),
  with a visible recording indicator and graceful mic-permission errors.
- **Rate** — `POST /api/rate` sends the blob as `FormData`. The route transcribes it with
  `whisper-large-v3-turbo` (`verbose_json`, `language: "en"`, `temperature: 0`) plus a
  lexical `prompt` defined in `lib/transcription.ts` — a short hesitation list (um, uh, erm, er,
  ah, hmm, like, so, well, I mean, you know) with no instructions and no sentence structure.
  Whisper decodes that prompt as preceding text rather than as a command, and a full instruction
  sentence from the previous prompt once came back inside a real transcript, so it is now priming
  only. Nothing in the transcript is trimmed or rewritten afterwards. The route also asks for
  `timestamp_granularities: ["word", "segment"]`; if the provider rejects the granularity
  parameter it retries once with segment timestamps only, keeping the model, language and prompt.
  `lib/speechMetrics.ts` then reports recording length, estimated active speaking time, two rates,
  and pauses at two thresholds — **noticeable** (0.5s+) and **long** (1.5s+) — plus longest pause
  and pause frequency per minute. With no timestamps, pause figures are unavailable rather than
  guessed, and pace falls back to total duration or "unavailable". Segment-only timings are flagged
  as lower precision because a pause inside a segment cannot be observed.
- **Scoring** — `lib/scoring.ts` holds the anchored content rubric (0–39 very weak, 40–59 needs
  improvement, 60–74 competent, 75–89 strong, 90–100 excellent), the transcript-error rules, and the
  overall formula: **60% content + 40% delivery**, recomputed on the server so the weighting can't
  drift. Both scores are the model's judgement. It grades content against the rubric and delivery
  holistically from the transcript plus the measured pace, pause, filler and repetition figures,
  which are supplied as supporting evidence rather than converted into a score. There is no
  deterministic delivery formula and no subscore weighting: a same-audio A/B test showed a computed
  delivery score of 74 for a take that the original deployment and the speaker both put near 45.
  `classifyPace` still labels the measured speaking rate (below 70 very slow, 70 up to but not
  including 90 slow, 90 up to but not including 110 somewhat slow, 110–160 comfortable, above 160 up
  to 180 somewhat fast, above 180 very fast; the bands are continuous, so every measured rate lands
  in exactly one). That exact label is supplied to the model and must be reused in the feedback;
  `checkPaceLabelConsistency` rejects a different band name ("very slow" at 79 WPM), with one
  corrected retry and a server warning rather than a lost take if it persists. The prompt requires
  the feedback to explain why the score was awarded, to keep every claim traceable to the transcript,
  never to claim vocal or acoustic analysis, to treat filler counts and timings as estimates, and
  never to treat a clean transcript as proof of clean delivery. Replies are validated: both scores
  must be finite numbers (clamped to 0–100), feedback must exist, and 2–3 strengths plus 2–3
  improvements are required. Invalid JSON or an invalid score gets one corrected retry
  (`lib/rateAnswer.ts`), then the request fails with an honest message instead of default scores.
  `lib/fillers.ts` counts definite hesitations on sight (um, uh, er/erm, ah, hmm, each
  normalised to one key), records repeated hesitation runs, and counts *look / well / I mean /
  like / so / actually / basically / you know* only with discourse-marker evidence: marked-off
  punctuation, a neighbouring hesitation, or a hesitation gap in the word timestamps. Literal
  grammar always wins, so "is like a portable light", "I like coffee", "Look at that building"
  and "You know the answer" are never counted, even when the transcript has a comma. Takes under ~15 words come back as "we couldn't hear enough"
  instead of a score, and a Groq 429 surfaces as "Free limit hit, try again in a minute". Groq has
  retired `llama-3.3-70b-versatile`, so the default chat model is `openai/gpt-oss-120b`; override
  with `GROQ_CHAT_MODEL`.
- **Results** — score bars with band labels and the 60/40 note, then three metric groups. Pace:
  speaking rate (pauses included) with its classification, articulation rate (pauses excluded,
  both shown to one decimal, e.g. 46.7 WPM), estimated active speech, total recording length. Pauses: noticeable count, long count, longest
  pause, per-minute frequency, or an explicit "not measurable" panel. Fillers: detected total, rate
  per 100 words, word count and the detected terms. Estimates are labelled, low-precision segment
  timings are called out, and nothing is shown as exact. "Share result" still renders a 1080×1080
  branded PNG with `html-to-image`.
- **Storage** — sessions under `offscript_history_v1` via `lib/storage.ts` (all access wrapped in
  try/catch). Streaks and the 30-day heatmap come from `lib/streak.ts`.
- **History** — `/history` lists sessions newest first; click a card for feedback and transcript.

## Tests

```bash
npm test        # node:test via tsx — metrics, fillers, reply validation, regression, storage
npm run typecheck
```

No test runner is bundled beyond `tsx` (dev-only); the suites import the pure modules directly.
`tests/regression.test.ts` replays the 42-word, 54-second take and checks that the prompt carries
the measured evidence (46.7 WPM, Very slow, pauses, filler estimate), that a low AI delivery score
of 45 is accepted and produces a 66 overall under the 60/40 rule, and that no precomputed delivery
score survives in the prompt. `tests/rateAnswer.test.ts` mocks the model to cover the single
corrective retry, honest failure without default scores, and the pace-label fallback.
`tests/fillers.test.ts` replays the lantern take from the same round of testing: 13 detections
before the context rules, 12 after, with the two false "like" comparisons removed and "hmm" now
found. These are unit tests with mocked or fixture data; they do not establish real-world scoring
accuracy.

## Repeating the same-audio A/B test

The delivery score is now the model's judgement, so the only meaningful test is the same recording
run through the original deployment and the current build:

1. Record one take (40–90 seconds) that you would describe as poor delivery: deliberately slow,
   with several fillers and a few long pauses. Say how you would rate your own delivery out of 100
   before you look at either score.
2. Score the same file on the original deployed version and on this branch (`npm run dev` locally,
   or a preview deployment). Use the same topic and mode.
3. Record, side by side: content score, delivery score, overall score, transcript, and the spoken
   rate/pause/filler figures. Whisper can return slightly different text between runs, so compare
   the transcripts before blaming the scoring.
4. Check the comparison you care about: does the delivery score now reflect the take you heard, and
does the written feedback explain that number using the measurements? A 40–50 delivery score for a
slow, hesitant take is a valid outcome, not a bug.
5. Repeat with one fluent, comfortable take to confirm the model is not simply harsher everywhere.
6. Change the prompt or scoring rules only if both takes move in the right direction. Two calls per
   recording are enough; do not bulk-run the API.

## Verifying transcription against real audio

The transcription prompt is a nudge, not a guarantee, and prompt text can be echoed back as
speech, so verify it against a recording you control before trusting a transcript:

1. Record one take of 40–60 seconds that deliberately contains repeated "um", "uh", "look" and
   "you know", plus a couple of ordinary uses ("I like coffee", "it's like this").
2. Play it back once and write down the fillers you actually said, in order.
3. Run the file through the app (or `POST /api/rate`) and compare the transcript against the audio
   line by line:
   - No instruction-like sentence appears in the transcript. Any sentence that reads like a
     command — the old prompt ended with "Never insert words that were not spoken." — is prompt
     leakage, not speech, and must be fixed in `lib/transcription.ts`, never by stripping text.
   - Every word in the transcript was actually said. Whisper can hallucinate on silence, so pause
     for two seconds at the start and end and check nothing appears there.
   - The fillers you wrote down survive in the transcript, and the ordinary "like"/"so" uses are
     not turned into extra words.
4. A/B the priming: send the identical file twice, once with `buildTranscriptionRequest(true)` and
   once with the prompt omitted (`prompt: undefined`), keeping the model, language, temperature and
   response format the same. Compare how many real fillers each kept and whether either added text.
5. Only keep a prompt change if it recovers more real fillers without inventing words.

Status: the leakage sentence was reproduced in a real transcript and the instruction text has been
removed in favour of the lexical list, but the replacement has not been re-tested against audio in
this repository. Record a take and repeat the steps above before treating it as confirmed. Whisper
can still drop hesitations, which is why filler numbers stay labelled estimates.

Do not run this in production or bulk-call the API; two calls per recording are enough.

## Deploying to Vercel (free Hobby)

1. Push the repo and import it at [vercel.com/new](https://vercel.com/new).
2. Add `GROQ_API_KEY` under Project → Settings → Environment Variables. Optionally set
   `GROQ_CHAT_MODEL` to pin a specific Groq chat model.
3. Deploy. The rating route sets `export const maxDuration = 30` and `runtime = "nodejs"`.

Audio never touches a database or disk — it is transcribed in the request and discarded.
