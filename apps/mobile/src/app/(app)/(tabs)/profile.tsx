import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuth, useUserId } from '@/features/auth/AuthProvider';
import { updateProfile, useProfile } from '@/features/social/api';
import { PrivacyToggle } from '@/features/social/PrivacyToggle';
import { errorMessage } from '@/lib/errors';
import { firstIssue, profileSchema } from '@/lib/validation';
import { Body, Button, Caption, Card, ErrorText, Heading, Loading, Screen, TextField, Title } from '@/ui/components';

export default function ProfileScreen() {
  const userId = useUserId();
  const { isOwner } = useAuth();
  const router = useRouter();
  const profile = useProfile(userId);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ displayName: '', bio: '' });
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Screen>
      <Title>{card.display_name}</Title>
      <Caption>
        @{card.username} · {card.friend_count} friends · {card.visibility === 'public' ? 'Public' : 'Private'} account
      </Caption>
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
