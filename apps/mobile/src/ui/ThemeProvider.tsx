/**
 * The app's theme: Light, Dark or Midnight, or System (the default), which
 * follows the phone's light or dark setting. Stored on this device only, like
 * the accessibility settings.
 */

import * as SystemUI from 'expo-system-ui';
import { createContext, type ReactNode, use, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { readPreference, writePreference } from '@/lib/storage';
import { applyTheme, colors, currentTheme, THEMES, type ThemeName } from './theme';

export const THEME_PREFERENCES = ['system', ...THEMES] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export interface ThemeState {
  /** What the person chose. */
  preference: ThemePreference;
  /** The theme in use. */
  theme: ThemeName;
  setPreference(preference: ThemePreference): void;
}

const ThemeContext = createContext<ThemeState>({ preference: 'system', theme: 'dark', setPreference: () => undefined });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>(() => readPreference('theme', THEME_PREFERENCES, 'system'));
  const theme: ThemeName = preference === 'system' ? (scheme === 'light' ? 'light' : 'dark') : preference;

  // Before anything below renders, so every colour it reads is this theme's.
  if (currentTheme() !== theme) applyTheme(theme);

  useEffect(() => {
    // The window behind the app (seen while screens slide and the keyboard opens).
    void SystemUI.setBackgroundColorAsync(colors.background).catch(() => undefined);
  }, [theme]);

  const value = useMemo<ThemeState>(
    () => ({
      preference,
      theme,
      setPreference: (next) => {
        writePreference('theme', next);
        setPreference(next);
      },
    }),
    [preference, theme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

/**
 * The theme. Components that read `colors`, `font` or themed styles call it
 * so they re-render when the theme changes.
 */
export function useTheme(): ThemeState {
  return use(ThemeContext);
}
