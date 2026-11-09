"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

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

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "light" || stored === "dark") {
        setThemeState(stored);
        applyThemeToDocument(stored);
      } else {
        // Strict requirement: Fresh visit defaults to dark; do not switch to OS light theme
        setThemeState("dark");
        applyThemeToDocument("dark");
      }
    } catch {
      // Safe no-op in private browsing / sandboxed storage
    }
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyThemeToDocument(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Safe no-op
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      applyThemeToDocument(next);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Safe no-op
      }
      return next;
    });
  }, []);

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
