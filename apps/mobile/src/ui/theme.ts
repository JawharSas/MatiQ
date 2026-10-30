/**
 * Design tokens. Deep, borderless surfaces with the orange accent kept for the
 * one action that matters on a screen. Athlete A is blue and B is red, like
 * corner colours.
 *
 * Three themes: Dark (MatIQ's original look), Midnight (true black for OLED
 * screens, navy-tinted surfaces) and Light. The person picks one in Settings
 * → Appearance, or follows the phone (ThemeProvider).
 *
 * WCAG 2.2 AA in every theme: each text colour has at least 4.5:1 contrast on
 * every surface (including the tinted badge backgrounds), and `control`
 * (input, switch and checkbox outlines) at least 3:1 against the card it sits on.
 *
 * `colors` and `font` always hold the current theme: they are updated in place
 * when it changes, so anything read while rendering is current. Styles made
 * once per module use `themedStyles`, which rebuilds them for each theme.
 * Components that read either re-render on a change by calling `useTheme()`.
 */

import { type ImageStyle, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

export const THEMES = ['dark', 'midnight', 'light'] as const;
export type ThemeName = (typeof THEMES)[number];

export interface Palette {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceHigh: string;
  border: string;
  hairline: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  athleteA: string;
  athleteASoft: string;
  athleteB: string;
  athleteBSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  /** Outline of inputs, switches and checkboxes (3:1 against cards). */
  control: string;
  /** Keyboard focus ring. */
  focus: string;
}

const dark: Palette = {
  background: '#07090C',
  surface: '#11151B',
  surfaceRaised: '#191E26',
  surfaceHigh: '#252C37',
  border: '#232A35',
  hairline: 'rgba(255,255,255,0.06)',
  text: '#F5F7FA',
  textMuted: '#8D97A8',
  textFaint: '#8A93A2',
  accent: '#F97316',
  accentSoft: 'rgba(249,115,22,0.14)',
  accentText: '#0B0D10',
  athleteA: '#60A5FA',
  athleteASoft: 'rgba(59,130,246,0.14)',
  athleteB: '#F87171',
  athleteBSoft: 'rgba(239,68,68,0.14)',
  success: '#22C55E',
  successSoft: 'rgba(34,197,94,0.14)',
  warning: '#EAB308',
  warningSoft: 'rgba(234,179,8,0.14)',
  danger: '#F87171',
  dangerSoft: 'rgba(239,68,68,0.12)',
  control: '#6B7280',
  focus: '#F5F7FA',
};

const midnight: Palette = {
  ...dark,
  background: '#000000',
  surface: '#0A0E17',
  surfaceRaised: '#111726',
  surfaceHigh: '#1A2233',
  border: '#1A2233',
  hairline: 'rgba(148,163,184,0.10)',
  textMuted: '#8E9AB2',
  textFaint: '#8894AC',
  control: '#6B7590',
};

const light: Palette = {
  background: '#F3F5F8',
  surface: '#FFFFFF',
  surfaceRaised: '#F5F7FA',
  surfaceHigh: '#E5E9F0',
  border: '#DCE1E8',
  hairline: 'rgba(15,23,42,0.08)',
  text: '#0F172A',
  textMuted: '#4A5568',
  textFaint: '#535E70',
  accent: '#A9380A',
  accentSoft: 'rgba(194,65,12,0.09)',
  accentText: '#FFFFFF',
  athleteA: '#1D4ED8',
  athleteASoft: 'rgba(29,78,216,0.10)',
  athleteB: '#B91C1C',
  athleteBSoft: 'rgba(185,28,28,0.09)',
  success: '#166534',
  successSoft: 'rgba(21,128,61,0.09)',
  warning: '#7C4A03',
  warningSoft: 'rgba(161,98,7,0.10)',
  danger: '#B91C1C',
  dangerSoft: 'rgba(185,28,28,0.09)',
  control: '#6B7280',
  focus: '#0F172A',
};

export const PALETTES: Record<ThemeName, Palette> = { dark, midnight, light };

/** For anything drawn over the camera or a video, which is dark whatever the theme. */
export const onVideo: Palette = dark;

/** The current theme's colours (updated in place by `applyTheme`). */
export const colors: Palette = { ...dark };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

export const font = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800' as const, letterSpacing: -0.8, color: colors.text },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '800' as const, letterSpacing: -0.4, color: colors.text },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, lineHeight: 22, color: colors.text },
  caption: { fontSize: 13, lineHeight: 18, color: colors.textMuted },
  /** Small uppercase section label. */
  overline: { fontSize: 12, lineHeight: 16, fontWeight: '700' as const, letterSpacing: 0.9, color: colors.textFaint },
  mono: { fontSize: 13, color: colors.textMuted, fontVariant: ['tabular-nums' as const] },
};

let current: ThemeName = 'dark';

export function currentTheme(): ThemeName {
  return current;
}

/** True for the themes drawn light-on-dark (status bar, keyboard). */
export function isDarkTheme(name: ThemeName = current): boolean {
  return name !== 'light';
}

/** Switches `colors` and `font` to a theme. ThemeProvider calls it; components re-render through `useTheme()`. */
export function applyTheme(name: ThemeName): void {
  if (name === current) return;
  Object.assign(colors, PALETTES[name]);
  font.display.color = colors.text;
  font.title.color = colors.text;
  font.heading.color = colors.text;
  font.body.color = colors.text;
  font.caption.color = colors.textMuted;
  font.overline.color = colors.textFaint;
  font.mono.color = colors.textMuted;
  current = name;
}

/**
 * A module's style sheet, made from the current theme when first read and
 * again after the theme changes. Use it like `StyleSheet.create`, with the
 * styles written inside a function: `themedStyles(() => ({ ... }))`.
 */
export function themedStyles<T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(factory: () => T): T {
  const sheets = new Map<ThemeName, T>();
  const sheet = (): T => {
    const made = sheets.get(current);
    if (made) return made;
    const created = StyleSheet.create(factory()) as T;
    sheets.set(current, created);
    return created;
  };
  return new Proxy({} as T, {
    get: (_target, key) => sheet()[key as keyof T],
    has: (_target, key) => key in sheet(),
    ownKeys: () => Reflect.ownKeys(sheet()),
    getOwnPropertyDescriptor: (_target, key) => ({ ...Reflect.getOwnPropertyDescriptor(sheet(), key), configurable: true }),
  });
}

export function athleteColor(athlete: 'A' | 'B' | null | undefined): string {
  if (athlete === 'A') return colors.athleteA;
  if (athlete === 'B') return colors.athleteB;
  return colors.textMuted;
}
