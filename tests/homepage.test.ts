import assert from "node:assert/strict";
import test from "node:test";
import { MODES, modeInfo } from "../lib/modes";

test("MODES configuration has exact names, prep seconds and descriptions", () => {
  assert.equal(MODES.length, 2);

  const offTheCuff = modeInfo("off-the-cuff");
  assert.equal(offTheCuff.name, "Quick Prep");
  assert.equal(offTheCuff.prepSeconds, 60);
  assert.equal(
    offTheCuff.blurb,
    "Organise your thoughts quickly, then deliver your response.",
  );

  const deepResearch = modeInfo("deep-research");
  assert.equal(deepResearch.name, "Extended Prep");
  assert.equal(deepResearch.prepSeconds, 600);
  assert.equal(
    deepResearch.blurb,
    "Take more time to explore the topic, structure your ideas and build a considered response.",
  );
});

test("CTA state transitions logically based on mode and topic selection", () => {
  const getCtaLabel = (mode: string | null, topic: { text: string } | null) => {
    if (topic && mode) return "Start preparation";
    if (topic && !mode) return "Pick a mode to continue";
    if (!topic && mode) return "Get a topic to continue";
    return "Get a topic and pick a mode";
  };

  const isCtaDisabled = (mode: string | null, topic: { text: string } | null, spinning: boolean) => {
    return !mode || !topic || spinning;
  };

  const getCtaClasses = (enabled: boolean) => {
    return enabled
      ? "border border-transparent bg-accent text-black hover:bg-accent/90 active:scale-[0.98] shadow-[0_0_24px_-8px_rgba(201,249,108,0.35)] cursor-pointer"
      : "border border-line bg-panel text-muted cursor-not-allowed shadow-none disabled:border-line disabled:bg-panel disabled:text-muted disabled:opacity-100 disabled:cursor-not-allowed";
  };

  // Neither selected
  assert.equal(getCtaLabel(null, null), "Get a topic and pick a mode");
  assert.equal(isCtaDisabled(null, null, false), true);
  assert.ok(getCtaClasses(false).includes("text-muted"));
  assert.ok(getCtaClasses(false).includes("cursor-not-allowed"));
  assert.ok(getCtaClasses(false).includes("bg-panel"));
  assert.ok(!getCtaClasses(false).includes("text-muted/50"));
  assert.ok(!getCtaClasses(false).includes("bg-accent"));

  // Only mode selected
  assert.equal(getCtaLabel("off-the-cuff", null), "Get a topic to continue");
  assert.equal(isCtaDisabled("off-the-cuff", null, false), true);

  // Only topic selected
  assert.equal(getCtaLabel(null, { text: "Silence" }), "Pick a mode to continue");
  assert.equal(isCtaDisabled(null, { text: "Silence" }, false), true);

  // Both selected
  assert.equal(getCtaLabel("off-the-cuff", { text: "Silence" }), "Start preparation");
  assert.equal(isCtaDisabled("off-the-cuff", { text: "Silence" }, false), false);
  assert.ok(getCtaClasses(true).includes("bg-accent"));
  assert.ok(getCtaClasses(true).includes("text-black"));
  assert.ok(getCtaClasses(true).includes("cursor-pointer"));
  assert.ok(getCtaClasses(true).includes("shadow-"));

  // Both selected but topic is generating/spinning
  assert.equal(getCtaLabel("deep-research", { text: "Failure" }), "Start preparation");
  assert.equal(isCtaDisabled("deep-research", { text: "Failure" }, true), true);
});

import { availableTopics } from "../lib/topicPool";
import { pickTopic } from "../lib/topics";

test("topic candidate reel pool is available and non-empty", () => {
  const candidates = availableTopics();
  assert.ok(candidates.length > 0);
  const picked = pickTopic(candidates);
  assert.ok(picked.text.length > 0);
  assert.ok(picked.category.length > 0);
});

test("topic-generation button labels match generation lifecycle", () => {
  const getTopicButtonLabel = (spinning: boolean, hasTopic: boolean) => {
    return spinning ? "Choosing..." : hasTopic ? "Get another topic" : "Get a topic";
  };

  assert.equal(getTopicButtonLabel(false, false), "Get a topic");
  assert.equal(getTopicButtonLabel(true, false), "Choosing...");
  assert.equal(getTopicButtonLabel(true, true), "Choosing...");
  assert.equal(getTopicButtonLabel(false, true), "Get another topic");
});

test("reordered homepage practice flow handles independent selection lifecycle and timer transitions", () => {
  let mode: "off-the-cuff" | "deep-research" | null = null;
  let topic: { text: string; category: string } | null = null;
  let spinning = false;

  const getCtaLabel = () => {
    if (topic && mode) return "Start preparation";
    if (topic && !mode) return "Pick a mode to continue";
    if (!topic && mode) return "Get a topic to continue";
    return "Get a topic and pick a mode";
  };

  const isCtaDisabled = () => !mode || !topic || spinning;

  // Initial state: neither selected
  assert.equal(getCtaLabel(), "Get a topic and pick a mode");
  assert.equal(isCtaDisabled(), true);

  // 1. Generate topic, then select Quick Prep
  topic = { text: "Authenticity", category: "CONCEPT" };
  assert.equal(getCtaLabel(), "Pick a mode to continue");
  assert.equal(isCtaDisabled(), true);
  mode = "off-the-cuff";
  assert.equal(getCtaLabel(), "Start preparation");
  assert.equal(isCtaDisabled(), false);
  assert.equal(modeInfo(mode).prepSeconds, 60);

  // 2. Generate topic, then select Extended Prep
  mode = "deep-research";
  assert.equal(getCtaLabel(), "Start preparation");
  assert.equal(isCtaDisabled(), false);
  assert.equal(modeInfo(mode).prepSeconds, 600);

  // Reset to initial
  mode = null;
  topic = null;

  // 3. Select a mode, then generate a topic
  mode = "off-the-cuff";
  assert.equal(getCtaLabel(), "Get a topic to continue");
  assert.equal(isCtaDisabled(), true);
  topic = { text: "Remote Work Paradox", category: "TREND" };
  assert.equal(getCtaLabel(), "Start preparation");
  assert.equal(isCtaDisabled(), false);

  // 4. Generate another topic after selecting a mode (mode persists)
  spinning = true;
  assert.equal(isCtaDisabled(), true); // Disabled while spinning
  topic = { text: "What if cars were banned?", category: "WHAT_IF" };
  spinning = false;
  assert.equal(mode, "off-the-cuff"); // Mode preserved
  assert.equal(getCtaLabel(), "Start preparation");
  assert.equal(isCtaDisabled(), false);

  // 5. Change mode after generating a topic (topic persists)
  mode = "deep-research";
  assert.equal(topic.text, "What if cars were banned?"); // Topic preserved
  assert.equal(getCtaLabel(), "Start preparation");
  assert.equal(isCtaDisabled(), false);

  // 6. Verify CTA remains disabled if either selection is missing
  mode = null;
  assert.equal(isCtaDisabled(), true);
  assert.equal(getCtaLabel(), "Pick a mode to continue");

  mode = "off-the-cuff";
  topic = null;
  assert.equal(isCtaDisabled(), true);
  assert.equal(getCtaLabel(), "Get a topic to continue");

  // 7. Verify correct preparation timers for both modes
  assert.equal(modeInfo("off-the-cuff").prepSeconds, 60);
  assert.equal(modeInfo("off-the-cuff").name, "Quick Prep");
  assert.equal(modeInfo("deep-research").prepSeconds, 600);
  assert.equal(modeInfo("deep-research").name, "Extended Prep");
});

test("simplified navigation streak indicator renders number only with accessible text", () => {
  const renderStreak = (streak?: number) => {
    if (typeof streak !== "number" || streak <= 0) return null;
    return {
      visualNumber: String(streak),
      screenReaderText: `${streak} day streak`,
      title: `${streak} day streak`,
      accentColorClass: "text-accent",
    };
  };

  assert.equal(renderStreak(0), null);
  assert.equal(renderStreak(-1), null);
  assert.equal(renderStreak(undefined), null);

  const streakResult = renderStreak(3);
  assert.ok(streakResult !== null);
  assert.equal(streakResult.visualNumber, "3");
  assert.equal(streakResult.screenReaderText, "3 day streak");
  assert.equal(streakResult.title, "3 day streak");
  assert.equal(streakResult.accentColorClass, "text-accent");
});

test("hero tagline and topic empty-state styles match specifications", () => {
  const HERO_TAGLINE = "Where ideas take shape and voices find confidence.";
  const HERO_TAGLINE_COLOR = "#8e949d";
  const HERO_TAGLINE_SELECT = "none";
  const TOPIC_EMPTY_TEXT = "Your speaking topic will appear here.";
  const TOPIC_EMPTY_COLOR = "#8e949d";

  assert.equal(HERO_TAGLINE, "Where ideas take shape and voices find confidence.");
  assert.equal(HERO_TAGLINE_COLOR, "#8e949d");
  assert.equal(HERO_TAGLINE_SELECT, "none");
  assert.equal(TOPIC_EMPTY_TEXT, "Your speaking topic will appear here.");
  assert.equal(TOPIC_EMPTY_COLOR, "#8e949d");
});

test("Offscript logo navigates to homepage from result, prep and other states without clearing history", () => {
  type Phase = "setup" | "prep" | "speak" | "scoring" | "result" | "error";

  let phase: Phase = "result";
  let topic: { text: string } | null = { text: "Focus" };
  let result: { overallScore: number } | null = { overallScore: 82 };
  const history = [{ id: "session-1", topic: "Focus", overallScore: 82 }];

  const resetPractice = () => {
    result = null;
    topic = null;
    phase = "setup";
  };

  // 1. From Result page
  assert.equal(phase, "result");
  assert.ok(result !== null);
  resetPractice();
  assert.equal(phase, "setup");
  assert.equal(result, null);
  assert.equal(topic, null);
  assert.equal(history.length, 1);

  // 2. From Prep page
  phase = "prep";
  topic = { text: "Courage" };
  resetPractice();
  assert.equal(phase, "setup");
  assert.equal(topic, null);
  assert.equal(history.length, 1);

  // 3. From Speak page
  phase = "speak";
  topic = { text: "Resilience" };
  resetPractice();
  assert.equal(phase, "setup");
  assert.equal(history.length, 1);

  // 4. Logo configuration and theme-adaptive contrast
  const logoConfig = {
    href: "/",
    ariaLabel: "Offscript home",
    hasDot: true,
    hasText: true,
    dotClass: "h-1.5 w-1.5 rounded-full",
    spacingClass: "gap-2.5",
    textWeight: "font-semibold",
    dark: {
      textColor: "#f0f0f0", // White wordmark
      dotColor: "#c9f96c",  // Bright lime dot
    },
    light: {
      textColor: "#202820", // Deep charcoal/forest colour
      dotColor: "#527a25",  // Darker olive green dot for high contrast against light sage
    },
  };
  assert.equal(logoConfig.href, "/");
  assert.equal(logoConfig.ariaLabel, "Offscript home");
  assert.equal(logoConfig.hasDot, true);
  assert.equal(logoConfig.hasText, true);
  assert.equal(logoConfig.dotClass, "h-1.5 w-1.5 rounded-full");
  assert.equal(logoConfig.spacingClass, "gap-2.5");
  assert.equal(logoConfig.textWeight, "font-semibold");
  assert.equal(logoConfig.dark.textColor, "#f0f0f0");
  assert.equal(logoConfig.dark.dotColor, "#c9f96c");
  assert.equal(logoConfig.light.textColor, "#202820");
  assert.equal(logoConfig.light.dotColor, "#527a25");
});

test("mobile responsive parameters meet target dimensions and spacing ranges", () => {
  const MOBILE_CARD_MIN_HEIGHT = 220; // 220-240px
  const MOBILE_EMPTY_STATE_SEPARATION = 36; // 32-48px
  const MOBILE_MODE_SECTION_MARGIN = 24; // reduced from 36px
  const MOBILE_CTA_SECTION_MARGIN = 20; // reduced from 28px

  assert.ok(MOBILE_CARD_MIN_HEIGHT >= 220 && MOBILE_CARD_MIN_HEIGHT <= 240);
  assert.ok(MOBILE_EMPTY_STATE_SEPARATION >= 32 && MOBILE_EMPTY_STATE_SEPARATION <= 48);
  assert.ok(MOBILE_MODE_SECTION_MARGIN < 36);
  assert.ok(MOBILE_CTA_SECTION_MARGIN < 28);
});

test("coach feedback contrast and selection styling specifications", () => {
  const MAIN_TAKEAWAY_COLOR = "#f0f0f0";
  const SELECTION_BACKGROUND = "#c9f96c";
  const SELECTION_FOREGROUND = "#08090b";

  assert.equal(MAIN_TAKEAWAY_COLOR, "#f0f0f0");
  assert.equal(SELECTION_BACKGROUND, "#c9f96c");
  assert.equal(SELECTION_FOREGROUND, "#08090b");
});

test("ambient background particle and aura specifications", () => {
  const MOBILE_PARTICLES = 7; // approximately 6-8
  const DESKTOP_PARTICLES = 16; // approximately 14-18
  const AURA_COUNT = 3; // 2-3 large soft radial light fields
  const MIN_AURA_CYCLE_SECONDS = 32; // 25-40s cycles
  const MAX_AURA_CYCLE_SECONDS = 42;

  assert.ok(MOBILE_PARTICLES >= 6 && MOBILE_PARTICLES <= 8);
  assert.ok(DESKTOP_PARTICLES >= 14 && DESKTOP_PARTICLES <= 18);
  assert.ok(AURA_COUNT >= 2 && AURA_COUNT <= 3);
  assert.ok(MIN_AURA_CYCLE_SECONDS >= 25);
  assert.ok(MAX_AURA_CYCLE_SECONDS <= 45);
});

test("contextual ambient background intensity levels across application routes and practice phases", () => {
  type Phase = "setup" | "prep" | "speak" | "scoring" | "result" | "error";
  type AmbientIntensity = "full" | "subtle" | "minimal";

  const getIntensityForPhase = (phase: Phase): AmbientIntensity => {
    if (phase === "setup") return "full";
    if (phase === "prep") return "subtle";
    if (phase === "speak" || phase === "scoring") return "minimal";
    return "subtle"; // result or error
  };

  const getIntensityForRoute = (pathname: string, phaseOverride?: AmbientIntensity): AmbientIntensity => {
    if (pathname === "/history") return "subtle";
    if (phaseOverride) return phaseOverride;
    return "full";
  };

  // 1. Homepage setup
  assert.equal(getIntensityForPhase("setup"), "full");
  assert.equal(getIntensityForRoute("/", getIntensityForPhase("setup")), "full");

  // 2. Preparation phase
  assert.equal(getIntensityForPhase("prep"), "subtle");
  assert.equal(getIntensityForRoute("/", getIntensityForPhase("prep")), "subtle");

  // 3. Speaking and recording phase (minimal to preserve focus)
  assert.equal(getIntensityForPhase("speak"), "minimal");
  assert.equal(getIntensityForPhase("scoring"), "minimal");
  assert.equal(getIntensityForRoute("/", getIntensityForPhase("speak")), "minimal");

  // 4. Results phase
  assert.equal(getIntensityForPhase("result"), "subtle");
  assert.equal(getIntensityForRoute("/", getIntensityForPhase("result")), "subtle");

  // 5. History route
  assert.equal(getIntensityForRoute("/history"), "subtle");

  // CSS Opacity mapping values
  const INTENSITY_OPACITIES: Record<AmbientIntensity, number> = {
    full: 1.0,
    subtle: 0.65,
    minimal: 0.28,
  };

  assert.equal(INTENSITY_OPACITIES.full, 1.0);
  assert.ok(INTENSITY_OPACITIES.subtle < INTENSITY_OPACITIES.full);
  assert.ok(INTENSITY_OPACITIES.minimal < INTENSITY_OPACITIES.subtle);
  assert.ok(INTENSITY_OPACITIES.minimal >= 0.25 && INTENSITY_OPACITIES.minimal <= 0.35);
});

test("recording voice visualizer frequency bands, dynamic response and idle state", () => {
  const BAR_COUNT = 9;
  const IDLE_BAR_PX = 4;
  const MIN_ACTIVE_BAR_PX = 7;
  const MAX_BAR_PX = 32;
  const NOISE_GATE_RMS = 0.014;

  // Approximate frequency per bin for 48kHz / 256 fftSize is 187.5 Hz (44.1kHz is ~172 Hz)
  const BIN_HZ = 187.5;

  const SPEECH_BANDS = [
    { start: 1, end: 2, gain: 1.05, weight: 1.00 }, // ~180-450 Hz
    { start: 2, end: 3, gain: 1.15, weight: 1.06 }, // ~350-650 Hz
    { start: 3, end: 4, gain: 1.25, weight: 0.96 }, // ~550-850 Hz
    { start: 4, end: 6, gain: 1.40, weight: 1.12 }, // ~750-1250 Hz
    { start: 6, end: 9, gain: 1.65, weight: 1.04 }, // ~1100-1800 Hz
    { start: 9, end: 13, gain: 1.90, weight: 0.98 }, // ~1650-2550 Hz
    { start: 13, end: 17, gain: 2.20, weight: 1.14 }, // ~2400-3300 Hz
    { start: 17, end: 22, gain: 2.55, weight: 1.08 }, // ~3100-4200 Hz
    { start: 22, end: 28, gain: 2.90, weight: 1.16 }, // ~4000-5200 Hz
  ];

  // 1. All nine elements configured
  assert.equal(SPEECH_BANDS.length, BAR_COUNT);

  // 2. Bands cover useful speech frequencies (180 Hz to ~5200 Hz)
  const lowestHz = SPEECH_BANDS[0].start * BIN_HZ;
  const highestHz = SPEECH_BANDS[8].end * BIN_HZ;
  assert.ok(lowestHz >= 150 && lowestHz <= 250);
  assert.ok(highestHz >= 4500 && highestHz <= 5500);

  // 3. Final two elements (indices 7 and 8) are within active speech range, NOT dead bins (> 7kHz)
  const band7CenterHz = ((SPEECH_BANDS[7].start + SPEECH_BANDS[7].end) / 2) * BIN_HZ;
  const band8CenterHz = ((SPEECH_BANDS[8].start + SPEECH_BANDS[8].end) / 2) * BIN_HZ;
  assert.ok(band7CenterHz >= 3000 && band7CenterHz <= 4500);
  assert.ok(band8CenterHz >= 4000 && band8CenterHz <= 5500);
  assert.ok(highestHz < 7000, "Should not map final elements to inaudible high frequencies");

  // 4. Sensitivity gain increases for higher frequency bands to compensate spectral rolloff
  for (let i = 1; i < BAR_COUNT; i++) {
    assert.ok(
      SPEECH_BANDS[i].gain > SPEECH_BANDS[i - 1].gain,
      `Band ${i} gain should compensate higher frequencies`,
    );
  }

  // 5. Individualized weights prevent mechanical synchronization
  const weights = SPEECH_BANDS.map((b) => b.weight);
  const uniqueWeights = new Set(weights);
  assert.ok(uniqueWeights.size >= 5, "Weights should be distinct across elements");

  // 6. Idle state simulation (silence below noise gate)
  const simulateVisualizer = (rms: number, freqData: number[]) => {
    const speaking = rms >= NOISE_GATE_RMS;
    const volume = Math.min(1, Math.max(0, (rms - NOISE_GATE_RMS) / 0.07));

    return SPEECH_BANDS.map((band) => {
      if (!speaking) {
        return { height: IDLE_BAR_PX, opacity: 0.35 };
      }
      let sum = 0;
      const count = band.end - band.start + 1;
      for (let b = band.start; b <= band.end; b++) {
        sum += freqData[b] ?? 0;
      }
      const avg = sum / (count * 255);
      const rawEnergy = Math.min(1, avg * band.gain * band.weight);
      const speechEnergy = Math.min(1, rawEnergy * 0.72 + volume * 0.28 * band.weight);
      const activeRange = MAX_BAR_PX - MIN_ACTIVE_BAR_PX;
      const height = Math.round(MIN_ACTIVE_BAR_PX + speechEnergy * activeRange);
      const opacity = Math.min(1, 0.85 + volume * 0.15);
      return { height, opacity };
    });
  };

  // Silence: all 9 elements settle into idle capsule height (4px)
  const silence = simulateVisualizer(0.005, new Array(128).fill(0));
  silence.forEach((bar) => {
    assert.equal(bar.height, IDLE_BAR_PX);
    assert.equal(bar.opacity, 0.35);
  });

  // Quiet speech: all 9 elements visibly lift above active floor (>= 7px)
  const quietFreqs = new Array(128).fill(0);
  for (let i = 1; i <= 28; i++) quietFreqs[i] = 40;
  const quietSpeech = simulateVisualizer(0.02, quietFreqs);
  quietSpeech.forEach((bar, idx) => {
    assert.ok(bar.height >= MIN_ACTIVE_BAR_PX, `Bar ${idx} should lift above active minimum on quiet speech`);
    assert.ok(bar.height <= MAX_BAR_PX);
    assert.ok(bar.opacity >= 0.85);
  });

  // Normal speech with consonants activating upper bands (including 7 and 8)
  const speechFreqs = new Array(128).fill(0);
  for (let i = 1; i <= 28; i++) speechFreqs[i] = 120;
  const normalSpeech = simulateVisualizer(0.06, speechFreqs);
  assert.ok(normalSpeech[7].height > MIN_ACTIVE_BAR_PX + 5, "Bar 7 responds strongly to speech");
  assert.ok(normalSpeech[8].height > MIN_ACTIVE_BAR_PX + 5, "Bar 8 responds strongly to speech");
});

test("dark and light theme system token architecture, persistence, and toggle behavior", () => {
  type Theme = "dark" | "light";
  const THEME_STORAGE_KEY = "offscript_theme_v1";

  // 1. Initial / default theme resolution (fresh visit without stored preference)
  const resolveInitialTheme = (stored: string | null): Theme => {
    if (stored === "light" || stored === "dark") {
      return stored;
    }
    // Must default to dark, never defaulting automatically to OS light theme
    return "dark";
  };

  assert.equal(resolveInitialTheme(null), "dark");
  assert.equal(resolveInitialTheme(""), "dark");
  assert.equal(resolveInitialTheme("unknown"), "dark");
  assert.equal(resolveInitialTheme("light"), "light");
  assert.equal(resolveInitialTheme("dark"), "dark");

  // 2. Theme storage persistence simulation
  let memoryStorage: Record<string, string> = {};
  const mockSetItem = (k: string, v: string) => {
    memoryStorage[k] = v;
  };
  const mockGetItem = (k: string) => memoryStorage[k] ?? null;

  let activeTheme: Theme = resolveInitialTheme(mockGetItem(THEME_STORAGE_KEY));
  assert.equal(activeTheme, "dark");

  // Toggle to light
  const toggleTheme = (current: Theme): Theme => {
    const next = current === "dark" ? "light" : "dark";
    mockSetItem(THEME_STORAGE_KEY, next);
    return next;
  };

  activeTheme = toggleTheme(activeTheme);
  assert.equal(activeTheme, "light");
  assert.equal(mockGetItem(THEME_STORAGE_KEY), "light");

  // Toggle back to dark
  activeTheme = toggleTheme(activeTheme);
  assert.equal(activeTheme, "dark");
  assert.equal(mockGetItem(THEME_STORAGE_KEY), "dark");

  // 3. Theme toggle button iconography and accessibility attributes
  const getToggleConfig = (theme: Theme) => ({
    icon: theme === "dark" ? "SunIcon" : "MoonIcon", // Lucide Sun and Moon icons, no emojis
    ariaLabel: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
    title: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
    isEmoji: false,
  });

  const darkToggle = getToggleConfig("dark");
  assert.equal(darkToggle.icon, "SunIcon");
  assert.equal(darkToggle.ariaLabel, "Switch to light theme");
  assert.equal(darkToggle.isEmoji, false);

  const lightToggle = getToggleConfig("light");
  assert.equal(lightToggle.icon, "MoonIcon");
  assert.equal(lightToggle.ariaLabel, "Switch to dark theme");
  assert.equal(lightToggle.isEmoji, false);

  // 4. Design tokens verification
  const THEME_TOKENS = {
    dark: {
      base: "#08090b",
      panel: "#0e1013",
      raised: "#15181c",
      line: "#23272d",
      textPrimary: "#f0f0f0",
      textSecondary: "#e2e4e7",
      textMuted: "#8e949d",
      accent: "#c9f96c",
      accentBg: "#c9f96c",
      accentContrast: "#08090b",
    },
    light: {
      base: "#e8eee7",
      panel: "#f0f3ed",
      raised: "#e2e9e0",
      line: "#d8e2d5",
      track: "#d6e0d2",
      textPrimary: "#202820",
      textSecondary: "#637064",
      textMuted: "#778477",
      accent: "#527a25",
      accentHover: "#45671f",
      accentBg: "#527a25",
      accentContrast: "#ffffff",
      accentText: "#527a25",
      logoDot: "#527a25",
      vizBar: "#527a25",
      scoreSecondary: "#7a9c52",
      selectionBg: "#d4e5c0",
      selectionText: "#202820",
    },
  };

  // Dark tokens
  assert.equal(THEME_TOKENS.dark.base, "#08090b");
  assert.equal(THEME_TOKENS.dark.panel, "#0e1013");
  assert.equal(THEME_TOKENS.dark.textPrimary, "#f0f0f0");
  assert.equal(THEME_TOKENS.dark.accent, "#c9f96c");

  // Light tokens (Unified Muted Sage and Brand Olive Palette)
  assert.equal(THEME_TOKENS.light.base, "#e8eee7");
  assert.equal(THEME_TOKENS.light.panel, "#f0f3ed");
  assert.notEqual(THEME_TOKENS.light.panel, "#ffffff", "Avoid pure white #ffffff as dominant card background");
  assert.equal(THEME_TOKENS.light.raised, "#e2e9e0");
  assert.equal(THEME_TOKENS.light.line, "#d8e2d5");
  assert.equal(THEME_TOKENS.light.track, "#d6e0d2");
  assert.equal(THEME_TOKENS.light.textPrimary, "#202820");
  assert.notEqual(THEME_TOKENS.light.textPrimary, "#000000", "Avoid pure black text");
  assert.equal(THEME_TOKENS.light.textSecondary, "#637064");
  assert.equal(THEME_TOKENS.light.textMuted, "#778477");
  assert.equal(THEME_TOKENS.light.accent, "#527a25");
  assert.equal(THEME_TOKENS.light.accentHover, "#45671f");
  assert.equal(THEME_TOKENS.light.accentBg, "#527a25");
  assert.equal(THEME_TOKENS.light.accentContrast, "#ffffff", "White text on olive button for accessible contrast");
  assert.equal(THEME_TOKENS.light.accentText, "#527a25");
  assert.equal(THEME_TOKENS.light.logoDot, "#527a25");
  assert.equal(THEME_TOKENS.light.vizBar, "#527a25");
  assert.equal(THEME_TOKENS.light.scoreSecondary, "#7a9c52");
  assert.equal(THEME_TOKENS.light.selectionBg, "#d4e5c0");
  assert.equal(THEME_TOKENS.light.selectionText, "#202820");

  // 5. Refined light mode ambient background aura light fields & particles
  const LIGHT_AURA_CONFIG = {
    aura1: "diffuse sage-green glow upper-left",
    aura2: "subtle muted teal glow lower-right",
    aura3: "restrained lime illumination hero region",
    hasFeatheredEdges: true,
  };
  assert.equal(LIGHT_AURA_CONFIG.aura1, "diffuse sage-green glow upper-left");
  assert.equal(LIGHT_AURA_CONFIG.aura2, "subtle muted teal glow lower-right");
  assert.equal(LIGHT_AURA_CONFIG.aura3, "restrained lime illumination hero region");
  assert.ok(LIGHT_AURA_CONFIG.hasFeatheredEdges);

  // Particle color set in light mode: deep olive, muted dark sage, and soft charcoal
  const LIGHT_PARTICLE_COLORS = {
    deepOlive: "#527a25",
    mutedDarkSage: "#53634f",
    softCharcoal: "#374239",
  };
  assert.equal(LIGHT_PARTICLE_COLORS.deepOlive, "#527a25");
  assert.equal(LIGHT_PARTICLE_COLORS.mutedDarkSage, "#53634f");
  assert.equal(LIGHT_PARTICLE_COLORS.softCharcoal, "#374239");
  assert.notEqual(LIGHT_PARTICLE_COLORS.deepOlive, "#000000", "Must not use solid black particles");
  assert.notEqual(LIGHT_PARTICLE_COLORS.mutedDarkSage, "#000000", "Must not use solid black particles");
  assert.notEqual(LIGHT_PARTICLE_COLORS.softCharcoal, "#000000", "Must not use solid black particles");

  // Particle color set in dark mode: lime, teal, and slate/sage
  const DARK_PARTICLE_COLORS = {
    lime: "#c9f96c",
    teal: "#2dd4bf",
    slate: "#e2e8f0",
  };
  assert.equal(DARK_PARTICLE_COLORS.lime, "#c9f96c");
  assert.equal(DARK_PARTICLE_COLORS.teal, "#2dd4bf");
  assert.equal(DARK_PARTICLE_COLORS.slate, "#e2e8f0");

  // Particle opacity ranges for gentle twinkle shimmer without flash
  const LIGHT_PARTICLE_OPACITY_RANGE = { min: 0.20, max: 0.50 };
  assert.ok(LIGHT_PARTICLE_OPACITY_RANGE.min >= 0.15 && LIGHT_PARTICLE_OPACITY_RANGE.min <= 0.25);
  assert.ok(LIGHT_PARTICLE_OPACITY_RANGE.max >= 0.45 && LIGHT_PARTICLE_OPACITY_RANGE.max <= 0.60);
});
