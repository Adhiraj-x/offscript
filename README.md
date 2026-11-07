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
  `whisper-large-v3-turbo` (`verbose_json`, `language: "en"`), computes WPM and filler words, then
  asks a Groq chat model in JSON mode to score content, delivery and overall. Groq has retired
  `llama-3.3-70b-versatile`, so the default is now `openai/gpt-oss-120b`; set `GROQ_CHAT_MODEL` to
  swap it without touching code. Scores are
  clamped to 0–100, missing fields get defaults, and a single retry covers JSON parse failures.
  Takes under ~15 words come back as a friendly "we couldn't hear enough" instead of a score, and
  a Groq 429 surfaces as "Free limit hit, try again in a minute".
- **Results** — score bars, WPM label (`<120` Slow, `120–160` Good pace, `>160` Fast), filler count,
  feedback, strengths/improvements and the transcript. "Share result" renders a 1080×1080 branded
  PNG with `html-to-image`.
- **Storage** — sessions under `offscript_history_v1` via `lib/storage.ts` (all access wrapped in
  try/catch). Streaks and the 30-day heatmap come from `lib/streak.ts`.
- **History** — `/history` lists sessions newest first; click a card for feedback and transcript.

## Deploying to Vercel (free Hobby)

1. Push the repo and import it at [vercel.com/new](https://vercel.com/new).
2. Add `GROQ_API_KEY` under Project → Settings → Environment Variables. Optionally set
   `GROQ_CHAT_MODEL` to pin a specific Groq chat model.
3. Deploy. The rating route sets `export const maxDuration = 30` and `runtime = "nodejs"`.

Audio never touches a database or disk — it is transcribed in the request and discarded.
