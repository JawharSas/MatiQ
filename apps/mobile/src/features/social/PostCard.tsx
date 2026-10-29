import Ionicons from '@expo/vector-icons/Ionicons';
import { formatClock } from '@matiq/rules-engine';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { useUserId } from '@/features/auth/AuthProvider';
import { Badge, Card } from '@/ui/components';
import { athleteColor, colors, font, spacing } from '@/ui/theme';
import { type FeedItem, useToggleLike } from './api';
import { Avatar } from './Avatar';

const DISCIPLINE_LABELS = { bjj: 'BJJ', wrestling: 'Wrestling', mma: 'MMA' } as const;

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function methodLabel(method: string): string {
  const words = method.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function PostCard({ post }: { post: FeedItem }) {
  const like = useToggleLike();
  const viewerId = useUserId();
  const names = { A: post.athlete_a_label ?? 'Fighter 1', B: post.athlete_b_label ?? 'Fighter 2' };
  const winner = post.result?.winner ?? null;

  return (
    <Card>
      <Link href={{ pathname: '/user/[id]', params: { id: post.author_id } }} asChild>
        <Pressable accessibilityRole="link" style={styles.author}>
          <Avatar path={post.avatar_path} name={post.display_name} size={44} />
          <View style={styles.fill}>
            <Text style={styles.name}>{post.display_name}</Text>
            <Text style={font.caption}>
              @{post.username} · {timeAgo(post.created_at)}
            </Text>
          </View>
          {post.friends_only ? <Badge label="Friends" icon="people" /> : null}
        </Pressable>
      </Link>

      {/* User text is rendered as plain text - never as HTML or markdown. */}
      {post.body ? <Text style={styles.body}>{post.body}</Text> : null}

      {post.match_id && post.result && post.totals ? (
        <Link href={{ pathname: '/match/[id]', params: { id: post.match_id } }} asChild>
          <Pressable accessibilityRole="link" style={({ pressed }) => [styles.fightCard, pressed && { opacity: 0.85 }]}>
            <View style={styles.fightMeta}>
              {post.discipline ? <Badge label={DISCIPLINE_LABELS[post.discipline]} tone="accent" /> : null}
              {post.match_title ? (
                <Text style={[font.caption, styles.fill]} numberOfLines={1}>
                  {post.match_title}
                </Text>
              ) : (
                <View style={styles.fill} />
              )}
              <Text style={styles.method}>{winner ? methodLabel(post.result.method) : 'Draw'}</Text>
            </View>
            <View style={styles.fighters}>
              <Fighter name={names.A} corner="A" won={winner === 'A'} lost={winner === 'B'} />
              <View style={styles.scores}>
                <Text style={[styles.score, { color: winner === 'B' ? colors.textMuted : athleteColor('A') }]}>
                  {post.totals.A.points}
                </Text>
                <Text style={styles.scoreDivider}>:</Text>
                <Text style={[styles.score, { color: winner === 'A' ? colors.textMuted : athleteColor('B') }]}>
                  {post.totals.B.points}
                </Text>
              </View>
              <Fighter name={names.B} corner="B" won={winner === 'B'} lost={winner === 'A'} />
            </View>
          </Pressable>
        </Link>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: post.liked_by_me }}
          accessibilityLabel={`${post.liked_by_me ? 'Unlike' : 'Like'} post, ${post.like_count} ${post.like_count === 1 ? 'like' : 'likes'}`}
          onPress={() => like.mutate({ postId: post.post_id, liked: post.liked_by_me })}
          style={styles.like}
          hitSlop={8}
        >
          <Ionicons aria-hidden name={post.liked_by_me ? 'heart' : 'heart-outline'} size={22} color={post.liked_by_me ? colors.accent : colors.textMuted} />
          <Text style={[styles.likeCount, post.liked_by_me && { color: colors.accent }]}>{post.like_count}</Text>
        </Pressable>
        {post.match_id && post.has_video && post.highlight_start_ms !== null ? (
          <Link
            href={{
              pathname: '/match/[id]',
              params: {
                id: post.match_id,
                t: String(post.highlight_start_ms),
                ...(post.highlight_end_ms !== null ? { end: String(post.highlight_end_ms) } : {}),
              },
            }}
            asChild
          >
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Play highlight · ${formatClock(post.highlight_start_ms)}`}
              style={styles.playHighlight}
            >
              <Ionicons aria-hidden name="play" size={14} color={colors.accent} />
              <Text style={styles.playHighlightText}>Highlight · {formatClock(post.highlight_start_ms)}</Text>
            </Pressable>
          </Link>
        ) : null}
        {post.author_id !== viewerId ? (
          <Link href={{ pathname: '/report/[postId]', params: { postId: post.post_id } }} asChild>
            <Pressable accessibilityRole="link" accessibilityLabel="Report post" style={styles.report} hitSlop={6}>
              <Ionicons aria-hidden name="flag-outline" size={16} color={colors.textMuted} />
              <Text style={styles.reportText}>Report</Text>
            </Pressable>
          </Link>
        ) : null}
      </View>
    </Card>
  );
}

function Fighter({ name, corner, won, lost }: { name: string; corner: 'A' | 'B'; won: boolean; lost: boolean }) {
  const alignRight = corner === 'B';
  return (
    <View style={[styles.fighter, alignRight && { alignItems: 'flex-end' }]}>
      <View style={[styles.cornerBar, { backgroundColor: athleteColor(corner) }, lost && { opacity: 0.35 }]} />
      <Text style={[styles.fighterName, lost && { color: colors.textMuted }]} numberOfLines={1}>
        {name}
      </Text>
      {won ? (
        <View style={styles.won}>
          <Ionicons name="trophy" size={12} color={colors.warning} />
          <Text style={styles.wonText}>WIN</Text>
        </View>
      ) : (
        <Text style={styles.wonPlaceholder}> </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  author: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  body: { ...font.body, fontSize: 15.5, lineHeight: 23 },
  fightCard: { backgroundColor: colors.surfaceRaised, borderRadius: 16, padding: 14, gap: 12 },
  fightMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  method: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  fighters: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fighter: { flex: 1, gap: 4 },
  cornerBar: { width: 28, height: 4, borderRadius: 2 },
  fighterName: { fontSize: 16, fontWeight: '700', color: colors.text },
  won: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  wonText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color: colors.warning },
  wonPlaceholder: { fontSize: 11 },
  scores: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  score: { fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  scoreDivider: { fontSize: 22, fontWeight: '700', color: colors.textFaint },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  like: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, minWidth: 44 },
  report: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: spacing.xs },
  reportText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  likeCount: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  playHighlight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  playHighlightText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
});
