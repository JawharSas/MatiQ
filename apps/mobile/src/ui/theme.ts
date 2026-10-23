/** Design tokens. Athlete A is blue and B is red, like corner colours. */
export const colors = {
  background: '#0B0D10',
  surface: '#151922',
  surfaceRaised: '#1D2330',
  border: '#2A3140',
  text: '#F4F6FA',
  textMuted: '#9AA4B5',
  accent: '#F97316',
  accentText: '#0B0D10',
  athleteA: '#3B82F6',
  athleteB: '#EF4444',
  success: '#22C55E',
  warning: '#EAB308',
  danger: '#EF4444',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const font = {
  title: { fontSize: 24, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 18, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  caption: { fontSize: 13, color: colors.textMuted },
  mono: { fontSize: 13, color: colors.textMuted, fontVariant: ['tabular-nums' as const] },
};

export function athleteColor(athlete: 'A' | 'B' | null | undefined): string {
  if (athlete === 'A') return colors.athleteA;
  if (athlete === 'B') return colors.athleteB;
  return colors.textMuted;
}
