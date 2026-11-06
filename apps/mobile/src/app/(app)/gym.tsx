'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { Link, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Share, View } from 'react-native';
import { useUserId } from '@/features/auth/AuthProvider';
import { type GymMember, type GymRanking, useGymActions, useGymFeed, useGymLeaderboard, useGymMembers, useMyGym } from '@/features/gyms/api';
import { DISCIPLINE_OPTIONS, TierBadge } from '@/features/ranked/components';
import { Avatar } from '@/features/social/Avatar';
import { PostCard } from '@/features/social/PostCard';
import { errorMessage } from '@/lib/errors';
import { Badge, Body, Button, Caption, Card, EmptyState, ErrorText, Heading, LinkPressable, Loading, Screen, Segmented, TabBar } from '@/ui/components';
import { Text } from '@/ui/text';
import { colors, font, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';
import { CONDENSED } from '@/ui/typography';

type Section = 'feed' | 'leaderboard' | 'members';
const SECTIONS = [
  { value: 'feed', label: 'Feed' },
  { value: 'leaderboard', label: 'Leaderboard' },
  { value: 'members', label: 'Members' },
] as const;

/** Your gym: teammates' posts, the gym leaderboard and the members, with the invite code. */
export default function GymScreen() {
  useTheme();
  const router = useRouter();
  const gym = useMyGym();
  const [section, setSection] = useState<Section>('feed');

  if (gym.isPending) return <Loading />;
  if (!gym.data) {
    return (
      <Screen>
        <EmptyState
          icon="people-outline"
          title="You're not in a gym"
          body="Join your gym with its code, or start one."
          action={<Button label="Join or start a gym" onPress={() => router.replace('/gym-join')} />}
        />
      </Screen>
    );
  }
  const data = gym.data;

  return (
    <Screen>
      <Stack.Screen options={{ title: data.name }} />
      <View>
        <Text style={styles.title}>{data.name}</Text>
        <Text style={font.caption}>{[data.city, `${data.member_count} ${data.member_count === 1 ? 'member' : 'members'}`].filter(Boolean).join(' · ')}</Text>
      </View>
      <TabBar options={SECTIONS} value={section} onChange={setSection} label="Gym sections" />
      {section === 'feed' ? <GymFeed /> : null}
      {section === 'leaderboard' ? <Leaderboard /> : null}
      {section === 'members' ? <Members isOwner={data.role === 'owner'} code={data.invite_code} gymName={data.name} /> : null}
    </Screen>
  );
}

function GymFeed() {
  useTheme();
  const feed = useGymFeed(true);
  if (feed.isPending) return <Loading inline label="Loading posts" />;
  const posts = feed.data?.pages.flat() ?? [];
  if (posts.length === 0) {
    return <EmptyState icon="newspaper-outline" title="No gym posts yet" body="When teammates share a round, it shows up here. Private accounts show once you're friends." />;
  }
  return (
    <>
      {posts.map((post) => (
        <PostCard key={post.post_id} post={post} />
      ))}
      {feed.hasNextPage ? <Button label="Show more" variant="secondary" onPress={() => feed.fetchNextPage()} /> : null}
    </>
  );
}

function Leaderboard() {
  useTheme();
  const [discipline, setDiscipline] = useState<'bjj' | 'wrestling' | 'mma'>('bjj');
  const board = useGymLeaderboard(discipline, true);
  return (
    <>
      <Segmented options={DISCIPLINE_OPTIONS} value={discipline} onChange={setDiscipline} />
      {board.isPending ? <Loading inline /> : null}
      {board.error ? <ErrorText>{errorMessage(board.error)}</ErrorText> : null}
      {board.data && board.data.length === 0 ? (
        <EmptyState icon="trophy-outline" title="No ranked matches yet" body="Teammates show here after their first ranked match in this sport." />
      ) : null}
      {board.data && board.data.length > 0 ? (
        <Card>
          {board.data.map((row, index) => (
            <RankRow key={row.user_id} row={row} place={index + 1} />
          ))}
        </Card>
      ) : null}
    </>
  );
}

function RankRow({ row, place }: { row: GymRanking; place: number }) {
  useTheme();
  return (
    <Link href={{ pathname: '/user/[id]', params: { id: row.user_id } }} asChild>
      {/* Named by its visible text (place, name, tier, rating, record), so speech matches the screen. */}
      <LinkPressable accessibilityRole="link" style={styles.rankRow}>
        <Text style={[styles.place, place === 1 && styles.first]}>{place}</Text>
        <Avatar path={row.avatar_path} name={row.display_name} size={36} />
        <View style={styles.fill}>
          <Text style={styles.memberName} numberOfLines={1}>
            {row.display_name}
          </Text>
          <TierBadge rating={row.rating} games={row.games} compact />
        </View>
        <View style={styles.ratingBox}>
          <Text style={styles.rating}>{row.rating}</Text>
          <Text style={font.caption}>
            {row.wins}-{row.losses}-{row.draws}
          </Text>
        </View>
      </LinkPressable>
    </Link>
  );
}

function Members({ isOwner, code, gymName }: { isOwner: boolean; code: string; gymName: string }) {
  useTheme();
  const me = useUserId();
  const router = useRouter();
  const members = useGymMembers(true);
  const actions = useGymActions();
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const confirmRemove = (member: GymMember) =>
    Alert.alert(`Remove ${member.display_name}?`, 'They leave the gym and need a new code to come back.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void run(() => actions.remove(member.user_id)) },
    ]);

  const confirmLeave = () =>
    Alert.alert(
      `Leave ${gymName}?`,
      isOwner ? 'The member who joined first becomes the owner. If you are the last member, the gym is deleted.' : 'You can join again with the gym code.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              await actions.leave();
              router.back();
            }),
        },
      ],
    );

  return (
    <>
      <Card>
        <Heading>Invite teammates</Heading>
        <Text style={styles.code} accessibilityLabel={`Gym code ${code.split('').join(' ')}`} selectable>
          {code}
        </Text>
        <Button
          label="Share code"
          icon="share-outline"
          variant="secondary"
          onPress={() => Share.share({ message: `Join ${gymName} on MatIQ with the gym code ${code}.` })}
        />
        {isOwner ? <Button label="New code" variant="ghost" onPress={() => run(actions.rotateCode)} hint="The old code stops working" /> : null}
        <Caption>Anyone with the code can join. Members see each other's names and ranked ratings.</Caption>
      </Card>
      {members.isPending ? <Loading inline /> : null}
      <Card>
        {(members.data ?? []).map((member) => (
          <View key={member.user_id} style={styles.memberRow}>
            <Avatar path={member.avatar_path} name={member.display_name} size={40} />
            <View style={styles.fill}>
              <Text style={styles.memberName} numberOfLines={1}>
                {member.display_name}
              </Text>
              <Text style={font.caption}>@{member.username}</Text>
            </View>
            {member.role === 'owner' ? <Badge label="Owner" icon="shield" tone="accent" /> : null}
            {isOwner && member.user_id !== me ? <Button label="Remove" size="sm" variant="ghost" onPress={() => confirmRemove(member)} /> : null}
          </View>
        ))}
      </Card>
      <ErrorText>{error}</ErrorText>
      <Body muted>Leaving takes you out of the gym's feed and leaderboard.</Body>
      <Button label="Leave gym" variant="danger" onPress={confirmLeave} />
    </>
  );
}

const styles = themedStyles(() => ({
  fill: { flex: 1, gap: 4 },
  title: { fontFamily: CONDENSED, fontWeight: '800', fontSize: 34, lineHeight: 38, textTransform: 'uppercase', color: colors.text },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56 },
  place: { width: 24, textAlign: 'center', fontFamily: CONDENSED, fontWeight: '800', fontSize: 20, color: colors.textMuted },
  first: { color: colors.accent },
  memberName: { fontSize: 16, fontWeight: '600', color: colors.text },
  ratingBox: { alignItems: 'flex-end' },
  rating: { fontFamily: CONDENSED, fontWeight: '800', fontSize: 22, color: colors.text, fontVariant: ['tabular-nums'] },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56 },
  code: { fontFamily: CONDENSED, fontWeight: '800', fontSize: 40, letterSpacing: 6, textAlign: 'center', color: colors.text, paddingVertical: spacing.sm },
}));
