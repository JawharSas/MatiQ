'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import Ionicons from '@expo/vector-icons/Ionicons';
import { formatClock } from '@matiq/rules-engine';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/ui/text';
import { useUserId } from '@/features/auth/AuthProvider';
import { Badge, LinkPressable, withPressFeedback } from '@/ui/components';
import { colors, font, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';
import { CONDENSED } from '@/ui/typography';
import { type FeedItem, useToggleLike } from './api';
import { Avatar } from './Avatar';

const DISCIPLINE_LABELS = { bjj: 'BJJ', wrestling: 'Wrestling', mma: 'MMA' } as const;

export function timeAgo(iso: string): string {
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

/**
 * A post in the "Fight Card" look: who posted it, their caption, the
 * highlight clip, then the score as a fight card (the winner's side bright
 * with a red bar, the other side muted), likes, comments and the way to the
 * full breakdown. Reporting is in the "..." menu.
 */
export function PostCard({ post }: { post: FeedItem }) {
  useTheme();
  const like = useToggleLike();
  const viewerId = useUserId();
  const [menuOpen, setMenuOpen] = useState(false);
  // The menu closes when the post is left (to report it, say).
  useFocusEffect(useCallback(() => () => setMenuOpen(false), []));
  const names = { A: post.athlete_a_label ?? 'Fighter 1', B: post.athlete_b_label ?? 'Fighter 2' };
  const winner = post.result?.winner ?? null;
  const ownPost = post.author_id === viewerId;
  const hasHighlight = Boolean(post.match_id && post.has_video && post.highlight_start_ms !== null);
  const meta = [post.discipline ? DISCIPLINE_LABELS[post.discipline] : null, post.match_title].filter(Boolean).join(' · ');

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Link href={{ pathname: '/user/[id]', params: { id: post.author_id } }} asChild>
          <LinkPressable accessibilityRole="link" style={styles.author}>
            <Avatar path={post.avatar_path} name={post.display_name} size={44} />
            <View style={styles.fill}>
              <Text style={styles.name} numberOfLines={1}>
                {post.display_name}
              </Text>
              <Text style={font.caption} numberOfLines={1}>
                @{post.username} · {timeAgo(post.created_at)}
              </Text>
            </View>
            {post.friends_only ? <Badge label="Friends" icon="people" /> : null}
          </LinkPressable>
        </Link>
        <View style={styles.fill} />
        {ownPost ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More options for this post"
            aria-expanded={menuOpen}
            onPress={() => setMenuOpen((open) => !open)}
            style={withPressFeedback(styles.more)}
            hitSlop={4}
          >
            <Ionicons aria-hidden name="ellipsis-horizontal" size={22} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {menuOpen ? (
        <View style={styles.menu}>
          <Link href={{ pathname: '/report/[postId]', params: { postId: post.post_id } }} asChild>
            <LinkPressable accessibilityRole="link" accessibilityLabel="Report post" style={styles.menuItem}>
              <Ionicons aria-hidden name="flag-outline" size={18} color={colors.text} />
              <Text style={styles.menuText}>Report post</Text>
            </LinkPressable>
          </Link>
        </View>
      ) : null}

      {/* User text is rendered as plain text - never as HTML or markdown. */}
      {post.body ? <Text style={styles.body}>{post.body}</Text> : null}

      {hasHighlight && post.match_id && post.highlight_start_ms !== null ? (
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
          <LinkPressable accessibilityRole="link" accessibilityLabel={`Play highlight · ${formatClock(post.highlight_start_ms)}`} style={styles.video}>
            <View style={styles.play} aria-hidden>
              <Ionicons name="play" size={26} color={colors.text} style={styles.playIcon} />
            </View>
            {meta ? (
              <View style={[styles.chip, styles.chipLeft]}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {meta}
                </Text>
              </View>
            ) : null}
            <View style={[styles.chip, styles.chipRight]}>
              <Text style={styles.chipText}>{formatClock(post.highlight_start_ms)}</Text>
            </View>
          </LinkPressable>
        </Link>
      ) : meta && post.result ? (
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      ) : null}

      {post.match_id && post.result && post.totals ? (
        <View style={styles.score} accessible accessibilityLabel={scoreLabel(names, post.totals.A.points, post.totals.B.points, winner, post.result.method)}>
          <Side name={names.A} points={post.totals.A.points} won={winner === 'A'} lost={winner === 'B'} />
          <View style={styles.middle}>
            <Text style={styles.vs}>VS</Text>
            <View style={[styles.result, !winner && styles.resultDraw]}>
              {winner ? <Ionicons name="trophy" size={13} color={colors.accentText} aria-hidden /> : null}
              <Text style={[styles.resultText, !winner && { color: colors.textMuted }]} numberOfLines={1}>
                {winner ? methodLabel(post.result.method) : 'Draw'}
              </Text>
            </View>
            {post.result.at !== undefined ? <Text style={styles.at}>{formatClock(post.result.at)}</Text> : null}
          </View>
          <Side name={names.B} points={post.totals.B.points} won={winner === 'B'} lost={winner === 'A'} alignRight />
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: post.liked_by_me }}
          accessibilityLabel={`${post.liked_by_me ? 'Unlike' : 'Like'} post, ${post.like_count} ${post.like_count === 1 ? 'like' : 'likes'}`}
          onPress={() => like.mutate({ postId: post.post_id, liked: post.liked_by_me })}
          style={withPressFeedback(styles.action)}
          hitSlop={4}
        >
          <Ionicons aria-hidden name={post.liked_by_me ? 'heart' : 'heart-outline'} size={23} color={post.liked_by_me ? colors.accent : colors.text} />
          <Text style={[styles.count, post.liked_by_me && { color: colors.accent }]}>{post.like_count}</Text>
        </Pressable>
        <Link href={{ pathname: '/comments/[postId]', params: { postId: post.post_id } }} asChild>
          <LinkPressable
            accessibilityRole="link"
            accessibilityLabel={`${post.comments_enabled ? 'Comments' : 'Comments off'}, ${post.comment_count} ${post.comment_count === 1 ? 'comment' : 'comments'}`}
            style={styles.action}
            hitSlop={4}
          >
            <Ionicons aria-hidden name="chatbubble-outline" size={22} color={colors.text} />
            <Text style={styles.count}>{post.comments_enabled || post.comment_count > 0 ? post.comment_count : 'Off'}</Text>
          </LinkPressable>
        </Link>
        <View style={styles.fill} />
        {post.match_id && post.result ? (
          <Link href={{ pathname: '/match/[id]', params: { id: post.match_id } }} asChild>
            <LinkPressable accessibilityRole="link" accessibilityLabel={`Breakdown of ${post.match_title ?? 'this match'}`} style={styles.breakdown}>
              <Text style={styles.breakdownText}>Breakdown</Text>
              <Ionicons aria-hidden name="chevron-forward" size={16} color={colors.accent} />
            </LinkPressable>
          </Link>
        ) : null}
      </View>
    </View>
  );
}

function scoreLabel(
  names: { A: string; B: string },
  a: number,
  b: number,
  winner: 'A' | 'B' | null,
  method: string,
): string {
  const score = `${names.A} ${a}, ${names.B} ${b}`;
  return winner ? `${score}. ${names[winner]} wins by ${methodLabel(method).toLowerCase()}.` : `${score}. Draw.`;
}

/** One fighter's side of the card: name, points and, for the winner, the red bar. */
function Side({ name, points, won, lost, alignRight = false }: { name: string; points: number; won: boolean; lost: boolean; alignRight?: boolean }) {
  useTheme();
  return (
    <View style={[styles.side, alignRight && styles.sideRight]}>
      <Text style={[styles.sideName, lost && styles.muted]} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.points, lost && styles.muted]}>{points}</Text>
      <View style={[styles.winBar, !won && styles.winBarHidden]} />
    </View>
  );
}

const styles = themedStyles(() => ({
  fill: { flex: 1 },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 6, paddingTop: 12, paddingBottom: 10 },
  author: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  more: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  menu: {
    marginHorizontal: 14,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: 14 },
  menuText: { fontSize: 15, fontWeight: '600', color: colors.text },
  body: { ...font.body, fontSize: 16, lineHeight: 23, paddingHorizontal: 14, paddingBottom: 12 },
  meta: { ...font.caption, paddingHorizontal: 14, paddingBottom: 4 },
  video: { height: 200, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  play: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The triangle's optical centre.
  playIcon: { marginLeft: 3 },
  chip: { position: 'absolute', bottom: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.background },
  chipLeft: { left: 12, maxWidth: '70%' },
  chipRight: { right: 12 },
  chipText: { fontFamily: CONDENSED, fontWeight: '700', fontSize: 14, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.text },
  score: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  side: { flex: 1, alignItems: 'flex-start' },
  sideRight: { alignItems: 'flex-end' },
  sideName: { fontFamily: CONDENSED, fontWeight: '700', fontSize: 16, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.text },
  points: { fontFamily: CONDENSED, fontWeight: '800', fontSize: 56, lineHeight: 60, color: colors.text, fontVariant: ['tabular-nums'] },
  muted: { color: colors.textMuted },
  winBar: { width: 40, height: 4, borderRadius: 2, marginTop: 4, backgroundColor: colors.accentFill },
  winBarHidden: { backgroundColor: 'transparent' },
  middle: { alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm },
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
  resultText: { fontFamily: CONDENSED, fontWeight: '700', fontSize: 14, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.accentText },
  at: { fontSize: 13, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, minWidth: 44, paddingHorizontal: 8 },
  count: { fontSize: 15, fontWeight: '600', color: colors.text },
  breakdown: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, paddingHorizontal: 8 },
  breakdownText: { fontFamily: CONDENSED, fontWeight: '700', fontSize: 16, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.accent },
}));
