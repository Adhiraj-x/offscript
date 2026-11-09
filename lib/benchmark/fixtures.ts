import type { Mode } from "../types";
import type { SpeechMetrics } from "../speechMetrics";
import type { FillerBreakdown } from "../fillers";

export interface BenchmarkFixture {
  id: number;
  name: string;
  scenario: string;
  topic: string;
  mode: Mode;
  transcript: string;
  wordCount: number;
  durationSeconds: number;
  speakingRateWpm: number | null;
  articulationWpm: number | null;
  noticeablePauseCount: number | null;
  longPauseCount: number | null;
  longestPauseSeconds: number | null;
  pauseFrequencyPerMinute: number | null;
  pausesLowPrecision: boolean;
  timestampGranularity: "word" | "segment" | "none";
  fillers: FillerBreakdown;
  expectedProfile: {
    expectedContentBand: "Excellent" | "Strong" | "Competent" | "Needs improvement" | "Very weak";
    expectedDeliveryBand:
      | "Excellent"
      | "Strong"
      | "Competent"
      | "Needs improvement"
      | "Very weak"
      | "Somewhat fast"
      | "Somewhat slow"
      | "Comfortable"
      | "Slow";
    keyStrengthsExpected: string;
    keyImprovementsExpected: string;
  };
}

function emptyFillers(_wordCount?: number): FillerBreakdown {
  return {
    total: 0,
    definiteCount: 0,
    contextualCount: 0,
    repeatedRunCount: 0,
    per100Words: 0,
    counts: {},
    isEstimate: true,
  };
}

function makeFillers(
  wordCount: number,
  countsOrDefinite: { hesitation?: number; discourse?: number; check?: number } | number,
  contextualOrCounts?: Record<string, number> | number,
  explicitCounts?: Record<string, number>,
): FillerBreakdown {
  let definiteCount = 0;
  let contextualCount = 0;
  let counts: Record<string, number> = {};

  if (typeof countsOrDefinite === "number") {
    definiteCount = countsOrDefinite;
    contextualCount = typeof contextualOrCounts === "number" ? contextualOrCounts : 0;
    counts = explicitCounts ?? {};
  } else {
    definiteCount = countsOrDefinite.hesitation ?? 0;
    contextualCount = (countsOrDefinite.discourse ?? 0) + (countsOrDefinite.check ?? 0);
    counts = (typeof contextualOrCounts === "object" && contextualOrCounts !== null
      ? contextualOrCounts
      : {}) as Record<string, number>;
  }

  const total = definiteCount + contextualCount;
  const per100Words = wordCount > 0 ? Math.round((total / wordCount) * 1000) / 10 : 0;
  return {
    total,
    definiteCount,
    contextualCount,
    repeatedRunCount: total > 2 ? 1 : 0,
    per100Words,
    counts,
    isEstimate: true,
  };
}

export function fixtureToSpeechMetrics(f: BenchmarkFixture): SpeechMetrics {
  const wpm = f.speakingRateWpm ?? (f.durationSeconds > 0 ? Math.round((f.wordCount / (f.durationSeconds / 60)) * 10) / 10 : 0);
  const pausesAvailable = f.timestampGranularity !== "none";
  return {
    wordCount: f.wordCount,
    durationSeconds: f.durationSeconds > 0 ? f.durationSeconds : null,
    durationBasis: f.durationSeconds > 0 ? "reported" : "unavailable",
    activeSpeechSeconds: f.durationSeconds > 0 ? Math.round(f.durationSeconds * 0.85 * 10) / 10 : null,
    speakingRateWpm: f.speakingRateWpm,
    articulationWpm: f.articulationWpm,
    wpm,
    wpmBasis: f.durationSeconds > 0 ? "total-duration" : "unavailable",
    timestampGranularity: f.timestampGranularity === "none" ? null : f.timestampGranularity,
    pausesAvailable,
    pausesLowPrecision: f.pausesLowPrecision,
    noticeablePauseThresholdSeconds: 0.5,
    longPauseThresholdSeconds: 1.5,
    noticeablePauseCount: pausesAvailable ? f.noticeablePauseCount : null,
    noticeablePauseTotalSeconds: pausesAvailable && f.noticeablePauseCount != null ? Math.round(f.noticeablePauseCount * 0.7 * 10) / 10 : null,
    longPauseCount: pausesAvailable ? f.longPauseCount : null,
    longPauseTotalSeconds: pausesAvailable && f.longPauseCount != null ? Math.round(f.longPauseCount * 1.8 * 10) / 10 : null,
    longestPauseSeconds: pausesAvailable ? f.longestPauseSeconds : null,
    pauseFrequencyPerMinute: pausesAvailable ? f.pauseFrequencyPerMinute : null,
    pauseCount: pausesAvailable ? f.longPauseCount : null,
    pauseThresholdSeconds: 1.5,
  };
}

export const BENCHMARK_FIXTURES: readonly BenchmarkFixture[] = [
  // 1. Strong argument with clear structure and specific examples
  {
    id: 1,
    name: "Strong structured argument with specific metrics",
    scenario: "1. Strong argument with clear structure and specific examples",
    topic: "Should software engineering teams prioritize automated testing over manual QA?",
    mode: "deep-research",
    transcript:
      "Automated testing should serve as the foundation of any modern software release pipeline for three concrete reasons. First, automated regression suites run in minutes rather than days. At my previous engineering organization, migrating 80% of our manual smoke checks into continuous integration dropped our deployment cycle time from three full days to forty-five minutes. Second, automated suites guarantee reproducibility. An automated assertion executes identically across staging, canary, and production environments, eliminating human fatigue and missed corner cases. Third, this shift does not eliminate QA engineers; instead, it elevates their role from repetitive script execution to exploratory testing, security audits, and chaos engineering. Therefore, automation must be the default baseline, complemented strategically by human exploratory testing.",
    wordCount: 118,
    durationSeconds: 52,
    speakingRateWpm: 136.2,
    articulationWpm: 148.0,
    noticeablePauseCount: 3,
    longPauseCount: 0,
    longestPauseSeconds: 0.8,
    pauseFrequencyPerMinute: 3.5,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(118),
    expectedProfile: {
      expectedContentBand: "Strong",
      expectedDeliveryBand: "Strong",
      keyStrengthsExpected: "Clear tripartite structure, empirical metric (3 days to 45 mins), balanced conclusion",
      keyImprovementsExpected: "Minor pacing modulation between main claims",
    },
  },

  // 2. Relevant but shallow argument
  {
    id: 2,
    name: "Relevant but shallow argument",
    scenario: "2. Relevant but shallow argument",
    topic: "Why is daily physical exercise important for knowledge workers?",
    mode: "off-the-cuff",
    transcript:
      "Exercise is really good for knowledge workers because sitting at a desk all day makes your back hurt and you get tired. If you go for a walk or go to the gym, you feel much better and you have more energy to work. Also it helps you sleep better at night. When you sleep better, your mind is clearer the next morning. So everyone who works in an office should definitely make sure they exercise every single day.",
    wordCount: 80,
    durationSeconds: 38,
    speakingRateWpm: 126.3,
    articulationWpm: 135.0,
    noticeablePauseCount: 2,
    longPauseCount: 0,
    longestPauseSeconds: 0.7,
    pauseFrequencyPerMinute: 3.2,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: makeFillers(80, { discourse: 1 }, { so: 1 }),
    expectedProfile: {
      expectedContentBand: "Competent",
      expectedDeliveryBand: "Competent",
      keyStrengthsExpected: "Answers the prompt directly and identifies energy/sleep benefits",
      keyImprovementsExpected: "Needs deeper mechanisms or specific examples beyond generic assertions",
    },
  },

  // 3. Vague argument with little supporting evidence
  {
    id: 3,
    name: "Vague argument with little evidence",
    scenario: "3. Vague argument with little supporting evidence",
    topic: "How should cities address traffic congestion?",
    mode: "off-the-cuff",
    transcript:
      "Traffic is a huge issue everywhere and things are getting worse in cities. People are stuck in traffic for hours and it creates lots of bad things for everyone. The government needs to step in and do something about the roads. Maybe build better systems or change the rules so that cars are not driving around all the time. If things were managed better, people would be happier and the whole situation would improve.",
    wordCount: 76,
    durationSeconds: 36,
    speakingRateWpm: 126.7,
    articulationWpm: 132.0,
    noticeablePauseCount: 2,
    longPauseCount: 0,
    longestPauseSeconds: 0.9,
    pauseFrequencyPerMinute: 3.3,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(76),
    expectedProfile: {
      expectedContentBand: "Needs improvement",
      expectedDeliveryBand: "Competent",
      keyStrengthsExpected: "Recognizes the problem of urban congestion",
      keyImprovementsExpected: "Provide concrete interventions such as congestion pricing, dedicated bus lanes, or light rail",
    },
  },

  // 4. Off-topic response
  {
    id: 4,
    name: "Completely off-topic response",
    scenario: "4. Off-topic response",
    topic: "What are the benefits of electric public transit buses?",
    mode: "off-the-cuff",
    transcript:
      "I recently upgraded my kitchen appliances to stainless steel, and honestly it was one of the best investments I've ever made. The dishwasher runs so quietly that you can barely tell it is on. Cooking with induction is also much faster than traditional gas, and wiping down the glass cooktop takes ten seconds. Having a modern kitchen completely changes how you host dinners with friends.",
    wordCount: 71,
    durationSeconds: 34,
    speakingRateWpm: 125.3,
    articulationWpm: 132.0,
    noticeablePauseCount: 1,
    longPauseCount: 0,
    longestPauseSeconds: 0.6,
    pauseFrequencyPerMinute: 1.8,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(71),
    expectedProfile: {
      expectedContentBand: "Very weak",
      expectedDeliveryBand: "Competent",
      keyStrengthsExpected: "Coherent sentence structure and fluent articulation",
      keyImprovementsExpected: "Directly answer the assigned topic regarding electric transit buses",
    },
  },

  // 5. Nuanced argument considering opposing viewpoints
  {
    id: 5,
    name: "Nuanced argument with counter-perspectives",
    scenario: "5. Nuanced argument that considers opposing viewpoints",
    topic: "Should artificial intelligence code generation tools be adopted universally in computer science education?",
    mode: "deep-research",
    transcript:
      "Integrating AI code generation tools into introductory computer science requires balancing pedagogical fundamentals with industry reality. Proponents argue that modern software engineers increasingly operate as system architects who review AI-assisted code, making early tool familiarity essential. Furthermore, AI assistants can act as personalized 24/7 tutors, explaining syntax errors and demystifying recursion for struggling students. However, premature reliance poses a severe pedagogical hazard. If novices utilize code completions before internalizing core mental models of memory management, time complexity, and debugging, they develop an illusion of competence without foundational problem-solving capability. A balanced curriculum should mandate syntax mastery and manual algorithmic derivation during introductory coursework, followed by structured AI pairing in upper-level design courses.",
    wordCount: 114,
    durationSeconds: 50,
    speakingRateWpm: 136.8,
    articulationWpm: 147.0,
    noticeablePauseCount: 3,
    longPauseCount: 0,
    longestPauseSeconds: 0.8,
    pauseFrequencyPerMinute: 3.6,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(114),
    expectedProfile: {
      expectedContentBand: "Excellent",
      expectedDeliveryBand: "Strong",
      keyStrengthsExpected: "Nuanced synthesis weighing pedagogical risks against professional reality",
      keyImprovementsExpected: "Add one concrete course assignment example",
    },
  },

  // 6. Personal example with weak logical reasoning
  {
    id: 6,
    name: "Personal anecdote with hasty generalization",
    scenario: "6. Personal example with weak logical reasoning",
    topic: "Is a university degree still necessary for career success in technology?",
    mode: "off-the-cuff",
    transcript:
      "A university degree is totally useless nowadays. My uncle dropped out of college when he was nineteen and started a landscaping business, and today he owns three houses and makes more money than any of my friends with masters degrees. Because he succeeded without ever finishing a semester of college, it proves that spending four years at school is a complete waste of time for everyone wanting a tech career.",
    wordCount: 75,
    durationSeconds: 35,
    speakingRateWpm: 128.6,
    articulationWpm: 135.0,
    noticeablePauseCount: 2,
    longPauseCount: 0,
    longestPauseSeconds: 0.7,
    pauseFrequencyPerMinute: 3.4,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(75),
    expectedProfile: {
      expectedContentBand: "Needs improvement",
      expectedDeliveryBand: "Competent",
      keyStrengthsExpected: "Clear stance and lively narrative delivery",
      keyImprovementsExpected: "Avoid generalizing from an isolated non-tech anecdote to the broader industry",
    },
  },

  // 7. Repetitive speech
  {
    id: 7,
    name: "Repetitive speech restating the same point",
    scenario: "7. Repetitive speech",
    topic: "Why is sleep consistency important?",
    mode: "off-the-cuff",
    transcript:
      "Sleep consistency is important because having a regular sleep schedule keeps your routine consistent. When your sleep is consistent, you go to sleep at the same time and wake up at the same time. Going to sleep at the same time is very important for sleep consistency. If you keep your schedule consistent, your sleep will be regular, and regularity in your sleeping habits is really the key to consistent rest.",
    wordCount: 76,
    durationSeconds: 36,
    speakingRateWpm: 126.7,
    articulationWpm: 132.0,
    noticeablePauseCount: 1,
    longPauseCount: 0,
    longestPauseSeconds: 0.6,
    pauseFrequencyPerMinute: 1.7,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(76),
    expectedProfile: {
      expectedContentBand: "Needs improvement",
      expectedDeliveryBand: "Competent",
      keyStrengthsExpected: "Directly addresses sleep consistency",
      keyImprovementsExpected: "Eliminate tautological phrasing by introducing circadian biology or cognitive recovery",
    },
  },

  // 8. Fluent speech with weak content
  {
    id: 8,
    name: "Fluent presentation with superficial substance",
    scenario: "8. Fluent speech with weak content",
    topic: "How should organizations improve cross-departmental collaboration?",
    mode: "deep-research",
    transcript:
      "In today's dynamic paradigm of modern operational frameworks, synergetic cross-functional alignment is paramount. When organizational stakeholders interface cohesively across horizontal silos, value creation naturally manifests. We must leverage proactive bandwidth to streamline interconnected deliverables while fostering holistic symbiosis. Optimizing agile transparency empowers distributed enterprise units to converge seamlessly upon overarching quarterly north stars.",
    wordCount: 54,
    durationSeconds: 25,
    speakingRateWpm: 129.6,
    articulationWpm: 140.0,
    noticeablePauseCount: 1,
    longPauseCount: 0,
    longestPauseSeconds: 0.5,
    pauseFrequencyPerMinute: 2.4,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(54),
    expectedProfile: {
      expectedContentBand: "Needs improvement",
      expectedDeliveryBand: "Strong",
      keyStrengthsExpected: "Confident vocal rhythm, smooth cadence, and articulate diction",
      keyImprovementsExpected: "Replace corporate buzzwords with practical actions like joint KPIs or shared sprint reviews",
    },
  },

  // 9. Strong content with poor measured delivery
  {
    id: 9,
    name: "Substantive analysis with severe pauses and disfluency",
    scenario: "9. Strong content with poor measured delivery",
    topic: "How does inflation impact consumer purchasing behavior?",
    mode: "off-the-cuff",
    transcript:
      "Inflation um er basically forces consumers to alter their spending in two distinct ways. First, uh, buyers substitute branded goods for generic private labels, which we saw when grocery store store sales of store brands jumped twelve percent last year. Second, um, households delay big durable purchases like cars and appliances, because financing costs rise alongside interest rates. But um, essential non-discretionary goods like energy and medicine remain relatively inelastic.",
    wordCount: 71,
    durationSeconds: 58,
    speakingRateWpm: 73.4,
    articulationWpm: 105.0,
    noticeablePauseCount: 8,
    longPauseCount: 3,
    longestPauseSeconds: 2.8,
    pauseFrequencyPerMinute: 8.3,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: makeFillers(71, { hesitation: 5 }, { um: 4, er: 1 }),
    expectedProfile: {
      expectedContentBand: "Strong",
      expectedDeliveryBand: "Slow",
      keyStrengthsExpected: "Accurate economic mechanisms (substitution effect, interest rates, inelasticity)",
      keyImprovementsExpected: "Reduce hesitation fillers (um, er) and eliminate long mid-sentence pauses",
    },
  },

  // 10. Slow speech with frequent pauses and fillers
  {
    id: 10,
    name: "Slow speech with heavy hesitation markers",
    scenario: "10. Slow speech with frequent pauses and fillers",
    topic: "What is your perspective on remote work productivity?",
    mode: "off-the-cuff",
    transcript:
      "Well um I think that remote work is uh pretty interesting because um you don't have to commute every morning. But uh sometimes it is um hard to stay focused at home because uh you know there are dishes to do and laundry. So uh I guess it depends on the person.",
    wordCount: 55,
    durationSeconds: 48,
    speakingRateWpm: 68.8,
    articulationWpm: 92.0,
    noticeablePauseCount: 7,
    longPauseCount: 3,
    longestPauseSeconds: 2.4,
    pauseFrequencyPerMinute: 8.8,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: makeFillers(55, { hesitation: 6, discourse: 1, check: 1 }, { um: 3, uh: 3, well: 1, "you know": 1 }),
    expectedProfile: {
      expectedContentBand: "Needs improvement",
      expectedDeliveryBand: "Very weak",
      keyStrengthsExpected: "Identifies commute benefit and domestic distraction challenge",
      keyImprovementsExpected: "Pace is very slow (68 WPM); condense pauses and practice speaking in complete phrases",
    },
  },

  // 11. Fast speech with limited clarity
  {
    id: 11,
    name: "Rushed cadence exceeding comfortable speaking pace",
    scenario: "11. Fast speech with limited clarity",
    topic: "Why do startup companies fail?",
    mode: "off-the-cuff",
    transcript:
      "Startups fail mostly because they run out of cash before finding product market fit and they spend way too much money on customer acquisition and marketing without having high retention or repeat buyers and the founders disagree on product roadmap direction and they hire too many people before proving unit economics.",
    wordCount: 51,
    durationSeconds: 16,
    speakingRateWpm: 191.2,
    articulationWpm: 195.0,
    noticeablePauseCount: 0,
    longPauseCount: 0,
    longestPauseSeconds: 0.2,
    pauseFrequencyPerMinute: 0.0,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(51),
    expectedProfile: {
      expectedContentBand: "Competent",
      expectedDeliveryBand: "Somewhat fast",
      keyStrengthsExpected: "Accurately lists startup failure causes (cash burn, CAC, founder conflict)",
      keyImprovementsExpected: "Pace is very fast (191 WPM); insert deliberate pauses between distinct causes",
    },
  },

  // 12. Comfortable pacing and coherent delivery
  {
    id: 12,
    name: "Well-paced executive summary",
    scenario: "12. Comfortable pacing and coherent delivery",
    topic: "How should leaders communicate during organizational change?",
    mode: "deep-research",
    transcript:
      "Effective change leadership rests on continuous transparency and clear rationale. When leadership communicates early about why a transition is happening, employees feel respected rather than blindsided. It is equally vital to create two-way feedback channels so team concerns can be addressed before rumors take hold.",
    wordCount: 47,
    durationSeconds: 21,
    speakingRateWpm: 134.3,
    articulationWpm: 142.0,
    noticeablePauseCount: 2,
    longPauseCount: 0,
    longestPauseSeconds: 0.6,
    pauseFrequencyPerMinute: 5.7,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(47),
    expectedProfile: {
      expectedContentBand: "Strong",
      expectedDeliveryBand: "Strong",
      keyStrengthsExpected: "Comfortable cadence (134 WPM), crisp articulation, clear two-way communication insight",
      keyImprovementsExpected: "Add one concrete channel example such as an open Q&A forum",
    },
  },

  // 13. Speech with little measurable timing data
  {
    id: 13,
    name: "Timing data missing / fallback duration",
    scenario: "13. Speech with little measurable timing data",
    topic: "What makes mentorship valuable in professional development?",
    mode: "off-the-cuff",
    transcript:
      "Mentorship accelerates career growth by helping junior colleagues avoid predictable pitfalls that mentors have already navigated. A great mentor provides honest constructive critique, opens doors to informal professional networks, and offers perspective when unexpected setbacks happen in the workplace.",
    wordCount: 40,
    durationSeconds: 18,
    speakingRateWpm: null,
    articulationWpm: null,
    noticeablePauseCount: null,
    longPauseCount: null,
    longestPauseSeconds: null,
    pauseFrequencyPerMinute: null,
    pausesLowPrecision: false,
    timestampGranularity: "none",
    fillers: emptyFillers(40),
    expectedProfile: {
      expectedContentBand: "Strong",
      expectedDeliveryBand: "Competent",
      keyStrengthsExpected: "Clear analysis of mentorship value without relying on missing timestamp data",
      keyImprovementsExpected: "Provide a specific example of advice or network support",
    },
  },

  // 14. Speech with transcription uncertainty / low precision
  {
    id: 14,
    name: "Segment-only timestamps with transcription quirks",
    scenario: "14. Speech with transcription uncertainty",
    topic: "How can businesses reduce their carbon footprint?",
    mode: "off-the-cuff",
    transcript:
      "Companies can cut emissions by auditing their primary supply chain partners and shifting data center operations to renewable electricity regions. Transitioning corporate travel to virtual video conferencing where feasible also reduces unnecessary flight emissions significantly.",
    wordCount: 36,
    durationSeconds: 17,
    speakingRateWpm: 127.1,
    articulationWpm: 135.0,
    noticeablePauseCount: 1,
    longPauseCount: 0,
    longestPauseSeconds: 1.0,
    pauseFrequencyPerMinute: 3.5,
    pausesLowPrecision: true,
    timestampGranularity: "segment",
    fillers: emptyFillers(36),
    expectedProfile: {
      expectedContentBand: "Strong",
      expectedDeliveryBand: "Competent",
      keyStrengthsExpected: "Actionable recommendations (supply chain audits, data center green energy)",
      keyImprovementsExpected: "Acknowledge lower-bound timing precision gracefully",
    },
  },

  // 15. Short but sufficiently developed answer
  {
    id: 15,
    name: "Concise yet fully formed response",
    scenario: "15. Short but sufficiently developed answer",
    topic: "What is the primary purpose of a project retrospective?",
    mode: "off-the-cuff",
    transcript:
      "The primary purpose of a project retrospective is psychological safety and continuous team iteration. Rather than assigning blame for mistakes, retrospectives pinpoint system breakdowns, celebrate shared wins, and commit to two or three actionable procedural changes for the subsequent sprint.",
    wordCount: 41,
    durationSeconds: 19,
    speakingRateWpm: 129.5,
    articulationWpm: 138.0,
    noticeablePauseCount: 1,
    longPauseCount: 0,
    longestPauseSeconds: 0.7,
    pauseFrequencyPerMinute: 3.2,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(41),
    expectedProfile: {
      expectedContentBand: "Strong",
      expectedDeliveryBand: "Strong",
      keyStrengthsExpected: "Succinct, high-signal definition focusing on system iteration and psychological safety",
      keyImprovementsExpected: "Include an example of a retrospective action item",
    },
  },

  // 16. Response with a clear central claim but no examples
  {
    id: 16,
    name: "Strong thesis lacking concrete examples",
    scenario: "16. Response with a clear central claim but no examples",
    topic: "Does micro-management decrease workplace productivity?",
    mode: "off-the-cuff",
    transcript:
      "Micromanagement absolutely destroys workplace productivity. When managers monitor every trivial detail, employees lose all autonomy and stop thinking critically for themselves. Decision-making grinds to a halt because team members require managerial approval for basic tasks, which creates severe operational bottlenecks and burns out top performers.",
    wordCount: 47,
    durationSeconds: 22,
    speakingRateWpm: 128.2,
    articulationWpm: 136.0,
    noticeablePauseCount: 1,
    longPauseCount: 0,
    longestPauseSeconds: 0.6,
    pauseFrequencyPerMinute: 2.7,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(47),
    expectedProfile: {
      expectedContentBand: "Competent",
      expectedDeliveryBand: "Strong",
      keyStrengthsExpected: "Clear central claim with sound causal logic",
      keyImprovementsExpected: "Ground the argument in a concrete operational scenario or project example",
    },
  },

  // 17. Response with several examples but weak structure
  {
    id: 17,
    name: "Example-heavy response lacking overarching thesis",
    scenario: "17. Response with several examples but weak structure",
    topic: "How has mobile technology transformed consumer banking?",
    mode: "deep-research",
    transcript:
      "Well, you can deposit checks with your phone camera by snapping a picture, and you can send money instantly to your friend using Venmo or Zelle. Also, my bank notifies me on my lock screen whenever my debit card is charged. And people in Kenya use M-Pesa to buy groceries at outdoor markets without traditional bank branches.",
    wordCount: 59,
    durationSeconds: 28,
    speakingRateWpm: 126.4,
    articulationWpm: 134.0,
    noticeablePauseCount: 2,
    longPauseCount: 0,
    longestPauseSeconds: 0.8,
    pauseFrequencyPerMinute: 4.3,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: makeFillers(59, { discourse: 1 }, { well: 1 }),
    expectedProfile: {
      expectedContentBand: "Competent",
      expectedDeliveryBand: "Competent",
      keyStrengthsExpected: "Vivid, diverse real-world examples (check deposits, instant P2P, M-Pesa)",
      keyImprovementsExpected: "Synthesize these isolated examples into an overarching conceptual framework",
    },
  },

  // 18. Response that drifts away from the topic
  {
    id: 18,
    name: "Response drifting into tangential topics",
    scenario: "18. Response that drifts away from the topic",
    topic: "Should companies mandate three days a week in the physical office?",
    mode: "off-the-cuff",
    transcript:
      "Mandating three days in the office is meant to rebuild company culture, but real estate prices downtown have gotten totally ridiculous. When you look at commercial leases in major metropolitan areas, developers are struggling with high interest rates and vacant square footage. In fact, urban residential zoning is probably the biggest challenge facing local municipal governments right now.",
    wordCount: 58,
    durationSeconds: 27,
    speakingRateWpm: 128.9,
    articulationWpm: 136.0,
    noticeablePauseCount: 1,
    longPauseCount: 0,
    longestPauseSeconds: 0.6,
    pauseFrequencyPerMinute: 2.2,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(58),
    expectedProfile: {
      expectedContentBand: "Needs improvement",
      expectedDeliveryBand: "Competent",
      keyStrengthsExpected: "Knowledgeable commentary on urban commercial real estate",
      keyImprovementsExpected: "Maintain focus on employee collaboration and productivity rather than municipal zoning",
    },
  },

  // 19. Response with good reasoning but an unclear conclusion
  {
    id: 19,
    name: "Solid premise trailing off without resolution",
    scenario: "19. Response with good reasoning but an unclear conclusion",
    topic: "Are open-plan offices beneficial for software development teams?",
    mode: "off-the-cuff",
    transcript:
      "Open-plan offices foster spontaneous conversations and enable team members to unblock each other quickly without booking formal meetings. On the flip side, coding requires sustained deep focus, and noise interruptions break train of thought. So there are pros and cons to both setups, and it really just depends.",
    wordCount: 49,
    durationSeconds: 23,
    speakingRateWpm: 127.8,
    articulationWpm: 135.0,
    noticeablePauseCount: 1,
    longPauseCount: 0,
    longestPauseSeconds: 0.7,
    pauseFrequencyPerMinute: 2.6,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(49),
    expectedProfile: {
      expectedContentBand: "Competent",
      expectedDeliveryBand: "Competent",
      keyStrengthsExpected: "Clearly captures the tradeoff between spontaneous pairing and deep focus",
      keyImprovementsExpected: "Provide a definitive synthesized recommendation (e.g. library zones, quiet hours)",
    },
  },

  // 20. Response with a strong conclusion but insufficient explanation
  {
    id: 20,
    name: "Strong assertion lacking underlying mechanisms",
    scenario: "20. Response with a strong conclusion but insufficient explanation",
    topic: "Should high school students learn personal financial literacy?",
    mode: "off-the-cuff",
    transcript:
      "Every single high school graduate must be required to pass a financial literacy course. Without it, young adults make disastrous mistakes and society suffers enormous economic damage. Mandating this curriculum immediately across all fifty states is without question the most crucial educational policy reform of the century.",
    wordCount: 48,
    durationSeconds: 22,
    speakingRateWpm: 130.9,
    articulationWpm: 139.0,
    noticeablePauseCount: 1,
    longPauseCount: 0,
    longestPauseSeconds: 0.5,
    pauseFrequencyPerMinute: 2.7,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(48),
    expectedProfile: {
      expectedContentBand: "Competent",
      expectedDeliveryBand: "Strong",
      keyStrengthsExpected: "Convincing vocal conviction and decisive conclusion",
      keyImprovementsExpected: "Explain specific financial skills needed (budgeting, compound interest, credit scores)",
    },
  },

  // 21. Technical explanation with high clarity and balanced cadence
  {
    id: 21,
    name: "Technical explanation of database indexing",
    scenario: "21. Technical explanation with high clarity and balanced cadence",
    topic: "Explain how a B-tree index improves database search performance.",
    mode: "deep-research",
    transcript:
      "A B-tree index accelerates database queries by organizing sorted data into a balanced multi-level tree rather than requiring a sequential table scan. In an unindexed table containing one million rows, finding a customer by email requires examining every single row in order O of N. By contrast, a B-tree maintains logarithmic search time O of log N. By navigating from the root node through branch pages to the leaf node, the database locates the matching record in three or four disk page reads.",
    wordCount: 84,
    durationSeconds: 38,
    speakingRateWpm: 132.6,
    articulationWpm: 142.0,
    noticeablePauseCount: 2,
    longPauseCount: 0,
    longestPauseSeconds: 0.7,
    pauseFrequencyPerMinute: 3.2,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(84),
    expectedProfile: {
      expectedContentBand: "Excellent",
      expectedDeliveryBand: "Strong",
      keyStrengthsExpected: "Masterful technical comparison between sequential O(N) and B-tree O(log N) lookup",
      keyImprovementsExpected: "Briefly mention write overhead or index maintenance tradeoffs",
    },
  },

  // 22. Overly informal colloquial take with conversational digressions
  {
    id: 22,
    name: "Informal conversational take with slang",
    scenario: "22. Overly informal colloquial take with conversational digressions",
    topic: "What is your assessment of modern subscription business models?",
    mode: "off-the-cuff",
    transcript:
      "Honestly subscriptions are getting pretty wild these days. Like, you buy a car and then they want ten bucks a month to heat your seats, which is totally bonkers. Then you forget to cancel your gym app and you're out sixty dollars. Companies love the recurring revenue, but consumers are totally getting subscription fatigue.",
    wordCount: 54,
    durationSeconds: 24,
    speakingRateWpm: 135.0,
    articulationWpm: 144.0,
    noticeablePauseCount: 1,
    longPauseCount: 0,
    longestPauseSeconds: 0.6,
    pauseFrequencyPerMinute: 2.5,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: makeFillers(54, { discourse: 1 }, { like: 1 }),
    expectedProfile: {
      expectedContentBand: "Competent",
      expectedDeliveryBand: "Competent",
      keyStrengthsExpected: "Relatable consumer examples highlighting subscription fatigue",
      keyImprovementsExpected: "Adopt more professional editorial vocabulary and examine unit economics",
    },
  },

  // 23. Persuasive policy pitch with structured tripartite framework
  {
    id: 23,
    name: "Structured policy pitch on urban tree canopies",
    scenario: "23. Persuasive policy pitch with structured tripartite framework",
    topic: "Why should municipalities invest in expanding urban tree canopies?",
    mode: "deep-research",
    transcript:
      "Municipal investment in urban tree canopies delivers three vital public dividends. First, trees mitigate the urban heat island effect, reducing ambient summer asphalt temperatures by up to eight degrees Celsius. Second, mature root structures capture stormwater runoff, preventing sewer overflow during intense rainfall. Third, research demonstrates that tree-lined streets measurably reduce cardiovascular stress and foster neighborhood community walking.",
    wordCount: 59,
    durationSeconds: 27,
    speakingRateWpm: 131.1,
    articulationWpm: 140.0,
    noticeablePauseCount: 2,
    longPauseCount: 0,
    longestPauseSeconds: 0.6,
    pauseFrequencyPerMinute: 4.4,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(59),
    expectedProfile: {
      expectedContentBand: "Strong",
      expectedDeliveryBand: "Strong",
      keyStrengthsExpected: "Clean three-part breakdown (heat island, stormwater runoff, public health)",
      keyImprovementsExpected: "Offer a closing funding or implementation recommendation",
    },
  },

  // 24. Hesitant opening that warms up into articulate synthesis
  {
    id: 24,
    name: "Hesitant start warming into clear articulation",
    scenario: "24. Hesitant opening that warms up into articulate synthesis",
    topic: "How should product teams decide which features to sunset?",
    mode: "off-the-cuff",
    transcript:
      "Um, so, at first it feels difficult to kill features... but product teams must audit active usage versus maintenance cost. When an obscure legacy setting accounts for one percent of users but generates forty percent of QA edge-case bugs, sunsetting that capability frees engineering bandwidth to polish core flows that benefit the entire customer base.",
    wordCount: 56,
    durationSeconds: 29,
    speakingRateWpm: 115.9,
    articulationWpm: 132.0,
    noticeablePauseCount: 2,
    longPauseCount: 1,
    longestPauseSeconds: 1.6,
    pauseFrequencyPerMinute: 4.1,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: makeFillers(56, { hesitation: 1, discourse: 1 }, { um: 1, so: 1 }),
    expectedProfile: {
      expectedContentBand: "Strong",
      expectedDeliveryBand: "Comfortable",
      keyStrengthsExpected: "Insightful metric tradeoff (1% users causing 40% edge-case bugs)",
      keyImprovementsExpected: "Begin decisively without introductory hesitation fillers",
    },
  },

  // 25. Dense jargon-laden take lacking accessible explanation
  {
    id: 25,
    name: "Dense technical terminology without accessibility",
    scenario: "25. Dense jargon-laden take lacking accessible explanation",
    topic: "What is microservices architecture?",
    mode: "off-the-cuff",
    transcript:
      "Microservices decouple monolithic codebases into discrete bounded contexts communicating via gRPC or asynchronous Kafka event streams. Each domain-driven service manages polyglot persistence and implements resilience patterns like circuit breakers and distributed tracing via OpenTelemetry to handle network latency across Kubernetes clusters.",
    wordCount: 42,
    durationSeconds: 20,
    speakingRateWpm: 126.0,
    articulationWpm: 135.0,
    noticeablePauseCount: 1,
    longPauseCount: 0,
    longestPauseSeconds: 0.5,
    pauseFrequencyPerMinute: 3.0,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(42),
    expectedProfile: {
      expectedContentBand: "Competent",
      expectedDeliveryBand: "Strong",
      keyStrengthsExpected: "Accurate architecture terminology (bounded contexts, Kafka, circuit breakers)",
      keyImprovementsExpected: "Unpack technical terms with an intuitive analogy for a broader audience",
    },
  },

  // 26. High filler density undermining solid points
  {
    id: 26,
    name: "High filler density undermining solid points",
    scenario: "26. High filler density ('um', 'like', 'you know') undermining otherwise solid points",
    topic: "What are the key elements of a successful job interview?",
    mode: "off-the-cuff",
    transcript:
      "Like um the most important thing in an interview is you know preparation. You should like research the company's recent product launches and um prepare two or three STAR method stories. And you know when you ask thoughtful questions at the end, it like proves you are truly invested.",
    wordCount: 50,
    durationSeconds: 26,
    speakingRateWpm: 115.4,
    articulationWpm: 136.0,
    noticeablePauseCount: 3,
    longPauseCount: 0,
    longestPauseSeconds: 0.8,
    pauseFrequencyPerMinute: 6.9,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: makeFillers(50, { hesitation: 2, discourse: 3, check: 2 }, { like: 3, um: 2, "you know": 2 }),
    expectedProfile: {
      expectedContentBand: "Strong",
      expectedDeliveryBand: "Somewhat slow",
      keyStrengthsExpected: "Practical advice regarding company research and STAR stories",
      keyImprovementsExpected: "Significantly reduce crutch words ('like', 'um', 'you know')",
    },
  },

  // 27. Monotone delivery with very few pauses but stiff formulation
  {
    id: 27,
    name: "Stiff monotone presentation without vocal inflection",
    scenario: "27. Monotone delivery with very few pauses but stiff formulation",
    topic: "Explain the importance of cybersecurity hygiene for employees.",
    mode: "deep-research",
    transcript:
      "Cybersecurity hygiene protects institutional networks from unauthorized penetration. Employees must utilize unique cryptographic passwords, enable multi-factor authentication across all enterprise portals, and refrain from opening unsolicited email attachments originating from unverified external domains.",
    wordCount: 33,
    durationSeconds: 15,
    speakingRateWpm: 132.0,
    articulationWpm: 138.0,
    noticeablePauseCount: 0,
    longPauseCount: 0,
    longestPauseSeconds: 0.3,
    pauseFrequencyPerMinute: 0.0,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(33),
    expectedProfile: {
      expectedContentBand: "Strong",
      expectedDeliveryBand: "Strong",
      keyStrengthsExpected: "Concise, accurate safety protocol checklist",
      keyImprovementsExpected: "Vary rhythm and inflection to prevent sounding robotic",
    },
  },

  // 28. Balanced leadership reflection contrasting tradeoffs
  {
    id: 28,
    name: "Balanced leadership reflection on short vs long term",
    scenario: "28. Balanced leadership reflection contrasting short-term vs long-term tradeoffs",
    topic: "How should leaders balance technical debt with new feature delivery?",
    mode: "deep-research",
    transcript:
      "Balancing technical debt against new feature velocity requires treating architectural refactoring as a financial interest payment. If engineering exclusively ships customer-facing features, compounding debt eventually slows delivery to a crawl. Conversely, halting all feature work for months to rewrite code disengages customers. The healthiest teams allocate a fixed twenty percent capacity every sprint to technical remediation.",
    wordCount: 59,
    durationSeconds: 27,
    speakingRateWpm: 131.1,
    articulationWpm: 141.0,
    noticeablePauseCount: 2,
    longPauseCount: 0,
    longestPauseSeconds: 0.6,
    pauseFrequencyPerMinute: 4.4,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(59),
    expectedProfile: {
      expectedContentBand: "Excellent",
      expectedDeliveryBand: "Strong",
      keyStrengthsExpected: "Compelling financial interest metaphor and pragmatic 20% sprint rule",
      keyImprovementsExpected: "Illustrate with a brief example of debt (e.g. database migration)",
    },
  },

  // 29. Circular reasoning answering by restating question
  {
    id: 29,
    name: "Circular reasoning restating the prompt",
    scenario: "29. Circular reasoning answering the question by restating the question",
    topic: "Why is emotional intelligence crucial for modern team managers?",
    mode: "off-the-cuff",
    transcript:
      "Emotional intelligence is crucial for managers because managers need to be emotionally intelligent with their teams. If a manager has high emotional intelligence, they will demonstrate emotional skills that make them emotionally capable leaders. When managers understand emotions intelligently, their emotional competence helps them manage emotion.",
    wordCount: 43,
    durationSeconds: 21,
    speakingRateWpm: 122.9,
    articulationWpm: 130.0,
    noticeablePauseCount: 1,
    longPauseCount: 0,
    longestPauseSeconds: 0.6,
    pauseFrequencyPerMinute: 2.9,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(43),
    expectedProfile: {
      expectedContentBand: "Very weak",
      expectedDeliveryBand: "Competent",
      keyStrengthsExpected: "Maintains grammatical coherence and smooth pacing",
      keyImprovementsExpected: "Break circular definition by introducing empathy, active listening, or conflict resolution",
    },
  },

  // 30. Concise, punchy executive briefing
  {
    id: 30,
    name: "Crisp executive briefing on cloud cost governance",
    scenario: "30. Concise, punchy executive briefing with crisp articulation and strong conclusion",
    topic: "How should enterprise leaders control expanding cloud infrastructure costs?",
    mode: "off-the-cuff",
    transcript:
      "Controlling cloud expenditure requires architectural visibility and automated governance. First, implement resource tagging across every cloud asset so costs map directly to business units. Second, enforce automated shutdown policies for non-production development environments outside business hours. Third, review cloud reservation discounts quarterly to lock in baseline compute savings. Visibility drives ownership, and automation prevents waste.",
    wordCount: 57,
    durationSeconds: 26,
    speakingRateWpm: 131.5,
    articulationWpm: 142.0,
    noticeablePauseCount: 2,
    longPauseCount: 0,
    longestPauseSeconds: 0.6,
    pauseFrequencyPerMinute: 4.6,
    pausesLowPrecision: false,
    timestampGranularity: "word",
    fillers: emptyFillers(57),
    expectedProfile: {
      expectedContentBand: "Excellent",
      expectedDeliveryBand: "Strong",
      keyStrengthsExpected: "Actionable three-pillar governance framework capped by a memorable summary aphorism",
      keyImprovementsExpected: "Mention anomalous spend alerting to round out the protocol",
    },
  },
] as const;
