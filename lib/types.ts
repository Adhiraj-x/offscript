import type { FillerBreakdown } from "./fillers";
import type { SpeechMetrics } from "./speechMetrics";
import type { TopicCategory } from "./topics";

export type Mode = "off-the-cuff" | "deep-research";

export type Session = {
  id: string;
  date: string;
  topic: string;
  mode: Mode;
  contentScore: number;
  deliveryScore: number;
  overallScore: number;
  wpm: number;
  fillerWordCount: number;
  feedback: string;
  transcript: string;
  /** Optional so records saved before categories existed still load. */
  category?: TopicCategory;
  /** Optional so records saved before Scoring Engine 2.0 still load. */
  metrics?: SpeechMetrics;
  /** Optional filler breakdown; absent on older sessions. */
  fillers?: FillerBreakdown;
};

/** The shape returned by POST /api/rate on success. */
export type RatingResult = {
  contentScore: number;
  deliveryScore: number;
  overallScore: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
  wpm: number;
  fillerWordCount: number;
  transcript: string;
  /** Timing estimates for this take; absent when Whisper returned no timing. */
  metrics?: SpeechMetrics;
  /** Transcript-detected fillers; absent when the reply carried none. */
  fillers?: FillerBreakdown;
};
