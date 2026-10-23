import { formatClock, type Highlight, type Phase, type Scorecard } from '@matiq/rules-engine';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Caption, Card, Heading } from '@/ui/components';
import { athleteColor, colors, font, radius, spacing } from '@/ui/theme';
import { statRows } from './stat-rows';
import type { MatchDetail } from './useMatch';

const METHOD_LABELS: Record<string, string> = {
  submission: 'Submission',
  fall: 'Fall',
  ko_tko: 'KO / TKO',
  technical_superiority: 'Technical superiority',
  points: 'Points',
  advantages: 'Advantages',
  penalties: 'Penalties',
  criteria: 'Criteria',
  decision: 'Projected decision',
  disqualification: 'Disqualification',
  draw: 'Draw',
};

export function MatchDashboard({ match, videoUrl }: { match: MatchDetail; videoUrl: string | null | undefined }) {
  const scorecard = match.analysis?.scorecard;
  const player = useVideoPlayer(videoUrl ?? null, (instance) => {
    instance.loop = false;
  });
  if (!scorecard) return null;

  const names = { A: match.athlete_a_label, B: match.athlete_b_label };
  const seek = (ms: number) => {
    if (!videoUrl) return;
    player.currentTime = ms / 1000;
    player.play();
  };

  return (
    <View style={styles.stack}>
      {videoUrl ? <VideoView player={player} style={styles.video} contentFit="contain" nativeControls /> : null}
      <ScoreHeader scorecard={scorecard} names={names} />
      <PhaseTimeline phases={scorecard.phases} highlights={scorecard.highlights} durationMs={scorecard.durationMs} onSeek={seek} />
      <HighlightList highlights={scorecard.highlights} names={names} onSeek={videoUrl ? seek : undefined} />
      {scorecard.rounds ? <RoundsTable scorecard={scorecard} names={names} /> : null}
      <StatsPanel scorecard={scorecard} names={names} />
      {match.analysis?.coaching_summary ? (
        <Card>
          <Heading>Coach's notes</Heading>
          <Body>{match.analysis.coaching_summary}</Body>
        </Card>
      ) : null}
      <ScoreLog scorecard={scorecard} names={names} onSeek={videoUrl ? seek : undefined} />
      {scorecard.warnings.length > 0 ? (
        <Card>
          <Heading>About this analysis</Heading>
          {scorecard.warnings.map((warning) => (
            <Caption key={warning}>• {warning}</Caption>
          ))}
          <Caption>
            Ruleset {scorecard.rulesetVersion} ({scorecard.variant}). AI-detected events can be wrong; treat scores as a training aid.
          </Caption>
        </Card>
      ) : null}
    </View>
  );
}

type Names = { A: string; B: string };

function ScoreHeader({ scorecard, names }: { scorecard: Scorecard; names: Names }) {
  const { result, totals } = scorecard;
  const winner = result.winner ? names[result.winner] : null;
  return (
    <Card>
      <Caption>{METHOD_LABELS[result.method] ?? result.method}{result.at !== undefined ? ` · ${formatClock(result.at)}` : ''}</Caption>
      <Text style={font.title}>{winner ? `${winner} wins` : 'Draw'}</Text>
      <View style={styles.scoreRow}>
        {(['A', 'B'] as const).map((athlete) => (
          <View key={athlete} style={styles.scoreCell}>
            <Text style={[styles.athleteName, { color: athleteColor(athlete) }]} numberOfLines={1}>
              {names[athlete]}
            </Text>
            <Text style={styles.points}>{totals[athlete].points}</Text>
            {scorecard.discipline === 'bjj' ? (
              <Caption>
                Adv {totals[athlete].advantages} · Pen {totals[athlete].penalties}
              </Caption>
            ) : (
              <Caption>Penalties {totals[athlete].penalties}</Caption>
            )}
          </View>
        ))}
      </View>
    </Card>
  );
}

function PhaseTimeline({
  phases,
  highlights,
  durationMs,
  onSeek,
}: {
  phases: Phase[];
  highlights: Highlight[];
  durationMs: number;
  onSeek: (ms: number) => void;
}) {
  if (durationMs <= 0) return null;
  return (
    <Card>
      <Heading>Timeline</Heading>
      <View style={styles.timeline} accessibilityLabel="Match phases timeline">
        {phases.map((phase) => (
          <View
            key={`${phase.start}-${phase.kind}`}
            style={[
              styles.phase,
              {
                left: `${(phase.start / durationMs) * 100}%`,
                width: `${Math.max(0.5, ((phase.end - phase.start) / durationMs) * 100)}%`,
                backgroundColor: phase.dominant ? athleteColor(phase.dominant) : colors.border,
              },
            ]}
          />
        ))}
        {highlights.map((highlight) => (
          <Pressable
            key={`marker-${highlight.t}`}
            accessibilityRole="button"
            accessibilityLabel={`${highlight.label} at ${formatClock(highlight.t)}`}
            onPress={() => onSeek(highlight.start)}
            hitSlop={12}
            style={[styles.marker, { left: `${(highlight.t / durationMs) * 100}%` }]}
          />
        ))}
      </View>
      <View style={styles.timelineLabels}>
        <Caption>0:00</Caption>
        <Caption>{formatClock(durationMs)}</Caption>
      </View>
      <View style={styles.legend}>
        {phases.slice(0, 6).map((phase) => (
          <Caption key={`legend-${phase.start}`}>
            {formatClock(phase.start)} {phase.label}
          </Caption>
        ))}
      </View>
    </Card>
  );
}

function HighlightList({ highlights, names, onSeek }: { highlights: Highlight[]; names: Names; onSeek?: (ms: number) => void }) {
  if (highlights.length === 0) return null;
  return (
    <Card>
      <Heading>Highlights</Heading>
      {highlights.map((highlight) => (
        <Pressable
          key={`highlight-${highlight.t}`}
          disabled={!onSeek}
          onPress={() => onSeek?.(highlight.start)}
          accessibilityRole={onSeek ? 'button' : 'text'}
          style={styles.listRow}
        >
          <Text style={font.mono}>{formatClock(highlight.t)}</Text>
          <Text style={[font.body, styles.fill]}>
            {highlight.athlete ? <Text style={{ color: athleteColor(highlight.athlete) }}>{names[highlight.athlete]} </Text> : null}
            {highlight.label}
          </Text>
        </Pressable>
      ))}
    </Card>
  );
}

function StatsPanel({ scorecard, names }: { scorecard: Scorecard; names: Names }) {
  return (
    <Card>
      <View style={styles.statHeader}>
        <Text style={[font.caption, { color: colors.athleteA }]}>{names.A}</Text>
        <Heading>Stats</Heading>
        <Text style={[font.caption, { color: colors.athleteB }]}>{names.B}</Text>
      </View>
      {statRows(scorecard).map((stat) => (
        <View key={stat.label} style={styles.statRow}>
          <View style={styles.statValues}>
            <Text style={[font.body, styles.statA]}>{stat.a}</Text>
            <Caption>{stat.label}</Caption>
            <Text style={[font.body, styles.statB]}>{stat.b}</Text>
          </View>
          <View style={styles.bar}>
            <View style={[styles.barA, { flex: Math.max(0.001, stat.share) }]} />
            <View style={[styles.barB, { flex: Math.max(0.001, 1 - stat.share) }]} />
          </View>
        </View>
      ))}
    </Card>
  );
}

function RoundsTable({ scorecard, names }: { scorecard: Scorecard; names: Names }) {
  return (
    <Card>
      <Heading>Rounds (projected)</Heading>
      {scorecard.rounds?.map((round) => (
        <View key={round.round} style={styles.roundRow}>
          <Text style={font.body}>R{round.round}</Text>
          <Text style={[font.body, { color: colors.athleteA }]}>{round.scores.A}</Text>
          <Text style={font.caption}>–</Text>
          <Text style={[font.body, { color: colors.athleteB }]}>{round.scores.B}</Text>
          <Caption>{round.rationale}</Caption>
        </View>
      ))}
      <Caption>
        {names.A} {scorecard.totals.A.points} – {scorecard.totals.B.points} {names.B}
      </Caption>
    </Card>
  );
}

function ScoreLog({ scorecard, names, onSeek }: { scorecard: Scorecard; names: Names; onSeek?: (ms: number) => void }) {
  const lines = scorecard.scoreLog.filter((line) => scorecard.discipline !== 'mma' || line.penalties > 0);
  if (lines.length === 0) return null;
  return (
    <Card>
      <Heading>Scoring log</Heading>
      {lines.map((line, index) => (
        <Pressable
          key={`${line.t}-${index}`}
          disabled={!onSeek}
          onPress={() => onSeek?.(Math.max(0, line.t - 5000))}
          style={styles.listRow}
        >
          <Text style={font.mono}>{formatClock(line.t)}</Text>
          <Text style={[font.body, styles.fill, { color: athleteColor(line.athlete) }]}>{names[line.athlete]}</Text>
          <Text style={font.caption}>{line.label}</Text>
        </Pressable>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  fill: { flex: 1 },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.lg, backgroundColor: '#000' },
  scoreRow: { flexDirection: 'row', gap: spacing.lg },
  scoreCell: { flex: 1, gap: spacing.xs },
  athleteName: { fontSize: 15, fontWeight: '700' },
  points: { fontSize: 44, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  timeline: { height: 28, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  phase: { position: 'absolute', top: 6, bottom: 6, opacity: 0.85 },
  marker: { position: 'absolute', top: 0, bottom: 0, width: 3, marginLeft: -1, backgroundColor: colors.accent },
  timelineLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  legend: { gap: 2 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 36 },
  statHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statRow: { gap: spacing.xs },
  statValues: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statA: { color: colors.athleteA, fontWeight: '700', minWidth: 48 },
  statB: { color: colors.athleteB, fontWeight: '700', minWidth: 48, textAlign: 'right' },
  bar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', gap: 2 },
  barA: { backgroundColor: colors.athleteA },
  barB: { backgroundColor: colors.athleteB },
  roundRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
});
