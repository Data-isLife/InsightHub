
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "system" | "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  cycleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_STORAGE_KEY = "insighthub-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

    if (
      storedTheme === "system" ||
      storedTheme === "light" ||
      storedTheme === "dark"
    ) {
      setTheme(storedTheme);
    }

    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) return;

    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme, initialized]);

  const cycleTheme = useCallback(() => {
    setTheme((current) => {
      if (current === "system") return "light";
      if (current === "light") return "dark";
      return "system";
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider.");
  }

  return context;
}
