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
    blurb: "Organise your thoughts quickly, then deliver your response.",
  },
  {
    id: "deep-research",
    name: "Deep Research",
    prepSeconds: 600,
    prepLabel: "10 min prep",
    blurb: "Explore the topic, develop your ideas and build a considered argument before speaking.",
  },
];

export function modeInfo(mode: Mode): ModeInfo {
  return MODES.find((m) => m.id === mode) ?? MODES[0];
}

export function modeName(mode: Mode): string {
  return modeInfo(mode).name;
}
