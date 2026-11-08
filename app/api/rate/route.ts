import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { GROQ_BASE_URL, GROQ_CHAT_MODEL } from "@/lib/groq";
import { detectFillers } from "@/lib/fillers";
import { computeSpeechMetrics } from "@/lib/speechMetrics";
import { buildTranscriptionRequest } from "@/lib/transcription";
import { rateAnswer, type ConversationMessage } from "@/lib/rateAnswer";
import {
  buildScoringUserPrompt,
  classifyPace,
  SCORING_SYSTEM_PROMPT,
} from "@/lib/scoring";

export const runtime = "nodejs";
export const maxDuration = 30;

const MIN_WORDS = 15;
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
const MAX_TOPIC_LENGTH = 300;
type WhisperVerboseResponse = {
  text?: string;
  duration?: number;
  segments?: unknown;
  words?: unknown;
};

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

type UploadFile = Awaited<ReturnType<typeof toFile>>;

async function createTranscription(
  client: OpenAI,
  upload: UploadFile,
  withTimestamps: boolean,
): Promise<WhisperVerboseResponse> {
  return (await client.audio.transcriptions.create({
    file: upload,
    ...buildTranscriptionRequest(withTimestamps),
  })) as unknown as WhisperVerboseResponse;
}

/**
 * Word-level timestamps give real pause resolution. If the provider rejects that
 * parameter, retry once with the default segment timestamps instead of failing the
 * whole take; pause figures then come from segment boundaries only.
 */
async function transcribe(client: OpenAI, upload: UploadFile): Promise<WhisperVerboseResponse> {
  try {
    return await createTranscription(client, upload, true);
  } catch (error) {
    const status = statusOf(error);
    if (status === 400 || status === 422) {
      console.warn("[api/rate] timestamp_granularities rejected; retrying with segment timestamps only");
      return await createTranscription(client, upload, false);
    }
    throw error;
  }
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
    const upload = await toFile(new Uint8Array(await audio.arrayBuffer()), `take.${extension}`, {
      type: audio.type || "audio/webm",
    });

    const transcription = await transcribe(client, upload);

    const transcript = (transcription.text ?? "").trim();
    const metrics = computeSpeechMetrics({
      transcript,
      reportedDurationSeconds: transcription.duration ?? null,
      words: transcription.words,
      segments: transcription.segments,
    });
    const fillers = detectFillers(transcript, {
      wordCount: metrics.wordCount,
      // Used only when the word timings line up with the transcript; ignored otherwise.
      wordTimings: transcription.words,
    });
    // Evidence for the feedback wording only; the model awards the delivery score.
    const paceBand = classifyPace(metrics.speakingRateWpm);

    if (metrics.wordCount < MIN_WORDS) {
      // Enough to tell a silent mic apart from a short take; the transcript itself is not logged.
      console.log("[api/rate] not enough speech", {
        bytes: audio.size,
        mime: audio.type,
        words: metrics.wordCount,
        seconds: metrics.durationSeconds,
        timestamps: metrics.timestampGranularity,
      });
      return NextResponse.json(
        {
          error: "TOO_SHORT",
          message: "We couldn't hear enough to score that — try again with a longer take.",
          transcript,
          wordCount: metrics.wordCount,
          duration: metrics.durationSeconds,
          wpm: metrics.wpm,
          fillerWordCount: fillers.total,
          metrics,
        },
        { status: 422 },
      );
    }

    const messages: ConversationMessage[] = [
      { role: "system", content: SCORING_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildScoringUserPrompt({ topic, mode, transcript, metrics, fillers }),
      },
    ];

    // The model judges content and delivery; the server only validates the scores and
    // applies the 60/40 overall formula inside normalizeRating.
    const scoring = await rateAnswer({
      messages,
      paceBand,
      requestCompletion: async (conversation) => {
        const completion = await client.chat.completions.create({
          model: GROQ_CHAT_MODEL,
          messages: conversation as OpenAI.Chat.ChatCompletionMessageParam[],
          temperature: 0.3,
          max_tokens: 1200,
          response_format: { type: "json_object" },
        });
        return completion.choices[0]?.message?.content ?? "";
      },
    });

    if (!scoring.ok) {
      // No default scores: an unusable reply is reported instead of faked.
      console.warn("[api/rate] scoring reply rejected", {
        attempts: scoring.attempts,
        reason: scoring.reason,
      });
      return NextResponse.json(
        {
          error: "SCORING_FAILED",
          message: "The coach's reply came back incomplete, so that take wasn't scored. Try again in a moment.",
        },
        { status: 502 },
      );
    }

    if (scoring.attempts > 1) {
      console.warn("[api/rate] scoring reply needed a corrected retry", {
        attempts: scoring.attempts,
      });
    }

    return NextResponse.json({
      ok: true,
      ...scoring.value,
      wpm: metrics.wpm,
      fillerWordCount: fillers.total,
      fillers,
      transcript,
      wordCount: metrics.wordCount,
      duration: metrics.durationSeconds,
      metrics,
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
