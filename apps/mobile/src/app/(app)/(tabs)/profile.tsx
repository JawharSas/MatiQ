'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

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
import { errorMessage, isBannedError } from '@/lib/errors';
import { firstIssue, profileSchema } from '@/lib/validation';
import { useA11y } from '@/features/accessibility/A11yProvider';
import { recordText, summarize } from '@/features/analysis/match-record';
import { useMyMatches } from '@/features/analysis/useMyMatches';
import { LogoMark } from '@/ui/brand';
import { Badge, Body, Button, Caption, Card, ErrorText, ListGroup, ListRow, Loading, Screen, SectionHeader, StatTile, TextField } from '@/ui/components';
import { colors, font, radius, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

export default function ProfileScreen() {
  useTheme();
  const userId = useUserId();
  const { isOwner } = useAuth();
  const router = useRouter();
  const profile = useProfile(userId);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ username: '', displayName: '', bio: '' });
  const [error, setError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const { highContrast } = useA11y();
  const record = summarize(useMyMatches().data ?? []);

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
      else if (!remove) await changeAvatar(userId);
      await queryClient.invalidateQueries({ queryKey: ['profile', userId] });
    } catch (caught) {
      setError(errorMessage(caught));
      if (isBannedError(caught)) await queryClient.invalidateQueries({ queryKey: ['age-check'] });
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <Screen>
      <View style={[styles.hero, highContrast && styles.heroContrast]}>
        <View style={styles.cover} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.coverMark}>
            <LogoMark size={132} />
          </View>
        </View>
        <View style={styles.heroBody}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change profile picture"
            disabled={avatarBusy}
            onPress={() => void updateAvatar(false)}
            style={({ pressed }) => [styles.avatarRing, { opacity: avatarBusy || pressed ? 0.6 : 1 }]}
          >
            <Avatar path={card.avatar_path} name={card.display_name} size={88} />
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
              {isOwner ? <Badge label="Owner" icon="shield-half" tone="warning" /> : null}
            </View>
          </View>
          <View style={styles.tiles}>
            <StatTile label="Matches" value={record.total} />
            <StatTile label="Record" value={recordText(record)} tone="accent" />
            <StatTile label={card.friend_count === 1 ? 'Friend' : 'Friends'} value={card.friend_count} />
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

      <SectionHeader title="Social" />
      <ListGroup>
        <ListRow icon="people" title="Friends & requests" onPress={() => router.push('/friends')} />
        <ListRow icon="images" title="My posts" onPress={() => router.push({ pathname: '/user/[id]', params: { id: userId } })} />
        {isOwner ? <ListRow icon="shield-half" tone="warning" title="Owner panel" subtitle="Users, usage, disputes and audit log" onPress={() => router.push('/admin')} /> : null}
      </ListGroup>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  heroContrast: { borderWidth: 1.5, borderColor: colors.textMuted },
  // Decorative band behind the avatar.
  cover: { height: 84, backgroundColor: colors.accentSoft, overflow: 'hidden' },
  coverMark: { position: 'absolute', right: -24, top: -30, opacity: 0.18, transform: [{ rotate: '-12deg' }] },
  heroBody: { paddingHorizontal: 18, paddingBottom: 18, gap: spacing.md },
  avatarRing: { marginTop: -48, alignSelf: 'flex-start', borderRadius: 999, borderWidth: 4, borderColor: colors.surface },
  identity: { gap: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  tiles: { flexDirection: 'row', gap: spacing.sm },
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
}));
