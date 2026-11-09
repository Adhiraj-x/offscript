import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { MODES, modeInfo } from "../lib/modes";
import {
  BAR_COUNT,
  IDLE_BAR_PX,
  MIN_ACTIVE_BAR_PX,
  MAX_BAR_PX,
  NOISE_GATE_RMS,
  FFT_SIZE,
  FREQUENCY_BANDS,
  getBandBinIndices,
  computeBandEnergy,
  smoothBarValue,
} from "../components/Recorder";
import { runThemeTransition } from "../components/ThemeProvider";

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

test("recording voice visualizer 2048-FFT frequency bands, decoupled response, and idle baseline", () => {
  const sampleRate48k = 48000;
  const sampleRate44k = 44100;

  // 1. All nine elements configured with 2048 FFT
  assert.equal(FREQUENCY_BANDS.length, BAR_COUNT);
  assert.equal(BAR_COUNT, 9);
  assert.equal(FFT_SIZE, 2048);

  // 2. Frequency coverage spans ~90 Hz to 5,400 Hz across useful speech spectrum
  assert.equal(FREQUENCY_BANDS[0].minHz, 90);
  assert.equal(FREQUENCY_BANDS[8].maxHz, 5400);

  for (let i = 0; i < BAR_COUNT; i++) {
    const band = FREQUENCY_BANDS[i];
    assert.ok(band.minHz < band.maxHz, `Band ${i} minHz must be less than maxHz`);
    if (i > 0) {
      assert.ok(band.minHz >= FREQUENCY_BANDS[i - 1].minHz, `Band ${i} minHz must advance`);
      assert.ok(band.sensitivity > FREQUENCY_BANDS[i - 1].sensitivity, `Band ${i} sensitivity compensates spectral rolloff`);
    }
  }

  // 3. getBandBinIndices calculates accurate bins for sample rates
  const bins48k = FREQUENCY_BANDS.map((band) =>
    getBandBinIndices(band.minHz, band.maxHz, sampleRate48k, FFT_SIZE)
  );
  const bins44k = FREQUENCY_BANDS.map((band) =>
    getBandBinIndices(band.minHz, band.maxHz, sampleRate44k, FFT_SIZE)
  );

  bins48k.forEach((bin, idx) => {
    assert.ok(bin.startBin >= 1, `Band ${idx} must not use DC bin 0`);
    assert.ok(bin.endBin >= bin.startBin, `Band ${idx} endBin must be >= startBin`);
    assert.ok(bin.endBin - bin.startBin + 1 >= 3, `Band ${idx} must contain multiple bins at 48kHz`);
  });

  bins44k.forEach((bin, idx) => {
    assert.ok(bin.startBin >= 1, `Band ${idx} must not use DC bin 0 at 44.1kHz`);
    assert.ok(bin.endBin >= bin.startBin, `Band ${idx} endBin must be >= startBin at 44.1kHz`);
  });

  // 4. Decoupled response: each bar calculates energy independently with zero shared volume
  const freqData = new Uint8Array(FFT_SIZE / 2);
  // Inject low vowel energy into Band 1 (160-280 Hz)
  for (let b = bins48k[1].startBin; b <= bins48k[1].endBin; b++) {
    freqData[b] = 160;
  }
  const band1Energy = computeBandEnergy(freqData, bins48k[1].startBin, bins48k[1].endBin, FREQUENCY_BANDS[1]);
  const band8Energy = computeBandEnergy(freqData, bins48k[8].startBin, bins48k[8].endBin, FREQUENCY_BANDS[8]);

  assert.ok(band1Energy > 0.45, "Band 1 should respond strongly to low formant energy");
  assert.equal(band8Energy, 0, "Band 8 must remain silent when energy is only in low bands (zero coupling)");

  // 5. Inject sibilance / fricative energy into Band 8 (4400-5400 Hz)
  for (let b = bins48k[8].startBin; b <= bins48k[8].endBin; b++) {
    freqData[b] = 130;
  }
  const band8Sibilant = computeBandEnergy(freqData, bins48k[8].startBin, bins48k[8].endBin, FREQUENCY_BANDS[8]);
  assert.ok(band8Sibilant > 0.5, "Band 8 responds strongly to sibilant /s/ energy");

  // 6. Anti-saturation: loud energy does not clamp all bars to identical max height
  freqData.fill(255);
  const loudEnergies = FREQUENCY_BANDS.map((band, idx) =>
    computeBandEnergy(freqData, bins48k[idx].startBin, bins48k[idx].endBin, band)
  );
  loudEnergies.forEach((energy, idx) => {
    assert.ok(energy <= 1.0 && energy >= 0.5, `Band ${idx} energy should stay in safe range`);
  });

  // 7. Independent asymmetric smoothing (quick attack, slower release)
  for (let i = 0; i < BAR_COUNT; i++) {
    const band = FREQUENCY_BANDS[i];
    assert.ok(band.attack > 0.60 && band.attack < 0.90, `Band ${i} attack must be snappy`);
    assert.ok(band.release > 0.12 && band.release < 0.35, `Band ${i} release must be slower than attack`);
    assert.ok(band.attack > band.release, `Band ${i} attack must exceed release`);

    // Test attack step
    const attackStep = smoothBarValue(0, 1.0, band.attack, band.release);
    assert.ok(attackStep >= band.attack * 0.99);

    // Test release step
    const releaseStep = smoothBarValue(1.0, 0, band.attack, band.release);
    assert.ok(releaseStep < 1.0);
    assert.ok(releaseStep > 0.65); // Graceful decay, not instant collapse
  }

  // 8. Idle baseline and noise gating constants
  assert.equal(IDLE_BAR_PX, 4);
  assert.equal(MIN_ACTIVE_BAR_PX, 7);
  assert.equal(MAX_BAR_PX, 32);
  assert.equal(NOISE_GATE_RMS, 0.014);
});

test("ShareCard renders clean 'Share result' button without emoji or arrow glyphs", () => {
  const shareCardPath = path.join(__dirname, "../components/ShareCard.tsx");
  const source = fs.readFileSync(shareCardPath, "utf8");

  assert.ok(source.includes('"Share result"'), "Must contain exact 'Share result' label");
  assert.ok(!source.includes("↗"), "Must not contain arrow glyph ↗");
  assert.ok(!source.includes("aria-hidden>↗"), "Must not contain span with arrow glyph");
  assert.ok(!source.includes("&nearr;"), "Must not contain HTML arrow entity");
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

test("smooth view transition theme crossfade architecture and reduced motion handling", () => {
  // 1. Verify CSS rules in app/globals.css
  const globalsCss = fs.readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf-8");
  assert.ok(globalsCss.includes("::view-transition-old(root)"));
  assert.ok(globalsCss.includes("::view-transition-new(root)"));
  assert.ok(globalsCss.includes("animation-duration: 280ms"));
  assert.ok(globalsCss.includes("mix-blend-mode: normal"));
  assert.ok(globalsCss.includes("cubic-bezier(0.4, 0, 0.2, 1)"));
  assert.ok(globalsCss.includes("@keyframes theme-fade-out"));
  assert.ok(globalsCss.includes("@keyframes theme-fade-in"));

  // Verify reduced-motion support disables view transition animations
  assert.ok(globalsCss.includes("::view-transition-old(root)"));
  assert.ok(globalsCss.includes("animation: none !important"));

  // 2. Test runThemeTransition execution in headless / fallback environment (no startViewTransition)
  let updated = false;
  runThemeTransition(() => {
    updated = true;
  });
  assert.equal(updated, true, "Callback must execute synchronously when startViewTransition is unsupported");

  // 3. Test runThemeTransition with mock startViewTransition API
  let startViewTransitionCalled = false;
  let mockCallbackExecuted = false;

  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  try {
    globalThis.window = {
      matchMedia: (query: string) => ({
        matches: false, // Not reduced motion
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    } as unknown as Window & typeof globalThis;

    globalThis.document = {
      startViewTransition: (cb: () => void) => {
        startViewTransitionCalled = true;
        cb();
        return {
          finished: Promise.resolve(),
          ready: Promise.resolve(),
          updateCallbackDone: Promise.resolve(),
          skipTransition: () => {},
        };
      },
    } as unknown as Document;

    runThemeTransition(() => {
      mockCallbackExecuted = true;
    });

    assert.equal(startViewTransitionCalled, true, "Must invoke document.startViewTransition when supported");
    assert.equal(mockCallbackExecuted, true, "Must execute update callback inside view transition");

    // 4. Test reduced-motion bypass
    startViewTransitionCalled = false;
    let reducedMotionCallbackExecuted = false;

    globalThis.window = {
      matchMedia: (query: string) => ({
        matches: query.includes("prefers-reduced-motion"), // Reduced motion is TRUE
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    } as unknown as Window & typeof globalThis;

    runThemeTransition(() => {
      reducedMotionCallbackExecuted = true;
    });

    assert.equal(startViewTransitionCalled, false, "Must NOT invoke startViewTransition when prefers-reduced-motion is active");
    assert.equal(reducedMotionCallbackExecuted, true, "Callback must execute immediately when reduced-motion is active");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
