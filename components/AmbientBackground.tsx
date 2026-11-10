"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";

export type AmbientIntensity = "full" | "subtle" | "minimal";

interface AmbientContextValue {
  intensity: AmbientIntensity;
  setIntensity: (intensity: AmbientIntensity) => void;
}

const AmbientContext = createContext<AmbientContextValue>({
  intensity: "full",
  setIntensity: () => {},
});

export function useAmbient() {
  return useContext(AmbientContext);
}

export function AmbientProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [overrideIntensity, setOverrideIntensity] = useState<AmbientIntensity | null>(null);

  // Clear manual phase override when navigating to another route
  useEffect(() => {
    setOverrideIntensity(null);
  }, [pathname]);

  // Support listening to custom events for ambient intensity outside React tree if needed
  useEffect(() => {
    const handleCustomChange = (e: Event) => {
      const customEvent = e as CustomEvent<AmbientIntensity>;
      if (
        customEvent.detail &&
        (customEvent.detail === "full" ||
          customEvent.detail === "subtle" ||
          customEvent.detail === "minimal")
      ) {
        setOverrideIntensity(customEvent.detail);
      }
    };

    window.addEventListener("ambient-intensity-change", handleCustomChange);
    return () => {
      window.removeEventListener("ambient-intensity-change", handleCustomChange);
    };
  }, []);

  const setIntensity = useCallback((next: AmbientIntensity) => {
    setOverrideIntensity(next);
  }, []);

  const intensity: AmbientIntensity = useMemo(() => {
    if (pathname === "/history") {
      return "subtle";
    }
    if (overrideIntensity) {
      return overrideIntensity;
    }
    return "full";
  }, [overrideIntensity, pathname]);

  const contextValue = useMemo(
    () => ({
      intensity,
      setIntensity,
    }),
    [intensity, setIntensity],
  );

  return (
    <AmbientContext.Provider value={contextValue}>
      {children}
    </AmbientContext.Provider>
  );
}

export type ParticleType = "lime" | "teal" | "sage";

export type Particle = {
  id: number;
  top: string;
  left: string;
  size: number;
  darkSize: number;
  type: ParticleType;
  animationName: string;
  duration: string;
  delay: string;
  isMobile: boolean;
};

// Deterministic particle set: 7 on mobile, 16 on desktop
// Light mode distribution: 2.5-3px (most), 3.5px (some), 4px (accent particles)
// Dark mode distribution: 1.5-3px preserved unchanged
export const PARTICLES: Particle[] = [
  // --- Mobile + Desktop (7 particles) ---
  {
    id: 1,
    top: "12%",
    left: "9%",
    size: 3,
    darkSize: 2.5,
    type: "lime",
    animationName: "particle-drift-1",
    duration: "26s",
    delay: "-4s",
    isMobile: true,
  },
  {
    id: 2,
    top: "18%",
    left: "88%",
    size: 4,
    darkSize: 3,
    type: "lime",
    animationName: "particle-drift-2",
    duration: "22s",
    delay: "-12s",
    isMobile: true,
  },
  {
    id: 3,
    top: "38%",
    left: "5%",
    size: 2.5,
    darkSize: 2,
    type: "teal",
    animationName: "particle-drift-3",
    duration: "34s",
    delay: "-8s",
    isMobile: true,
  },
  {
    id: 4,
    top: "44%",
    left: "94%",
    size: 3.5,
    darkSize: 2,
    type: "sage",
    animationName: "particle-drift-4",
    duration: "30s",
    delay: "-16s",
    isMobile: true,
  },
  {
    id: 5,
    top: "66%",
    left: "11%",
    size: 3,
    darkSize: 2.5,
    type: "lime",
    animationName: "particle-drift-1",
    duration: "28s",
    delay: "-5s",
    isMobile: true,
  },
  {
    id: 6,
    top: "72%",
    left: "86%",
    size: 2.5,
    darkSize: 2,
    type: "teal",
    animationName: "particle-drift-2",
    duration: "36s",
    delay: "-14s",
    isMobile: true,
  },
  {
    id: 7,
    top: "92%",
    left: "48%",
    size: 3.5,
    darkSize: 2.5,
    type: "lime",
    animationName: "particle-drift-3",
    duration: "25s",
    delay: "-19s",
    isMobile: true,
  },

  // --- Desktop Only (9 particles, total 16 on desktop) ---
  {
    id: 8,
    top: "7%",
    left: "28%",
    size: 2.5,
    darkSize: 1.5,
    type: "sage",
    animationName: "particle-drift-4",
    duration: "38s",
    delay: "-7s",
    isMobile: false,
  },
  {
    id: 9,
    top: "10%",
    left: "72%",
    size: 3.5,
    darkSize: 2,
    type: "teal",
    animationName: "particle-drift-2",
    duration: "32s",
    delay: "-15s",
    isMobile: false,
  },
  {
    id: 10,
    top: "26%",
    left: "18%",
    size: 2.5,
    darkSize: 1.5,
    type: "lime",
    animationName: "particle-drift-1",
    duration: "40s",
    delay: "-22s",
    isMobile: false,
  },
  {
    id: 11,
    top: "32%",
    left: "82%",
    size: 4,
    darkSize: 2.5,
    type: "sage",
    animationName: "particle-drift-3",
    duration: "29s",
    delay: "-3s",
    isMobile: false,
  },
  {
    id: 12,
    top: "54%",
    left: "7%",
    size: 3,
    darkSize: 2,
    type: "lime",
    animationName: "particle-drift-4",
    duration: "35s",
    delay: "-11s",
    isMobile: false,
  },
  {
    id: 13,
    top: "58%",
    left: "91%",
    size: 2.5,
    darkSize: 1.5,
    type: "teal",
    animationName: "particle-drift-1",
    duration: "42s",
    delay: "-24s",
    isMobile: false,
  },
  {
    id: 14,
    top: "80%",
    left: "22%",
    size: 3,
    darkSize: 2,
    type: "sage",
    animationName: "particle-drift-3",
    duration: "33s",
    delay: "-17s",
    isMobile: false,
  },
  {
    id: 15,
    top: "84%",
    left: "76%",
    size: 3.5,
    darkSize: 2,
    type: "lime",
    animationName: "particle-drift-2",
    duration: "27s",
    delay: "-9s",
    isMobile: false,
  },
  {
    id: 16,
    top: "95%",
    left: "86%",
    size: 2.5,
    darkSize: 1.5,
    type: "teal",
    animationName: "particle-drift-4",
    duration: "39s",
    delay: "-21s",
    isMobile: false,
  },
];

export default function AmbientBackground({
  intensity: propIntensity,
  className = "",
}: {
  intensity?: AmbientIntensity;
  className?: string;
} = {}) {
  const context = useContext(AmbientContext);
  const activeIntensity = propIntensity ?? context?.intensity ?? "full";
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsPaused(document.hidden);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return (
    <div
      className={`ambient-container fixed inset-0 pointer-events-none overflow-hidden z-0 select-none ${className}`}
      aria-hidden="true"
      data-paused={isPaused ? "true" : undefined}
      data-intensity={activeIntensity}
    >
      {/* Layer A: Ambient Aura Radial Light Fields */}
      {/* Aura 1: Upper-left diffuse sage-green / lime glow behind hero & header */}
      <div
        className="ambient-aura-layer absolute -top-[14%] -left-[16%] w-[420px] h-[420px] sm:w-[720px] sm:h-[720px] rounded-full pointer-events-none"
        style={{
          background: "var(--ambient-aura-1)",
          animation: "ambient-aura-1 32s ease-in-out infinite",
          willChange: "transform",
        }}
      />

      {/* Aura 2: Lower-right subtle muted teal glow */}
      <div
        className="ambient-aura-layer absolute top-[44%] -right-[14%] sm:-right-[8%] w-[400px] h-[400px] sm:w-[680px] sm:h-[680px] rounded-full pointer-events-none"
        style={{
          background: "var(--ambient-aura-2)",
          animation: "ambient-aura-2 36s ease-in-out infinite",
          willChange: "transform",
        }}
      />

      {/* Aura 3: Hero region restrained olive illumination */}
      <div
        className="ambient-aura-layer absolute top-[12%] sm:top-[10%] left-[10%] sm:left-[26%] w-[380px] h-[380px] sm:w-[620px] sm:h-[620px] rounded-full pointer-events-none opacity-80 sm:opacity-100"
        style={{
          background: "var(--ambient-aura-3)",
          animation: "ambient-aura-3 42s ease-in-out infinite",
          willChange: "transform",
        }}
      />

      {/* Layer B & C: Floating Particles with Spatial Depth */}
      {PARTICLES.map((p) => (
        <span
          key={p.id}
          className={`ambient-particle-item ambient-particle-${p.type} ${p.animationName} absolute rounded-full ${
            p.isMobile ? "block" : "hidden sm:block"
          }`}
          style={
            {
              top: p.top,
              left: p.left,
              ["--p-size-light" as string]: `${p.size}px`,
              ["--p-size-dark" as string]: `${p.darkSize}px`,
              animationDuration: p.duration,
              animationDelay: p.delay,
              animationTimingFunction: "ease-in-out",
              animationIterationCount: "infinite",
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
