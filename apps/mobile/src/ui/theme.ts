/**
 * Design tokens. Red, black and white: neutral grey surfaces with one red
 * accent for the action that matters on a screen; flat colours, no
 * gradients. `accent` is the red for text and icons, `accentFill` the brand
 * red behind filled controls. Athlete A is blue and B is red, like corner
 * colours.
 *
 * Three themes: Dark (black), Midnight (true black for OLED screens) and
 * Light (white). The person picks one in Settings → Appearance, or follows
 * the phone (ThemeProvider).
 *
 * WCAG 2.2 AA in every theme, checked by palettes.test.ts: each text colour has
 * at least 4.5:1 contrast on every surface (including the tinted badge
 * backgrounds), and `control` (input, switch and checkbox outlines) at least
 * 3:1 against the card it sits on.
 *
 * `colors` and `font` always hold the current theme: they are updated in place
 * when it changes, so anything read while rendering is current. Styles made
 * once per module use `themedStyles`, which rebuilds them for each theme.
 * Components that read either re-render on a change by calling `useTheme()`.
 */

import { type ImageStyle, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { PALETTES, type Palette, type ThemeName } from './palettes';

export { PALETTES, type Palette, THEMES, type ThemeName } from './palettes';

/** For anything drawn over the camera or a video, which is dark whatever the theme. */
export const onVideo: Palette = PALETTES.dark;

/** The current theme's colours (updated in place by `applyTheme`). */
export const colors: Palette = { ...PALETTES.dark };

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
