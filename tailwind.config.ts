import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "rgb(var(--bg-base-rgb) / <alpha-value>)",
        panel: "rgb(var(--bg-panel-rgb) / <alpha-value>)",
        raised: "rgb(var(--bg-raised-rgb) / <alpha-value>)",
        line: "rgb(var(--border-line-rgb) / <alpha-value>)",
        track: "rgb(var(--color-track-rgb) / <alpha-value>)",
        muted: "rgb(var(--text-muted-rgb) / <alpha-value>)",
        foreground: "rgb(var(--text-primary-rgb) / <alpha-value>)",
        primary: "rgb(var(--text-primary-rgb) / <alpha-value>)",
        secondary: "rgb(var(--text-secondary-rgb) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--color-accent-rgb) / <alpha-value>)",
          dim: "var(--color-accent-dim)",
          bg: "rgb(var(--color-accent-bg-rgb) / <alpha-value>)",
          contrast: "rgb(var(--color-accent-contrast-rgb) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
