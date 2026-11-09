"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

export type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  isDark: boolean;
  isLight: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const THEME_STORAGE_KEY = "offscript_theme_v1";

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  isDark: true,
  isLight: false,
  setTheme: () => {},
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function applyThemeToDocument(nextTheme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (nextTheme === "light") {
    root.classList.add("light");
    root.setAttribute("data-theme", "light");
    root.style.colorScheme = "light";
  } else {
    root.classList.remove("light");
    root.setAttribute("data-theme", "dark");
    root.style.colorScheme = "dark";
  }
}

/**
 * Runs a theme switch with the View Transitions API when available and not reduced-motion.
 * Falls back gracefully to standard synchronous DOM and state updates.
 */
export function runThemeTransition(updateFn: () => void) {
  if (
    typeof document !== "undefined" &&
    "startViewTransition" in document &&
    typeof (document as { startViewTransition?: unknown }).startViewTransition === "function" &&
    typeof window !== "undefined" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    try {
      document.startViewTransition(() => {
        flushSync(updateFn);
      });
      return;
    } catch {
      // Graceful fallback if startViewTransition throws unexpectedly
    }
  }
  updateFn();
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const themeRef = useRef<Theme>("dark");

  useEffect(() => {
    try {
      const q =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("theme")
          : null;
      const stored =
        q === "light" || q === "dark"
          ? q
          : localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "light" || stored === "dark") {
        setThemeState(stored);
        themeRef.current = stored;
        applyThemeToDocument(stored);
      } else {
        // Strict requirement: Fresh visit defaults to dark; do not switch to OS light theme
        setThemeState("dark");
        themeRef.current = "dark";
        applyThemeToDocument("dark");
      }
    } catch {
      // Safe no-op in private browsing / sandboxed storage
    }
  }, []);

  const setTheme = useCallback((next: Theme) => {
    if (themeRef.current === next) return;
    themeRef.current = next;

    runThemeTransition(() => {
      setThemeState(next);
      applyThemeToDocument(next);
    });

    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Safe no-op
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = themeRef.current === "dark" ? "light" : "dark";
    setTheme(next);
  }, [setTheme]);

  const value = useMemo(
    () => ({
      theme,
      isDark: theme === "dark",
      isLight: theme === "light",
      setTheme,
      toggleTheme,
    }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
