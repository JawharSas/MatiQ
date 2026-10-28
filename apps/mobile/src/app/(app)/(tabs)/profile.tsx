import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useAuth, useUserId } from '@/features/auth/AuthProvider';
import { updateProfile, useProfile } from '@/features/social/api';
import { Avatar } from '@/features/social/Avatar';
import { changeAvatar, removeAvatar } from '@/features/social/avatar';
import { PrivacyToggle } from '@/features/social/PrivacyToggle';
import { RankedSummary } from '@/features/ranked/components';
import { errorMessage } from '@/lib/errors';
import { firstIssue, profileSchema } from '@/lib/validation';
import { Body, Button, Caption, Card, ErrorText, Heading, Loading, Screen, TextField, Title } from '@/ui/components';
import { spacing } from '@/ui/theme';

export default function ProfileScreen() {
  const userId = useUserId();
  const { isOwner } = useAuth();
  const router = useRouter();
  const profile = useProfile(userId);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ displayName: '', bio: '' });
  const [error, setError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  if (profile.isPending) return <Loading />;
  const card = profile.data;
  if (!card) return <Screen><ErrorText>{errorMessage(profile.error)}</ErrorText></Screen>;

  const save = async () => {
    const parsed = profileSchema.safeParse(draft);
    if (!parsed.success) return setError(firstIssue(parsed.error));
    try {
      await updateProfile(userId, { display_name: parsed.data.displayName, bio: parsed.data.bio });
      await queryClient.invalidateQueries({ queryKey: ['profile', userId] });
      setEditing(false);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const updateAvatar = async (remove: boolean) => {
    setAvatarBusy(true);
    setError(null);
    try {
      if (remove && card.avatar_path) await removeAvatar(userId, card.avatar_path);
      else if (!remove) await changeAvatar(userId, card.avatar_path);
      await queryClient.invalidateQueries({ queryKey: ['profile', userId] });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change profile picture"
          disabled={avatarBusy}
          onPress={() => void updateAvatar(false)}
          style={{ opacity: avatarBusy ? 0.5 : 1 }}
        >
          <Avatar path={card.avatar_path} name={card.display_name} size={72} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Title>{card.display_name}</Title>
          <Caption>
            @{card.username} · {card.friend_count} friends · {card.visibility === 'public' ? 'Public' : 'Private'} account
          </Caption>
        </View>
      </View>
      {card.avatar_path ? (
        <Button label="Remove profile picture" variant="secondary" disabled={avatarBusy} onPress={() => void updateAvatar(true)} />
      ) : (
        <Caption>Tap the circle to add a profile picture. Location and camera details are removed before upload.</Caption>
      )}
      {!editing ? <ErrorText>{error}</ErrorText> : null}
      {editing ? (
        <Card>
          <TextField label="Display name" value={draft.displayName} onChangeText={(v) => setDraft({ ...draft, displayName: v })} maxLength={50} />
          <TextField label="Bio" value={draft.bio} onChangeText={(v) => setDraft({ ...draft, bio: v })} multiline maxLength={280} />
          <ErrorText>{error}</ErrorText>
          <Button label="Save" onPress={() => void save()} />
          <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} />
        </Card>
      ) : (
        <Card>
          <Body>{card.bio || 'No bio yet.'}</Body>
          <Button
            label="Edit profile"
            variant="secondary"
            onPress={() => {
              setDraft({ displayName: card.display_name, bio: card.bio });
              setEditing(true);
            }}
          />
        </Card>
      )}
      <RankedSummary userId={userId} emptyText="Challenge a training partner from the Ranked tab to earn a rating and titles." />
      <PrivacyToggle userId={userId} visibility={card.visibility} />
      <Card>
        <Heading>Social</Heading>
        <Button label="Friends & requests" variant="secondary" onPress={() => router.push('/friends')} />
        <Button label="My posts" variant="secondary" onPress={() => router.push({ pathname: '/user/[id]', params: { id: userId } })} />
      </Card>
      <Button label="Settings" variant="secondary" onPress={() => router.push('/settings')} />
      {isOwner ? <Button label="Owner panel" onPress={() => router.push('/admin')} /> : null}
    </Screen>
  );
}
