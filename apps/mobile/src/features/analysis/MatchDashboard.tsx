import { formatClock, type Highlight, type Phase, type Scorecard } from '@matiq/rules-engine';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Caption, Card, Heading, Segmented } from '@/ui/components';
import { athleteColor, colors, font, radius, spacing } from '@/ui/theme';
import { highlightText, withNames } from './labels';
import { statRows } from './stat-rows';
import { type AthleteFilter, type BreakdownSection, type Clip, filterByAthlete, techniqueBreakdown } from './technique-breakdown';
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

interface MatchDashboardProps {
  match: MatchDetail;
  videoUrl: string | null | undefined;
  /** Highlight to play once the video is ready (e.g. opened from a feed post). */
  initialClip?: Clip | null;
}

export function MatchDashboard({ match, videoUrl, initialClip }: MatchDashboardProps) {
  const scorecard = match.analysis?.scorecard;
  const [filter, setFilter] = useState<AthleteFilter>('both');
  const [clip, setClip] = useState<Clip | null>(null);
  // Played once, when the player first becomes ready.
  const pendingClip = useRef(initialClip ?? null);
  const player = useVideoPlayer(videoUrl ?? null, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 0.25;
  });

  const playClip = (next: Clip | null, from: number) => {
    if (!videoUrl) return;
    setClip(next);
    player.currentTime = from / 1000;
    player.play();
  };

  useEventListener(player, 'statusChange', ({ status }) => {
    if (status !== 'readyToPlay' || !pendingClip.current) return;
    const first = pendingClip.current;
    pendingClip.current = null;
    playClip(first, first.start);
  });
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (clip && currentTime * 1000 >= clip.end) {
      player.pause();
      setClip(null);
    }
  });

  if (!scorecard) return null;

  const names = { A: match.athlete_a_label, B: match.athlete_b_label };
  const seek = videoUrl ? (ms: number) => playClip(null, ms) : undefined;
  const playHighlight = videoUrl ? (highlight: Highlight) => playClip({ start: highlight.start, end: highlight.end }, highlight.start) : undefined;
  const highlights = filterByAthlete(scorecard.highlights, filter);
  const filterOptions = [
    { value: 'both', label: 'Both' },
    { value: 'A', label: names.A },
    { value: 'B', label: names.B },
  ] as const;

  return (
    <View style={styles.stack}>
      {videoUrl ? <VideoView player={player} style={styles.video} contentFit="contain" nativeControls /> : null}
      {clip ? (
        <Caption>
          Playing highlight {formatClock(clip.start)}–{formatClock(clip.end)}
        </Caption>
      ) : null}
      <ScoreHeader scorecard={scorecard} names={names} />
      <Segmented options={filterOptions} value={filter} onChange={setFilter} />
      <PhaseTimeline
        phases={scorecard.phases}
        highlights={highlights}
        names={names}
        durationMs={scorecard.durationMs}
        onSeek={seek}
        onPlay={playHighlight}
      />
      <HighlightList highlights={highlights} names={names} onPlay={playHighlight} />
      {scorecard.rounds ? <RoundsTable scorecard={scorecard} names={names} /> : null}
      <StatsPanel scorecard={scorecard} names={names} />
      <TechniqueBreakdown sections={techniqueBreakdown(scorecard)} names={names} filter={filter} />
      {match.analysis?.coaching_summary ? (
        <Card>
          <Heading>Coach's notes</Heading>
          <Body>{match.analysis.coaching_summary}</Body>
        </Card>
      ) : null}
      <ScoreLog scorecard={scorecard} names={names} filter={filter} onSeek={seek} />
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
  names,
  durationMs,
  onSeek,
  onPlay,
}: {
  phases: Phase[];
  highlights: Highlight[];
  names: Names;
  durationMs: number;
  onSeek?: (ms: number) => void;
  onPlay?: (highlight: Highlight) => void;
}) {
  const [width, setWidth] = useState(0);
  if (durationMs <= 0) return null;
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  return (
    <Card>
      <Heading>Timeline</Heading>
      <Pressable
        onLayout={onLayout}
        disabled={!onSeek || width === 0}
        // Phases ignore touches, so locationX is relative to the bar itself.
        onPress={(event) => onSeek?.(Math.round((Math.min(Math.max(event.nativeEvent.locationX, 0), width) / width) * durationMs))}
        accessibilityLabel="Match phases timeline"
        accessibilityHint={onSeek ? 'Tap to jump to that moment in the video' : undefined}
        style={styles.timeline}
      >
        {phases.map((phase) => (
          <View
            key={`${phase.start}-${phase.kind}`}
            pointerEvents="none"
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
            accessibilityLabel={`${withNames(highlight.label, names)} at ${formatClock(highlight.t)}`}
            disabled={!onPlay}
            onPress={() => onPlay?.(highlight)}
            hitSlop={12}
            style={[styles.marker, { left: `${(highlight.t / durationMs) * 100}%` }]}
          />
        ))}
      </Pressable>
      <View style={styles.timelineLabels}>
        <Caption>0:00</Caption>
        <Caption>{formatClock(durationMs)}</Caption>
      </View>
      <View style={styles.legend}>
        {phases.slice(0, 6).map((phase) => (
          <Caption key={`legend-${phase.start}`}>
            {formatClock(phase.start)} {withNames(phase.label, names)}
          </Caption>
        ))}
      </View>
    </Card>
  );
}

function HighlightList({ highlights, names, onPlay }: { highlights: Highlight[]; names: Names; onPlay?: (highlight: Highlight) => void }) {
  if (highlights.length === 0) return null;
  return (
    <Card>
      <Heading>Highlights</Heading>
      {highlights.map((highlight) => (
        <Pressable
          key={`highlight-${highlight.t}`}
          disabled={!onPlay}
          onPress={() => onPlay?.(highlight)}
          accessibilityRole={onPlay ? 'button' : 'text'}
          accessibilityHint={onPlay ? 'Plays this moment' : undefined}
          style={styles.listRow}
        >
          <Text style={font.mono}>{formatClock(highlight.t)}</Text>
          <Text style={[font.body, styles.fill]}>
            {highlight.athlete ? <Text style={{ color: athleteColor(highlight.athlete) }}>{names[highlight.athlete]} </Text> : null}
            {highlightText(highlight.label, highlight.athlete, names)}
          </Text>
          {onPlay ? <Text style={styles.play}>▶</Text> : null}
        </Pressable>
      ))}
    </Card>
  );
}

const formatValue = (unit: BreakdownSection['unit'], value: number) => (unit === 'ms' ? formatClock(value) : String(value));

function TechniqueBreakdown({ sections, names, filter }: { sections: BreakdownSection[]; names: Names; filter: AthleteFilter }) {
  if (sections.length === 0) return null;
  return (
    <Card>
      <View style={styles.statHeader}>
        <Text style={[font.caption, { color: colors.athleteA }]}>{names.A}</Text>
        <Heading>Technique breakdown</Heading>
        <Text style={[font.caption, { color: colors.athleteB }]}>{names.B}</Text>
      </View>
      {sections.map((section) => {
        const max = Math.max(1, ...section.items.map((item) => Math.max(item.a, item.b)));
        return (
          <View key={section.title} style={styles.section}>
            <Text style={font.caption}>{section.title.toUpperCase()}</Text>
            {section.items.map((item) => (
              <View key={item.label} style={styles.breakdownRow} accessibilityLabel={`${item.label}: ${names.A} ${formatValue(section.unit, item.a)}, ${names.B} ${formatValue(section.unit, item.b)}`}>
                <Text style={[font.body, styles.statA, filter === 'B' && styles.dimmed]}>{formatValue(section.unit, item.a)}</Text>
                <View style={styles.breakdownMiddle}>
                  <Caption>{item.label}</Caption>
                  <View style={styles.breakdownBars}>
                    <View style={styles.halfBarA}>
                      <View style={[styles.barA, styles.halfFill, { width: `${(item.a / max) * 100}%` }, filter === 'B' && styles.dimmed]} />
                    </View>
                    <View style={styles.halfBarB}>
                      <View style={[styles.barB, styles.halfFill, { width: `${(item.b / max) * 100}%` }, filter === 'A' && styles.dimmed]} />
                    </View>
                  </View>
                </View>
                <Text style={[font.body, styles.statB, filter === 'A' && styles.dimmed]}>{formatValue(section.unit, item.b)}</Text>
              </View>
            ))}
          </View>
        );
      })}
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
          <Caption>{withNames(round.rationale, names)}</Caption>
        </View>
      ))}
      <Caption>
        {names.A} {scorecard.totals.A.points} – {scorecard.totals.B.points} {names.B}
      </Caption>
    </Card>
  );
}

function ScoreLog({
  scorecard,
  names,
  filter,
  onSeek,
}: {
  scorecard: Scorecard;
  names: Names;
  filter: AthleteFilter;
  onSeek?: (ms: number) => void;
}) {
  const lines = filterByAthlete(
    scorecard.scoreLog.filter((line) => scorecard.discipline !== 'mma' || line.penalties > 0),
    filter,
  );
  if (lines.length === 0) return null;
  return (
    <Card>
      <Heading>Scoring log</Heading>
      {lines.map((line, index) => (
        <Pressable
          key={`${line.t}-${index}`}
          disabled={!onSeek}
          // Start a few seconds early so the setup is visible.
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
  play: { color: colors.accent, fontSize: 14 },
  section: { gap: spacing.sm, marginTop: spacing.sm },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  breakdownMiddle: { flex: 1, gap: 4, alignItems: 'center' },
  breakdownBars: { flexDirection: 'row', width: '100%', height: 6, gap: 2 },
  halfBarA: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  halfBarB: { flex: 1, flexDirection: 'row' },
  halfFill: { height: 6, borderRadius: 3 },
  dimmed: { opacity: 0.3 },
});
