"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatClock } from "@/lib/format";

const MAX_SECONDS = 120;
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

/** RMS below this counts as room noise, so the visualizer reads as a flat line. */
export const NOISE_GATE_RMS = 0.014;
export const BAR_COUNT = 9;
export const IDLE_BAR_PX = 4;
export const MIN_ACTIVE_BAR_PX = 7;
export const MAX_BAR_PX = 32;
export const FFT_SIZE = 2048;

export interface FrequencyBandConfig {
  readonly minHz: number;
  readonly maxHz: number;
  readonly sensitivity: number;
  readonly noiseFloor: number;
  readonly attack: number;
  readonly release: number;
  readonly description: string;
}

/**
 * Nine distinct speech frequency bands logarithmically distributed across ~90 Hz to 5,400 Hz.
 * Spans vocal fundamentals, vowel formants (F1, F2), clarity, consonant definition (F3), and sibilance.
 * Sensitivity scaling compensates for natural human speech spectral rolloff (-6 dB/octave).
 * Independent attack and release values provide responsive, organic envelope dynamics per bar.
 */
export const FREQUENCY_BANDS: readonly FrequencyBandConfig[] = [
  {
    minHz: 90,
    maxHz: 160,
    sensitivity: 1.15,
    noiseFloor: 0.08,
    attack: 0.65,
    release: 0.16,
    description: "Vocal fundamental pitch (deep/chest)",
  },
  {
    minHz: 160,
    maxHz: 280,
    sensitivity: 1.25,
    noiseFloor: 0.07,
    attack: 0.68,
    release: 0.18,
    description: "Vocal fundamental & lower warmth",
  },
  {
    minHz: 280,
    maxHz: 500,
    sensitivity: 1.45,
    noiseFloor: 0.06,
    attack: 0.70,
    release: 0.19,
    description: "Low vowel body & first formant (F1)",
  },
  {
    minHz: 500,
    maxHz: 900,
    sensitivity: 1.70,
    noiseFloor: 0.05,
    attack: 0.72,
    release: 0.20,
    description: "Core vowel formants (open F1)",
  },
  {
    minHz: 900,
    maxHz: 1450,
    sensitivity: 2.00,
    noiseFloor: 0.05,
    attack: 0.74,
    release: 0.21,
    description: "Vocal articulation & transitions (F2)",
  },
  {
    minHz: 1450,
    maxHz: 2300,
    sensitivity: 2.35,
    noiseFloor: 0.04,
    attack: 0.76,
    release: 0.22,
    description: "Speech intelligibility & upper F2",
  },
  {
    minHz: 2300,
    maxHz: 3400,
    sensitivity: 2.75,
    noiseFloor: 0.04,
    attack: 0.78,
    release: 0.24,
    description: "Consonant definition & clarity (F3)",
  },
  {
    minHz: 3400,
    maxHz: 4400,
    sensitivity: 3.15,
    noiseFloor: 0.04,
    attack: 0.80,
    release: 0.25,
    description: "High fricative & consonant articulation",
  },
  {
    minHz: 4400,
    maxHz: 5400,
    sensitivity: 3.55,
    noiseFloor: 0.04,
    attack: 0.82,
    release: 0.26,
    description: "Sibilance & high consonant crispness",
  },
] as const;

/** Alias for backwards compatibility */
export const SPEECH_BANDS = FREQUENCY_BANDS;

/**
 * Calculates start and end FFT bin indices for a given frequency range in Hz,
 * based on the actual AudioContext sample rate and FFT size.
 */
export function getBandBinIndices(
  minHz: number,
  maxHz: number,
  sampleRate: number,
  fftSize: number
): { startBin: number; endBin: number } {
  const safeSampleRate = sampleRate > 0 ? sampleRate : 48000;
  const safeFftSize = fftSize > 0 ? fftSize : 2048;
  const binResolution = safeSampleRate / safeFftSize;
  const maxBin = Math.floor(safeFftSize / 2) - 1;

  // Skip bin 0 (DC offset)
  const startBin = Math.max(1, Math.min(maxBin, Math.floor(minHz / binResolution)));
  const endBin = Math.max(startBin, Math.min(maxBin, Math.ceil(maxHz / binResolution)));
  return { startBin, endBin };
}

/**
 * Computes normalized energy for a specific frequency band from raw FFT byte data.
 * Blends mean energy (70%) and peak harmonic energy (30%), subtracts the band noise floor,
 * applies band sensitivity, and compresses softly to prevent saturation.
 */
export function computeBandEnergy(
  freqData: Uint8Array | number[],
  startBin: number,
  endBin: number,
  config: Pick<FrequencyBandConfig, "sensitivity" | "noiseFloor">
): number {
  if (startBin > endBin || endBin >= freqData.length) return 0;

  let sum = 0;
  let peak = 0;
  const count = endBin - startBin + 1;

  for (let b = startBin; b <= endBin; b += 1) {
    const val = freqData[b] ?? 0;
    sum += val;
    if (val > peak) peak = val;
  }

  const meanNorm = sum / (count * 255);
  const peakNorm = peak / 255;
  const combined = meanNorm * 0.7 + peakNorm * 0.3;

  const floor = config.noiseFloor;
  const aboveFloor = Math.max(0, combined - floor) / Math.max(0.001, 1 - floor);
  const amplified = aboveFloor * config.sensitivity;

  // Soft compressive curve: prevents multiple bands flattening at max height during speech
  const compressed = amplified <= 0 ? 0 : amplified / (1 + 0.35 * amplified);
  return Math.min(1, Math.max(0, compressed));
}

/**
 * Applies asymmetric attack/release smoothing to a bar's energy value.
 * Quick attack captures sudden transients, while slower release creates natural, fluid decay.
 */
export function smoothBarValue(
  current: number,
  target: number,
  attack: number,
  release: number
): number {
  if (isNaN(current)) return target;
  if (target > current) {
    return current + (target - current) * attack;
  }
  return current + (target - current) * release;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Props = {
  onComplete: (blob: Blob) => void;
  onCancel: () => void;
};

export default function Recorder({ onComplete, onCancel }: Props) {
  const [status, setStatus] = useState<"starting" | "recording" | "error">("starting");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const finishedRef = useRef(false);
  const tickRef = useRef<number | null>(null);
  const autoStopRef = useRef<number | null>(null);

  // Web Audio graph for the visualizer (analyser is intentionally not routed to output).
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const levelRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const stopVisualizer = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      sourceRef.current?.disconnect();
    } catch {
      // Already disconnected.
    }
    try {
      analyserRef.current?.disconnect();
    } catch {
      // Already disconnected.
    }
    sourceRef.current = null;
    analyserRef.current = null;

    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => {});
    }

    for (const bar of barsRef.current) {
      if (bar) {
        bar.style.height = `${IDLE_BAR_PX}px`;
        bar.style.opacity = "0.35";
      }
    }
    if (levelRef.current) levelRef.current.style.width = "0%";
  }, []);

  const startVisualizer = useCallback((stream: MediaStream) => {
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    let context: AudioContext;
    try {
      context = new AudioContextCtor();
    } catch {
      return;
    }

    audioContextRef.current = context;
    // Safari can hand back a suspended context even after a user gesture.
    if (context.state === "suspended") {
      void context.resume().catch(() => {});
    }

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.45;
    source.connect(analyser);
    // Deliberately not connected to context.destination: no monitoring, no echo.

    sourceRef.current = source;
    analyserRef.current = analyser;

    const timeData = new Uint8Array(analyser.fftSize);
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const simpleLevel = prefersReducedMotion();

    // Precalculate frequency bin ranges for each of the 9 bands using actual sampleRate and FFT size
    const binRanges = FREQUENCY_BANDS.map((band) =>
      getBandBinIndices(band.minHz, band.maxHz, context.sampleRate, FFT_SIZE)
    );

    // Track smoothed energy independently per bar across frames
    const currentEnergies = new Float32Array(BAR_COUNT);

    const tick = () => {
      rafRef.current = window.requestAnimationFrame(tick);

      analyser.getByteTimeDomainData(timeData);
      let sum = 0;
      for (let index = 0; index < timeData.length; index += 1) {
        const deviation = (timeData[index] - 128) / 128;
        sum += deviation * deviation;
      }
      const rms = Math.sqrt(sum / timeData.length);
      const speaking = rms >= NOISE_GATE_RMS;
      // Perceptually smooth volume factor above noise gate for reduced-motion indicator
      const volume = Math.min(1, Math.max(0, (rms - NOISE_GATE_RMS) / 0.07));

      if (simpleLevel) {
        if (levelRef.current) {
          levelRef.current.style.width = `${Math.round((speaking ? volume : 0) * 100)}%`;
        }
        return;
      }

      if (speaking) {
        analyser.getByteFrequencyData(freqData);
      }

      for (let index = 0; index < BAR_COUNT; index += 1) {
        const bar = barsRef.current[index];
        if (!bar) continue;

        const band = FREQUENCY_BANDS[index] ?? FREQUENCY_BANDS[0];
        const bins = binRanges[index] ?? binRanges[0];

        // 1. Calculate target energy independently from its own frequency band (zero shared volume)
        const targetEnergy = speaking
          ? computeBandEnergy(freqData, bins.startBin, bins.endBin, band)
          : 0;

        // 2. Independent attack/release smoothing per bar
        const smoothed = smoothBarValue(
          currentEnergies[index] ?? 0,
          targetEnergy,
          band.attack,
          band.release
        );
        currentEnergies[index] = smoothed;

        // 3. Render bar height and opacity
        if (!speaking && smoothed < 0.02) {
          // Gated silence: settled into the subtle idle capsule baseline
          bar.style.height = `${IDLE_BAR_PX}px`;
          bar.style.opacity = "0.35";
        } else {
          const activeRange = MAX_BAR_PX - MIN_ACTIVE_BAR_PX;
          const targetHeight = Math.round(MIN_ACTIVE_BAR_PX + smoothed * activeRange);
          bar.style.height = `${targetHeight}px`;
          bar.style.opacity = `${(0.85 + smoothed * 0.15).toFixed(2)}`;
        }
      }
    };

    rafRef.current = window.requestAnimationFrame(tick);
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Already stopped.
      }
    }
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    if (autoStopRef.current !== null) window.clearTimeout(autoStopRef.current);
    stopVisualizer();
  }, [stopVisualizer]);

  useEffect(() => {
    let cancelled = false;
    finishedRef.current = false;
    chunksRef.current = [];

    function fail(message: string) {
      if (cancelled) return;
      setError(message);
      setStatus("error");
    }

    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        fail("This browser can't record audio. Try Chrome, Edge, Firefox or Safari on desktop.");
        return;
      }
      if (typeof MediaRecorder === "undefined") {
        fail("This browser doesn't support recording. Try a newer version of Chrome, Edge, Firefox or Safari.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        const mimeType = pickMimeType();
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorderRef.current = recorder;

        recorder.ondataavailable = (event: BlobEvent) => {
          if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
        };

        recorder.onerror = () => {
          fail("Recording stopped unexpectedly. Check your microphone and try again.");
        };

        recorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          stopVisualizer();
          if (cancelled || finishedRef.current) return;
          finishedRef.current = true;
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || mimeType || "audio/webm",
          });
          if (blob.size < 1000) {
            setError("That take was too short to score. Give it at least a few sentences.");
            setStatus("error");
            return;
          }
          onCompleteRef.current(blob);
        };

        recorder.start(500);
        startVisualizer(stream);
        setStatus("recording");
        tickRef.current = window.setInterval(() => {
          setElapsed((value) => Math.min(MAX_SECONDS, value + 1));
        }, 1000);
        autoStopRef.current = window.setTimeout(() => {
          if (recorder.state === "recording") recorder.stop();
        }, MAX_SECONDS * 1000);
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
          fail("Microphone access is blocked. Allow the mic in your browser's site settings, then try again.");
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          fail("No microphone found. Plug one in or pick another input, then try again.");
        } else if (name === "NotReadableError" || name === "TrackStartError") {
          fail("Your microphone is busy in another app. Close it and try again.");
        } else {
          fail("We couldn't start the microphone. Check your device settings and try again.");
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      finishedRef.current = true;
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
      if (autoStopRef.current !== null) window.clearTimeout(autoStopRef.current);
      stopVisualizer();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Already stopped.
        }
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [startVisualizer, stopVisualizer]);

  if (status === "error") {
    return (
      <div className="rounded-2xl border border-red-400/25 bg-red-400/[0.06] p-8 text-center">
        <p className="text-[11px] uppercase tracking-[0.22em] text-red-300/80">Recording problem</p>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-foreground/85">{error}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-contrast transition-opacity hover:opacity-90"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-line px-5 py-2.5 text-sm text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            Change topic
          </button>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, MAX_SECONDS - elapsed);

  return (
    <div className="rounded-2xl border border-line bg-panel p-8 text-center sm:p-10">
      <div className="flex items-center justify-center gap-2.5">
        <span className="rec-dot h-2.5 w-2.5 rounded-full bg-red-500" />
        <span className="text-[11px] uppercase tracking-[0.22em] text-red-500 dark:text-red-300">
          {status === "recording" ? "Recording" : "Starting mic…"}
        </span>
      </div>

      <p className="mt-5 font-mono text-6xl tabular-nums tracking-tight sm:text-7xl">
        {formatClock(remaining)}
      </p>

      {reducedMotion ? (
        <div className="mt-7 flex h-8 items-center justify-center" aria-hidden>
          <span className="relative block h-1 w-40 overflow-hidden rounded-full bg-track">
            <span
              ref={levelRef}
              className="absolute inset-y-0 left-0 block rounded-full bg-accent"
              style={{ width: "0%" }}
            />
          </span>
        </div>
      ) : (
        <div className="mt-7 flex h-8 items-center justify-center gap-1.5" aria-hidden>
          {Array.from({ length: BAR_COUNT }).map((_, index) => (
            <span
              key={index}
              ref={(node) => {
                barsRef.current[index] = node;
              }}
              className="viz-bar"
              style={{ height: `${IDLE_BAR_PX}px`, opacity: 0.35 }}
            />
          ))}
        </div>
      )}

      <p className="mt-6 text-sm text-muted">
        Talk it through. Recording stops automatically at 2:00.
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={stop}
          disabled={status !== "recording"}
          className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-contrast transition-all hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base disabled:cursor-not-allowed disabled:opacity-40"
        >
          Stop &amp; rate
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-line bg-raised/70 px-5 py-2.5 text-sm font-medium text-foreground transition-all hover:border-foreground/30 hover:bg-raised hover:text-foreground active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
