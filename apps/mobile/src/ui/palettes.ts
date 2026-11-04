/**
 * The three themes' colours (red, black and white), as plain data (no React Native) so the contrast
 * test can check them. theme.ts re-exports these and applies the current one.
 */

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
  /** Red for text, links, icons and the selected tab (4.5:1 on every surface). */
  accent: string;
  accentSoft: string;
  /** Brand red behind filled controls: primary buttons, checked boxes, selected chips. */
  accentFill: string;
  /** Text and icons on accentFill. */
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

/** Black with red: neutral greys (no blue tint), white text. */
const dark: Palette = {
  background: '#0A0A0A',
  surface: '#141414',
  surfaceRaised: '#1A1A1A',
  surfaceHigh: '#242424',
  border: '#262626',
  hairline: 'rgba(255,255,255,0.07)',
  text: '#FAFAFA',
  textMuted: '#A3A3A3',
  textFaint: '#9C9C9C',
  accent: '#FF5C5C',
  accentSoft: 'rgba(220,38,38,0.16)',
  accentFill: '#DC2626',
  accentText: '#FFFFFF',
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
  control: '#737373',
  focus: '#FAFAFA',
};

/** True black for OLED screens, with the same red. */
const midnight: Palette = {
  ...dark,
  background: '#000000',
  surface: '#0D0D0D',
  surfaceRaised: '#141414',
  surfaceHigh: '#1F1F1F',
  border: '#1F1F1F',
  hairline: 'rgba(255,255,255,0.08)',
  control: '#6E6E6E',
};

/** White with red: neutral greys, near-black text. */
const light: Palette = {
  background: '#F5F5F5',
  surface: '#FFFFFF',
  surfaceRaised: '#FAFAFA',
  surfaceHigh: '#E5E5E5',
  border: '#E5E5E5',
  hairline: 'rgba(0,0,0,0.08)',
  text: '#0A0A0A',
  textMuted: '#525252',
  textFaint: '#5C5C5C',
  accent: '#B91C1C',
  accentSoft: 'rgba(220,38,38,0.08)',
  accentFill: '#DC2626',
  accentText: '#FFFFFF',
  athleteA: '#1D4ED8',
  athleteASoft: 'rgba(29,78,216,0.10)',
  athleteB: '#B91C1C',
  athleteBSoft: 'rgba(185,28,28,0.09)',
  success: '#166534',
  successSoft: 'rgba(21,128,61,0.09)',
  warning: '#6B5800',
  warningSoft: 'rgba(161,138,0,0.10)',
  danger: '#B91C1C',
  dangerSoft: 'rgba(185,28,28,0.09)',
  control: '#737373',
  focus: '#0A0A0A',
};

export const PALETTES: Record<ThemeName, Palette> = { dark, midnight, light };
