import type { Mode } from "./types";

export type ModeInfo = {
  id: Mode;
  name: string;
  prepSeconds: number;
  prepLabel: string;
  blurb: string;
};

export const MODES: ModeInfo[] = [
  {
    id: "off-the-cuff",
    name: "Off the Cuff",
    prepSeconds: 60,
    prepLabel: "60s prep",
    blurb: "A minute to gather your thoughts, then two minutes to talk. No notes, no safety net.",
  },
  {
    id: "deep-research",
    name: "Deep Research",
    prepSeconds: 600,
    prepLabel: "10 min prep",
    blurb: "Ten minutes to dig into the details and build a real argument. Then deliver it out loud.",
  },
];

export function modeInfo(mode: Mode): ModeInfo {
  return MODES.find((m) => m.id === mode) ?? MODES[0];
}

export function modeName(mode: Mode): string {
  return modeInfo(mode).name;
}
