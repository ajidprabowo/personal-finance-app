'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { APP_CONFIG } from '@/lib/config';
import type { ThemeMode } from '@/lib/theme';
import { updateUserPreferences } from '@/services/settings.service';

interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  setTheme: (nextTheme: ThemeMode) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function normalizeThemeMode(raw?: string | null): ThemeMode {
  if (raw === 'light' || raw === 'dark' || raw === 'system') {
    return raw;
  }
  return APP_CONFIG.defaultTheme;
}

function resolveSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { installation, preferences, refreshBootstrap } = useBootstrap();
  const installationId = installation?.installationId;
  const [overrideTheme, setOverrideTheme] = useState<ThemeMode | null>(null);
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(false);

  const persistedTheme = normalizeThemeMode(preferences?.themePreference);
  const theme = overrideTheme ?? persistedTheme;

  // Track OS color scheme changes cleanly
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setSystemPrefersDark(mql.matches);
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme;

  // Apply .dark class, pfa_theme_hint cache, and html lang attribute cleanly
  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    root.style.colorScheme = resolvedTheme;
    try {
      window.localStorage.setItem('pfa_theme_hint', theme);
    } catch {
      // Ignore storage access restrictions
    }
  }, [resolvedTheme, theme]);

  useEffect(() => {
    document.documentElement.lang = preferences?.language === 'id' ? 'id' : 'en';
  }, [preferences?.language]);

  const setTheme = useCallback(
    async (nextTheme: ThemeMode) => {
      setOverrideTheme(nextTheme);
      const nextResolved = nextTheme === 'system' ? resolveSystemTheme() : nextTheme;
      document.documentElement.classList.toggle('dark', nextResolved === 'dark');
      document.documentElement.style.colorScheme = nextResolved;
      try {
        window.localStorage.setItem('pfa_theme_hint', nextTheme);
      } catch {
        // Ignore storage access restrictions
      }

      if (installationId) {
        try {
          await updateUserPreferences(installationId, {
            themePreference: nextTheme,
          });
          await refreshBootstrap();
        } finally {
          setOverrideTheme(null);
        }
      }
    },
    [installationId, refreshBootstrap]
  );

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
    }),
    [theme, resolvedTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside ThemeProvider.');
  }
  return ctx;
}
