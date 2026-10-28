import { formatClock } from '@matiq/rules-engine';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Caption, Card } from '@/ui/components';
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

export function PostCard({ post }: { post: FeedItem }) {
  const like = useToggleLike();
  const names = { A: post.athlete_a_label ?? 'A', B: post.athlete_b_label ?? 'B' };
  const winner = post.result?.winner ? names[post.result.winner] : null;

  return (
    <Card>
      <View style={styles.header}>
        <Link href={{ pathname: '/user/[id]', params: { id: post.author_id } }} asChild>
          <Pressable accessibilityRole="link" style={styles.author}>
            <Avatar path={post.avatar_path} name={post.display_name} />
            <View>
              <Text style={font.heading}>{post.display_name}</Text>
              <Caption>
                @{post.username} · {timeAgo(post.created_at)}
                {post.friends_only ? ' · Friends' : ''}
              </Caption>
            </View>
          </Pressable>
        </Link>
      </View>

      {/* User text is rendered as plain text - never as HTML or markdown. */}
      {post.body ? <Text style={font.body}>{post.body}</Text> : null}

      {post.match_id && post.result && post.totals ? (
        <Link href={{ pathname: '/match/[id]', params: { id: post.match_id } }} asChild>
          <Pressable accessibilityRole="link" style={styles.scorecard}>
            <Caption>
              {post.discipline ? DISCIPLINE_LABELS[post.discipline] : ''} {post.match_title ? `· ${post.match_title}` : ''}
            </Caption>
            <View style={styles.scoreRow}>
              <Text style={[styles.score, { color: athleteColor('A') }]}>
                {names.A} {post.totals.A.points}
              </Text>
              <Text style={font.caption}>vs</Text>
              <Text style={[styles.score, { color: athleteColor('B') }]}>
                {post.totals.B.points} {names.B}
              </Text>
            </View>
            <Caption>
              {winner ? `${winner} won` : 'Draw'} · {post.result.method.replace(/_/g, ' ')}
              {post.highlight_start_ms !== null ? ` · highlight at ${formatClock(post.highlight_start_ms)}` : ''}
            </Caption>
          </Pressable>
        </Link>
      ) : null}

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
          <Pressable accessibilityRole="link" accessibilityLabel="Play highlight" style={styles.playHighlight}>
            <Text style={styles.playHighlightText}>▶ Play highlight</Text>
          </Pressable>
        </Link>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: post.liked_by_me }}
        accessibilityLabel={post.liked_by_me ? 'Unlike' : 'Like'}
        onPress={() => like.mutate({ postId: post.post_id, liked: post.liked_by_me })}
        style={styles.like}
      >
        <Text style={{ color: post.liked_by_me ? colors.accent : colors.textMuted, fontWeight: '600' }}>
          {post.liked_by_me ? '♥' : '♡'} {post.like_count}
        </Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  author: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  scorecard: { backgroundColor: colors.surfaceRaised, borderRadius: 12, padding: spacing.md, gap: spacing.xs },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  score: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  like: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  playHighlight: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  playHighlightText: { color: colors.accent, fontWeight: '700' },
});
