"use client";

import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { modeName } from "@/lib/modes";
import type { Mode } from "@/lib/types";

const CARD_SIZE = 1080;

type Props = {
  topic: string;
  mode: Mode;
  overallScore: number;
  contentScore: number;
  deliveryScore: number;
  wpm: number;
};

function CardStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[20px] uppercase tracking-[0.28em] text-white/40">{label}</p>
      <p className="mt-3 text-[40px] font-medium tracking-tight text-white">{value}</p>
    </div>
  );
}

export default function ShareCard({
  topic,
  mode,
  overallScore,
  contentScore,
  deliveryScore,
  wpm,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    const node = cardRef.current;
    if (!node || busy) return;
    setBusy(true);
    setError("");
    try {
      const dataUrl = await toPng(node, {
        width: CARD_SIZE,
        height: CARD_SIZE,
        pixelRatio: 1,
        backgroundColor: "#08090b",
        cacheBust: true,
      });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `offscript-${overallScore}-${Date.now().toString(36)}.png`;
      link.click();
    } catch {
      setError("Couldn't build the image. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="inline-flex h-10 items-center justify-center rounded-full border border-line bg-raised/70 px-5 text-sm font-medium text-foreground transition-all hover:border-foreground/30 hover:bg-raised hover:text-foreground active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base disabled:cursor-wait disabled:opacity-50"
      >
        {busy ? "Rendering…" : "Share result"}
      </button>
      {error ? <p className="mt-2 text-xs text-red-500 dark:text-red-300">{error}</p> : null}

      {/* Off-screen 1080x1080 card captured by html-to-image. */}
      <div
        aria-hidden
        style={{ position: "fixed", top: 0, left: "-20000px", pointerEvents: "none" }}
      >
        <div
          ref={cardRef}
          style={{ width: CARD_SIZE, height: CARD_SIZE, backgroundColor: "#08090b" }}
          className="flex flex-col justify-between overflow-hidden p-24 text-white"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="h-3 w-3 rounded-full bg-accent" />
              <span className="text-[32px] font-semibold tracking-tight">Offscript</span>
            </div>
            <span className="rounded-full border border-white/15 px-6 py-2 text-[18px] text-white/60">
              {modeName(mode)}
            </span>
          </div>

          <div>
            <p className="text-[20px] uppercase tracking-[0.32em] text-accent">Topic</p>
            <p className="mt-7 max-w-[860px] text-[46px] font-medium leading-[1.18] tracking-tight">
              {topic}
            </p>
          </div>

          <div>
            <div className="flex items-end gap-8">
              <span className="text-[190px] font-semibold leading-[0.8] tracking-tighter text-accent">
                {overallScore}
              </span>
              <span className="pb-4 text-[22px] uppercase tracking-[0.3em] text-white/45">
                Overall
              </span>
            </div>
            <div className="mt-12 grid grid-cols-3 gap-8 border-t border-white/10 pt-10">
              <CardStat label="Content" value={`${contentScore}`} />
              <CardStat label="Delivery" value={`${deliveryScore}`} />
              <CardStat label="Pace" value={`${wpm} WPM`} />
            </div>
          </div>

          <p className="text-[18px] text-white/25">practice thinking out loud</p>
        </div>
      </div>
    </div>
  );
}
