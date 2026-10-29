import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { useAuth, useUserId } from '@/features/auth/AuthProvider';
import { updateProfile, useProfile } from '@/features/social/api';
import { Avatar } from '@/features/social/Avatar';
import { changeAvatar, removeAvatar } from '@/features/social/avatar';
import { PrivacyToggle } from '@/features/social/PrivacyToggle';
import { RankedSummary } from '@/features/ranked/components';
import { errorMessage } from '@/lib/errors';
import { firstIssue, profileSchema } from '@/lib/validation';
import { Badge, Body, Button, Caption, Card, ErrorText, ListGroup, ListRow, Loading, Screen, SectionHeader, TextField } from '@/ui/components';
import { colors, font, spacing } from '@/ui/theme';

export default function ProfileScreen() {
  const userId = useUserId();
  const { isOwner } = useAuth();
  const router = useRouter();
  const profile = useProfile(userId);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ username: '', displayName: '', bio: '' });
  const [error, setError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  if (profile.isPending) return <Loading />;
  const card = profile.data;
  if (!card) return <Screen><ErrorText>{errorMessage(profile.error)}</ErrorText></Screen>;

  const save = async () => {
    const parsed = profileSchema.safeParse(draft);
    if (!parsed.success) return setError(firstIssue(parsed.error));
    try {
      await updateProfile(userId, { username: parsed.data.username, display_name: parsed.data.displayName, bio: parsed.data.bio });
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
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change profile picture"
          disabled={avatarBusy}
          onPress={() => void updateAvatar(false)}
          style={({ pressed }) => ({ opacity: avatarBusy || pressed ? 0.6 : 1 })}
        >
          <Avatar path={card.avatar_path} name={card.display_name} size={84} />
          <View style={styles.cameraBadge}>
            <Ionicons name="camera" size={14} color={colors.accentText} />
          </View>
        </Pressable>
        <View style={styles.identity}>
          <Text style={font.title} numberOfLines={1}>
            {card.display_name}
          </Text>
          <Text style={font.caption}>@{card.username}</Text>
          <View style={styles.badges}>
            <Badge
              label={card.visibility === 'public' ? 'Public' : 'Private'}
              icon={card.visibility === 'public' ? 'globe-outline' : 'lock-closed'}
              tone={card.visibility === 'public' ? 'blue' : 'neutral'}
            />
            <Badge label={`${card.friend_count} ${card.friend_count === 1 ? 'friend' : 'friends'}`} icon="people" />
          </View>
        </View>
      </View>

      {!editing ? <ErrorText>{error}</ErrorText> : null}
      {editing ? (
        <Card>
          <TextField label="Username" value={draft.username} onChangeText={(v) => setDraft({ ...draft, username: v })} autoCapitalize="none" maxLength={24} />
          <TextField label="Display name" value={draft.displayName} onChangeText={(v) => setDraft({ ...draft, displayName: v })} maxLength={50} />
          <TextField label="Bio" value={draft.bio} onChangeText={(v) => setDraft({ ...draft, bio: v })} multiline maxLength={280} />
          <ErrorText>{error}</ErrorText>
          <Button label="Save" icon="checkmark" onPress={() => void save()} />
          <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} />
        </Card>
      ) : (
        <Card>
          <Body muted={!card.bio}>{card.bio || 'Add a bio: your belt, your style, where you train.'}</Body>
          <Button
            label="Edit profile"
            variant="secondary"
            icon="create-outline"
            onPress={() => {
              setDraft({ username: card.username, displayName: card.display_name, bio: card.bio });
              setEditing(true);
            }}
          />
          {card.avatar_path ? (
            <Button label="Remove profile picture" variant="ghost" icon="trash-outline" disabled={avatarBusy} onPress={() => void updateAvatar(true)} />
          ) : null}
          {!card.avatar_path ? <Caption>Tap your picture to add one. Location and camera details are removed before upload.</Caption> : null}
        </Card>
      )}

      <RankedSummary userId={userId} emptyText="Challenge a training partner from the Ranked tab to earn a rating and titles." />
      <PrivacyToggle userId={userId} visibility={card.visibility} />

      <SectionHeader title="Account" />
      <ListGroup>
        <ListRow icon="people" title="Friends & requests" onPress={() => router.push('/friends')} />
        <ListRow icon="images" title="My posts" onPress={() => router.push({ pathname: '/user/[id]', params: { id: userId } })} />
        <ListRow icon="settings" tone="neutral" title="Settings" onPress={() => router.push('/settings')} />
        {isOwner ? <ListRow icon="shield-half" tone="warning" title="Owner panel" subtitle="Users, usage, disputes and audit log" onPress={() => router.push('/admin')} /> : null}
      </ListGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingTop: spacing.sm },
  identity: { flex: 1, gap: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: colors.background,
  },
});
