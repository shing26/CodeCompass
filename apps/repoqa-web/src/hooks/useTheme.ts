import { useCallback, useEffect, useState } from 'react';

export type AppTheme = 'clean' | 'cyber';

const STORAGE_KEY = 'codecompass-theme';

function readInitialTheme(): AppTheme {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'clean' || saved === 'cyber') return saved;
  } catch {
    // storage unavailable — fall back to the clean default
  }
  return 'clean';
}

/**
 * Clean / Cyber design-token theme. The chosen theme is applied to
 * `document.documentElement` as `data-theme`, which switches every
 * semantic Tailwind color (`bg-canvas`, `border-line`, `text-ink`, ...).
 */
export function useTheme(): {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
} {
  const [theme, setTheme] = useState<AppTheme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // persistence is best-effort
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'clean' ? 'cyber' : 'clean'));
  }, []);

  return { theme, setTheme, toggleTheme };
}
