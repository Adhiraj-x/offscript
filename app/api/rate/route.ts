import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { GROQ_BASE_URL, GROQ_CHAT_MODEL } from "@/lib/groq";

export const runtime = "nodejs";
export const maxDuration = 30;

const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
const MIN_WORDS = 15;
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
const MAX_TOPIC_LENGTH = 300;

const FILLER_PATTERN = /\b(um+|uh+|er+|ah+|like|you know|basically|actually|so)\b/gi;

const SYSTEM_PROMPT = `You are Offscript, a direct but encouraging speaking coach. You grade one spoken answer from its transcript and delivery metrics.

Return ONLY a JSON object with exactly these keys:
{
  "contentScore": number,
  "deliveryScore": number,
  "overallScore": number,
  "feedback": string,
  "strengths": string[],
  "improvements": string[]
}

Rules:
- contentScore (0-100): structure, relevance to the topic, and depth of argument.
- deliveryScore (0-100): filler words, pacing (use the supplied WPM), and clarity as visible in the transcript.
- overallScore (0-100): holistic read of content and delivery together.
- feedback: 3-4 sentences in the second person. It MUST include an explicit comment on pacing, quoting the WPM.
- strengths: 2-3 short concrete items.
- improvements: 2-3 short, actionable items.
- Do not use markdown, code fences, or extra keys. Return one JSON object only.`;

type ScoreInput = {
  contentScore: number;
  deliveryScore: number;
  overallScore: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
};

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

function countFillers(text: string): number {
  // Fresh regex per call so lastIndex state can never leak.
  const matches = text.match(new RegExp(FILLER_PATTERN.source, "gi"));
  return matches ? matches.length : 0;
}

function toScore(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN;
  if (!Number.isFinite(numeric)) return null;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

function toStringArray(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0)
    .slice(0, limit);
}

function normalizeScores(raw: unknown, wpm: number): ScoreInput {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const contentScore = toScore(record.contentScore ?? record.content) ?? 60;
  const deliveryScore = toScore(record.deliveryScore ?? record.delivery) ?? 60;
  const overallScore =
    toScore(record.overallScore ?? record.overall) ?? Math.round((contentScore + deliveryScore) / 2);

  const feedbackRaw = typeof record.feedback === "string" ? record.feedback.trim() : "";
  const feedback =
    feedbackRaw.length > 0
      ? feedbackRaw
      : `You landed around ${overallScore}/100 here. At ${wpm} WPM your pacing ${
          wpm < 120 ? "left room to pick up energy" : wpm > 160 ? "ran hot, so trim the sprint" : "sat in a comfortable range"
        }, and your argument was ${contentScore >= 70 ? "clear enough to follow" : "still finding its shape"}. Tighten the opening, keep one core claim, and give it a concrete example.`;

  const strengths = toStringArray(record.strengths);
  const improvements = toStringArray(record.improvements);

  return {
    contentScore,
    deliveryScore,
    overallScore,
    feedback,
    strengths: strengths.length > 0 ? strengths : ["You showed up and talked through it out loud."],
    improvements:
      improvements.length > 0
        ? improvements
        : ["Open with a one-sentence claim before the supporting detail."],
  };
}

function parseJsonObject(text: string): unknown | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "CONFIG",
        message: "Server is missing GROQ_API_KEY. Add it to .env.local and restart the dev server.",
      },
      { status: 500 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "Couldn't read that recording. Try again." },
      { status: 400 },
    );
  }

  const audio = form.get("audio");
  const topic = String(form.get("topic") ?? "").slice(0, MAX_TOPIC_LENGTH) || "An open topic";
  const mode = String(form.get("mode") ?? "off-the-cuff");

  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "No audio was uploaded. Try recording again." },
      { status: 400 },
    );
  }
  if (audio.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "TOO_LARGE", message: "That recording is too large. Keep it under two minutes." },
      { status: 413 },
    );
  }

  const client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });

  try {
    const extension = (audio.type || "").includes("mp4") ? "m4a" : "webm";
    const upload = await toFile(
      new Uint8Array(await audio.arrayBuffer()),
      `take.${extension}`,
      { type: audio.type || "audio/webm" },
    );

    const transcription = (await client.audio.transcriptions.create({
      file: upload,
      model: TRANSCRIBE_MODEL,
      response_format: "verbose_json",
      language: "en",
      temperature: 0,
    })) as unknown as { text?: string; duration?: number };

    const transcript = (transcription.text ?? "").trim();
    const wordCount = countWords(transcript);
    const reportedDuration =
      typeof transcription.duration === "number" && transcription.duration > 0
        ? transcription.duration
        : null;

    if (wordCount < MIN_WORDS) {
      // Enough to tell a silent mic apart from a short take; the transcript itself is not logged.
      console.log("[api/rate] not enough speech", {
        bytes: audio.size,
        mime: audio.type,
        words: wordCount,
        seconds: reportedDuration,
      });
      return NextResponse.json(
        {
          error: "TOO_SHORT",
          message: "We couldn't hear enough to score that — try again with a longer take.",
          transcript,
          wordCount,
          duration: reportedDuration,
          wpm: 0,
          fillerWordCount: countFillers(transcript),
        },
        { status: 422 },
      );
    }

    // Fall back to a nominal 150 WPM read if the API omits duration.
    const minutes = reportedDuration ? reportedDuration / 60 : wordCount / 150;
    const wpm = Math.round(wordCount / minutes);

    const fillerWordCount = countFillers(transcript);

    const userPrompt = `Topic: ${topic}
Mode: ${mode}
Words spoken: ${wordCount}
Duration: ${reportedDuration ? Math.round(reportedDuration) : "unknown"} seconds
Pacing: ${wpm} WPM
Filler words counted: ${fillerWordCount}

Transcript:
"""${transcript}"""

Score this answer and return the JSON object.`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    let scores: ScoreInput | null = null;
    for (let attempt = 0; attempt < 2 && !scores; attempt += 1) {
      const completion = await client.chat.completions.create({
        model: GROQ_CHAT_MODEL,
        messages,
        temperature: 0.3,
        max_tokens: 900,
        response_format: { type: "json_object" },
      });

      const text = completion.choices[0]?.message?.content ?? "";
      const parsed = parseJsonObject(text);
      if (parsed) {
        scores = normalizeScores(parsed, wpm);
        break;
      }

      // Retry once: tell the model exactly what went wrong.
      messages.push({ role: "assistant", content: text || "(empty reply)" });
      messages.push({
        role: "user",
        content:
          "That reply was not valid JSON. Reply again with ONLY the JSON object described in the system prompt.",
      });
    }

    if (!scores) {
      return NextResponse.json(
        { error: "SCORING_FAILED", message: "The coach couldn't score that one. Try again in a moment." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      ...scores,
      wpm,
      fillerWordCount,
      transcript,
      wordCount,
    });
  } catch (error) {
    if (statusOf(error) === 429) {
      return NextResponse.json(
        { error: "RATE_LIMIT", message: "Free limit hit, try again in a minute." },
        { status: 429 },
      );
    }
    console.error("[api/rate]", error);
    return NextResponse.json(
      { error: "UPSTREAM", message: "Something broke while rating that take. Try again in a moment." },
      { status: 502 },
    );
  }
}
