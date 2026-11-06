'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useAuth, useUserId } from '@/features/auth/AuthProvider';
import { recordText, summarize } from '@/features/analysis/match-record';
import { useMyMatches } from '@/features/analysis/useMyMatches';
import { RankedSummary } from '@/features/ranked/components';
import { GoalsCard } from '@/features/goals/GoalsCard';
import { GymCard } from '@/features/gyms/GymCard';
import { useFriends, useProfile } from '@/features/social/api';
import { AthleteHeader } from '@/features/social/AthleteHeader';
import { errorMessage } from '@/lib/errors';
import { Button, ErrorText, ListGroup, ListRow, Loading, Screen, SectionHeader } from '@/ui/components';
import { themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

/**
 * Your profile, as others see it: picture, record and friends, name and bio,
 * then your ranked card. Editing (picture, names, bio, privacy) is on its own
 * screen; Settings is behind the gear in the header.
 */
export default function ProfileScreen() {
  useTheme();
  const userId = useUserId();
  const { isOwner } = useAuth();
  const router = useRouter();
  const profile = useProfile(userId);
  const record = summarize(useMyMatches().data ?? []);
  const requests = (useFriends().data ?? []).filter((entry) => entry.direction === 'incoming').length;

  if (profile.isPending) return <Loading />;
  const card = profile.data;
  if (!card) {
    return (
      <Screen>
        <ErrorText>{errorMessage(profile.error)}</ErrorText>
      </Screen>
    );
  }

  return (
    <Screen>
      <AthleteHeader
        avatarPath={card.avatar_path}
        displayName={card.display_name}
        username={card.username}
        stats={[
          { label: record.total === 1 ? 'Match' : 'Matches', value: record.total },
          { label: 'Record', value: recordText(record) },
          { label: card.friend_count === 1 ? 'Friend' : 'Friends', value: card.friend_count },
        ]}
        tags={[
          card.visibility === 'public' ? { label: 'Public', icon: 'globe-outline' as const } : { label: 'Private', icon: 'lock-closed' as const },
          ...(isOwner ? [{ label: 'Owner', icon: 'shield-half' as const }] : []),
        ]}
        bio={card.bio}
        bioPlaceholder="Add a bio: your belt, your style, where you train."
      >
        <View style={styles.action}>
          <Button label="Edit profile" variant="secondary" size="sm" onPress={() => router.push('/edit-profile')} />
        </View>
        <View style={styles.action}>
          <Button label={requests > 0 ? `Friends (${requests} new)` : 'Friends'} variant="secondary" size="sm" onPress={() => router.push('/friends')} />
        </View>
      </AthleteHeader>

      <GoalsCard />

      <GymCard />

      <RankedSummary userId={userId} emptyText="Challenge a training partner from the Ranked tab to earn a rating and titles." />

      <SectionHeader title="More" />
      <ListGroup>
        <ListRow icon="images" title="My posts" onPress={() => router.push({ pathname: '/user/[id]', params: { id: userId } })} />
        {isOwner ? <ListRow icon="shield-half" tone="warning" title="Owner panel" subtitle="Users, usage, disputes and audit log" onPress={() => router.push('/admin')} /> : null}
      </ListGroup>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  action: { flexGrow: 1, flexBasis: 140 },
}));
