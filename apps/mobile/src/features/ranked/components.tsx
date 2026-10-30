'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { type Discipline, type TierId, tierFor, titleById } from '@matiq/rules-engine';
import { View } from 'react-native';
import { Text } from '@/ui/text';
import { Caption, Card, Heading } from '@/ui/components';
import { colors, font, radius, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';
import { useRatings, useTitles } from './api';

export const DISCIPLINE_LABELS: Record<Discipline, string> = { bjj: 'BJJ', wrestling: 'Wrestling', mma: 'MMA' };

export const DISCIPLINE_OPTIONS = [
  { value: 'bjj', label: 'BJJ' },
  { value: 'wrestling', label: 'Wrestling' },
  { value: 'mma', label: 'MMA' },
] as const;

/** Belt colour per tier (White, Blue, Purple, Brown, Black). */
const BELT_COLORS: Record<TierId, { fill: string; text: string }> = {
  bronze: { fill: '#E5E7EB', text: '#111827' },
  silver: { fill: '#2563EB', text: '#FFFFFF' },
  gold: { fill: '#7C3AED', text: '#FFFFFF' },
  platinum: { fill: '#7C4A1E', text: '#FFFFFF' },
  grandmaster: { fill: '#0B0B0B', text: '#F97316' },
};

export function TierBadge({ rating, games, compact = false }: { rating: number; games: number; compact?: boolean }) {
  useTheme();
  const standing = tierFor(rating, games);
  const palette = BELT_COLORS[standing.tier];
  const text = standing.placement ? `Placement ${5 - standing.placementRemaining}/5` : compact ? standing.label : `${standing.label} · ${standing.belt}`;
  return (
    <View
      style={[styles.badge, { backgroundColor: palette.fill }, standing.tier === 'grandmaster' && styles.grandmasterBorder]}
      accessibilityLabel={`${standing.label}, ${standing.belt}${standing.placement ? ', in placement' : ''}`}
    >
      <Text style={[styles.badgeText, { color: palette.text }]}>{text}</Text>
    </View>
  );
}

export function ProgressBar({ label, value, color = colors.accent }: { label: string; value: number; color?: string }) {
  useTheme();
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100), text: `${Math.round(clamped * 100)}%` }}
    >
      <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

export function TitleChip({ titleId, featured = false }: { titleId: string; featured?: boolean }) {
  useTheme();
  const title = titleById(titleId);
  if (!title) return null;
  return (
    <View style={[styles.chip, featured && styles.chipFeatured]}>
      <Text style={[styles.chipText, featured && { color: colors.accentText }]}>{featured ? '★ ' : ''}{title.name}</Text>
    </View>
  );
}

/** Ratings per discipline and titles, for profile screens. RLS hides them when not visible. */
export function RankedSummary({ userId, emptyText }: { userId: string; emptyText?: string }) {
  useTheme();
  const ratings = useRatings(userId);
  const titles = useTitles(userId);
  const played = (ratings.data ?? []).filter((row) => row.games > 0);
  const featured = titles.data?.find((title) => title.is_featured);

  if (played.length === 0 && (titles.data?.length ?? 0) === 0) {
    return emptyText ? (
      <Card>
        <Heading>Ranked</Heading>
        <Caption>{emptyText}</Caption>
      </Card>
    ) : null;
  }

  return (
    <Card>
      <Heading>Ranked</Heading>
      {featured ? <TitleChip titleId={featured.title_id} featured /> : null}
      {played.map((row) => (
        <View key={row.discipline} style={styles.ratingRow}>
          <Text style={[font.body, styles.discipline]}>{DISCIPLINE_LABELS[row.discipline]}</Text>
          <TierBadge rating={row.rating} games={row.games} compact />
          <Text style={[font.body, styles.rating]}>{row.rating}</Text>
          <Caption>
            {row.wins}-{row.losses}-{row.draws}
          </Caption>
        </View>
      ))}
      {(titles.data?.length ?? 0) > 0 ? (
        <View style={styles.chips}>
          {titles.data!.filter((title) => !title.is_featured).map((title) => (
            <TitleChip key={title.title_id} titleId={title.title_id} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = themedStyles(() => ({
  badge: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  grandmasterBorder: { borderWidth: 1, borderColor: colors.accent },
  badgeText: { fontSize: 12, fontWeight: '800' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  chip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  chipFeatured: { backgroundColor: colors.accent, borderColor: colors.accent, alignSelf: 'flex-start' },
  chipText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  discipline: { width: 84, fontWeight: '700' },
  rating: { fontWeight: '800', fontVariant: ['tabular-nums'], marginLeft: 'auto' },
}));
