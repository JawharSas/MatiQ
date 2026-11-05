'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useUserId } from '@/features/auth/AuthProvider';
import { type ProfileCard, updateProfile, useProfile } from '@/features/social/api';
import { Avatar } from '@/features/social/Avatar';
import { changeAvatar, removeAvatar } from '@/features/social/avatar';
import { PrivacyToggle } from '@/features/social/PrivacyToggle';
import { errorMessage, isBannedError } from '@/lib/errors';
import { firstIssue, profileSchema } from '@/lib/validation';
import { Button, Caption, Card, ErrorText, Loading, Screen, TextField } from '@/ui/components';
import { spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

/** Your picture, names, bio and who can see your posts. */
export default function EditProfileScreen() {
  useTheme();
  const userId = useUserId();
  const profile = useProfile(userId);
  if (profile.isPending) return <Loading />;
  if (!profile.data) {
    return (
      <Screen>
        <ErrorText>{errorMessage(profile.error)}</ErrorText>
      </Screen>
    );
  }
  return <EditProfile userId={userId} card={profile.data} />;
}

function EditProfile({ userId, card }: { userId: string; card: ProfileCard }) {
  useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({ username: card.username, displayName: card.display_name, bio: card.bio });
  const [error, setError] = useState<string | null>(null);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [pictureBusy, setPictureBusy] = useState(false);

  const save = async () => {
    const parsed = profileSchema.safeParse(draft);
    if (!parsed.success) return setError(firstIssue(parsed.error));
    try {
      await updateProfile(userId, { username: parsed.data.username, display_name: parsed.data.displayName, bio: parsed.data.bio });
      await queryClient.invalidateQueries({ queryKey: ['profile', userId] });
      setError(null);
      router.back();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const updatePicture = async (remove: boolean) => {
    setPictureBusy(true);
    setPictureError(null);
    try {
      if (remove && card.avatar_path) await removeAvatar(userId, card.avatar_path);
      else if (!remove) await changeAvatar(userId);
      await queryClient.invalidateQueries({ queryKey: ['profile', userId] });
    } catch (caught) {
      setPictureError(errorMessage(caught));
      if (isBannedError(caught)) await queryClient.invalidateQueries({ queryKey: ['age-check'] });
    } finally {
      setPictureBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.picture}>
        <Avatar path={card.avatar_path} name={card.display_name} size={96} />
        <View style={styles.pictureActions}>
          <Button label={card.avatar_path ? 'Change picture' : 'Add a picture'} variant="secondary" icon="camera-outline" size="sm" loading={pictureBusy} onPress={() => updatePicture(false)} />
          {card.avatar_path ? (
            <Button label="Remove picture" variant="ghost" icon="trash-outline" size="sm" disabled={pictureBusy} onPress={() => updatePicture(true)} />
          ) : null}
        </View>
        <Caption>Location and camera details are removed before upload.</Caption>
        <ErrorText>{pictureError}</ErrorText>
      </View>

      <Card>
        <TextField label="Username" value={draft.username} onChangeText={(v) => setDraft({ ...draft, username: v })} autoCapitalize="none" maxLength={24} />
        <TextField label="Display name" value={draft.displayName} onChangeText={(v) => setDraft({ ...draft, displayName: v })} maxLength={50} />
        <TextField
          label="Bio"
          value={draft.bio}
          onChangeText={(v) => setDraft({ ...draft, bio: v })}
          multiline
          maxLength={280}
          placeholder="Your belt, your style, where you train"
        />
        <ErrorText>{error}</ErrorText>
        <Button label="Save" icon="checkmark" onPress={() => save()} />
      </Card>

      <PrivacyToggle userId={userId} visibility={card.visibility} />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  picture: { alignItems: 'center', gap: spacing.sm },
  pictureActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
}));
