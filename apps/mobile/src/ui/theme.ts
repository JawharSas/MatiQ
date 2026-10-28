/**
 * Design tokens. Deep, borderless surfaces with the orange accent kept for the
 * one action that matters on a screen. Athlete A is blue and B is red, like
 * corner colours.
 */
export const colors = {
  background: '#07090C',
  surface: '#11151B',
  surfaceRaised: '#191E26',
  surfaceHigh: '#252C37',
  border: '#232A35',
  hairline: 'rgba(255,255,255,0.06)',
  text: '#F5F7FA',
  textMuted: '#8D97A8',
  textFaint: '#5D6676',
  accent: '#F97316',
  accentSoft: 'rgba(249,115,22,0.14)',
  accentText: '#0B0D10',
  athleteA: '#3B82F6',
  athleteASoft: 'rgba(59,130,246,0.14)',
  athleteB: '#EF4444',
  athleteBSoft: 'rgba(239,68,68,0.14)',
  success: '#22C55E',
  successSoft: 'rgba(34,197,94,0.14)',
  warning: '#EAB308',
  warningSoft: 'rgba(234,179,8,0.14)',
  danger: '#EF4444',
  dangerSoft: 'rgba(239,68,68,0.12)',
} as const;

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

export function athleteColor(athlete: 'A' | 'B' | null | undefined): string {
  if (athlete === 'A') return colors.athleteA;
  if (athlete === 'B') return colors.athleteB;
  return colors.textMuted;
}
