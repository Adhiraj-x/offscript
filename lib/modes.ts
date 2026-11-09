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
    name: "Quick Prep",
    prepSeconds: 60,
    prepLabel: "60s prep",
    blurb: "Organise your thoughts quickly, then deliver your response.",
  },
  {
    id: "deep-research",
    name: "Extended Prep",
    prepSeconds: 600,
    prepLabel: "10 min prep",
    blurb: "Take more time to explore the topic, structure your ideas and build a considered response.",
  },
];

export function modeInfo(mode: Mode): ModeInfo {
  return MODES.find((m) => m.id === mode) ?? MODES[0];
}

export function modeName(mode: Mode): string {
  return modeInfo(mode).name;
}
