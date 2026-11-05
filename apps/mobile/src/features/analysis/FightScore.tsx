'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import Ionicons from '@expo/vector-icons/Ionicons';
import { formatClock } from '@matiq/rules-engine';
import { View } from 'react-native';
import { Text } from '@/ui/text';
import { colors, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';
import { CONDENSED } from '@/ui/typography';
import { methodLabel } from './labels';

type Athlete = 'A' | 'B';

interface FightScoreProps {
  names: Record<Athlete, string>;
  points: Record<Athlete, number>;
  winner: Athlete | null;
  method: string;
  /** When the match ended early (finishes, DQ). */
  at?: number;
  /** A line under each score, such as advantages and penalties. */
  notes?: Partial<Record<Athlete, string>>;
  /** 'hero' is the large version at the top of the match screen. */
  size?: 'card' | 'hero';
}

/**
 * The score as a fight card: each fighter's name and points, the winner bright
 * with a red bar and the other side muted, and how it ended in the middle (a
 * red pill, or grey for a draw). Read out as one sentence.
 */
export function FightScore({ names, points, winner, method, at, notes, size = 'card' }: FightScoreProps) {
  useTheme();
  const hero = size === 'hero';
  return (
    <View style={styles.row} accessible accessibilityLabel={scoreLabel(names, points, winner, method, at)}>
      <Side athlete="A" name={names.A} points={points.A} note={notes?.A} winner={winner} hero={hero} />
      <View style={styles.middle}>
        <Text style={styles.vs}>VS</Text>
        <View style={[styles.result, !winner && styles.resultDraw]}>
          {winner ? <Ionicons name="trophy" size={13} color={colors.accentText} aria-hidden /> : null}
          <Text style={[styles.resultText, !winner && styles.muted]} numberOfLines={1}>
            {winner ? methodLabel(method) : 'Draw'}
          </Text>
        </View>
        {at !== undefined ? <Text style={styles.at}>{formatClock(at)}</Text> : null}
      </View>
      <Side athlete="B" name={names.B} points={points.B} note={notes?.B} winner={winner} hero={hero} />
    </View>
  );
}

export function scoreLabel(names: Record<Athlete, string>, points: Record<Athlete, number>, winner: Athlete | null, method: string, at?: number): string {
  const score = `${names.A} ${points.A}, ${names.B} ${points.B}`;
  if (!winner) return `${score}. Draw.`;
  return `${score}. ${names[winner]} wins by ${methodLabel(method).toLowerCase()}${at !== undefined ? ` at ${formatClock(at)}` : ''}.`;
}

function Side({ athlete, name, points, note, winner, hero }: { athlete: Athlete; name: string; points: number; note?: string; winner: Athlete | null; hero: boolean }) {
  useTheme();
  const lost = winner !== null && winner !== athlete;
  return (
    <View style={[styles.side, athlete === 'B' && styles.sideRight]}>
      <Text style={[styles.name, hero && styles.nameHero, lost && styles.muted]} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.points, hero && styles.pointsHero, lost && styles.muted]}>{points}</Text>
      <View style={[styles.winBar, winner !== athlete && styles.winBarHidden]} />
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1, alignItems: 'flex-start' },
  sideRight: { alignItems: 'flex-end' },
  name: { fontFamily: CONDENSED, fontWeight: '700', fontSize: 16, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.text },
  nameHero: { fontSize: 18 },
  points: { fontFamily: CONDENSED, fontWeight: '800', fontSize: 56, lineHeight: 60, color: colors.text, fontVariant: ['tabular-nums'] },
  pointsHero: { fontSize: 80, lineHeight: 84 },
  muted: { color: colors.textMuted },
  winBar: { width: 40, height: 4, borderRadius: 2, marginTop: 4, backgroundColor: colors.accentFill },
  winBarHidden: { backgroundColor: 'transparent' },
  note: { marginTop: 6, fontSize: 13, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  middle: { alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, flexShrink: 1 },
  vs: { fontFamily: CONDENSED, fontWeight: '700', fontSize: 14, letterSpacing: 1, color: colors.textMuted },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.accentFill,
  },
  resultDraw: { backgroundColor: colors.surfaceHigh },
  resultText: { flexShrink: 1, fontFamily: CONDENSED, fontWeight: '700', fontSize: 14, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.accentText },
  at: { fontSize: 13, color: colors.textMuted, fontVariant: ['tabular-nums'] },
}));
