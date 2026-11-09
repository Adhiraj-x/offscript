"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatClock } from "@/lib/format";

const MAX_SECONDS = 120;
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

/** RMS below this counts as room noise, so the visualizer reads as a flat line. */
const NOISE_GATE_RMS = 0.014;
const BAR_COUNT = 9;
const IDLE_BAR_PX = 4;
const MIN_ACTIVE_BAR_PX = 7;
const MAX_BAR_PX = 32;

/**
 * Speech frequency bands for all 9 visualizer elements (fftSize = 256, bin resolution ~180 Hz).
 * Spans ~180 Hz to ~5200 Hz across voice fundamentals, formants, clarity, and sibilance.
 * Each band features an individualized sensitivity gain and weight to prevent mechanical synchronization.
 */
export const SPEECH_BANDS = [
  { start: 1, end: 2, gain: 1.05, weight: 1.00 }, // ~180-450 Hz: fundamental voice pitch & chest
  { start: 2, end: 3, gain: 1.15, weight: 1.06 }, // ~350-650 Hz: lower vowel body / F1
  { start: 3, end: 4, gain: 1.25, weight: 0.96 }, // ~550-850 Hz: core vowel warmth
  { start: 4, end: 6, gain: 1.40, weight: 1.12 }, // ~750-1250 Hz: mid-vowel transition
  { start: 6, end: 9, gain: 1.65, weight: 1.04 }, // ~1100-1800 Hz: vocal articulation / F2
  { start: 9, end: 13, gain: 1.90, weight: 0.98 }, // ~1650-2550 Hz: speech projection / clarity
  { start: 13, end: 17, gain: 2.20, weight: 1.14 }, // ~2400-3300 Hz: consonant definition / F3
  { start: 17, end: 22, gain: 2.55, weight: 1.08 }, // ~3100-4200 Hz: sibilance & high clarity
  { start: 22, end: 28, gain: 2.90, weight: 1.16 }, // ~4000-5200 Hz: upper consonant articulation
];

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
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    // Deliberately not connected to context.destination: no monitoring, no echo.

    sourceRef.current = source;
    analyserRef.current = analyser;

    const timeData = new Uint8Array(analyser.fftSize);
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const simpleLevel = prefersReducedMotion();

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
      // Perceptually smooth volume factor above noise gate
      const volume = Math.min(1, Math.max(0, (rms - NOISE_GATE_RMS) / 0.07));

      if (simpleLevel) {
        if (levelRef.current) {
          levelRef.current.style.width = `${Math.round((speaking ? volume : 0) * 100)}%`;
        }
        return;
      }

      if (speaking) analyser.getByteFrequencyData(freqData);

      for (let index = 0; index < BAR_COUNT; index += 1) {
        const bar = barsRef.current[index];
        if (!bar) continue;

        if (!speaking) {
          // Gated silence: all 9 elements settle into the subtle idle capsule baseline
          bar.style.height = `${IDLE_BAR_PX}px`;
          bar.style.opacity = "0.35";
          continue;
        }

        const band = SPEECH_BANDS[index] ?? SPEECH_BANDS[0];
        let bandSum = 0;
        const binCount = band.end - band.start + 1;
        for (let b = band.start; b <= band.end; b += 1) {
          bandSum += freqData[b] ?? 0;
        }
        const avgBinEnergy = bandSum / (binCount * 255);

        // Modulated frequency energy tailored per band
        const rawBandEnergy = Math.min(1, avgBinEnergy * band.gain * band.weight);

        // Vocal envelope coupling: frequency band activity (72%) + overall RMS vocal energy (28%)
        // This ensures every element, including upper articulation bands 7 & 8, responds organically
        const speechEnergy = Math.min(1, rawBandEnergy * 0.72 + volume * 0.28 * band.weight);

        // Dynamic height range above the subtle active minimum height
        const activeRange = MAX_BAR_PX - MIN_ACTIVE_BAR_PX;
        const targetHeight = Math.round(MIN_ACTIVE_BAR_PX + speechEnergy * activeRange);

        bar.style.height = `${targetHeight}px`;
        bar.style.opacity = `${Math.min(1, 0.85 + volume * 0.15)}`;
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
