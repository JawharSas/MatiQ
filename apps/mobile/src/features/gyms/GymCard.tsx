'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Body, Button, Card, Heading } from '@/ui/components';
import { Text } from '@/ui/text';
import { colors, font, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';
import { useMyGym } from './api';

/** Your gym on your profile, or the way to join or start one. */
export function GymCard() {
  useTheme();
  const router = useRouter();
  const gym = useMyGym();
  if (gym.isPending) return null;

  if (!gym.data) {
    return (
      <Card>
        <Heading>Your gym</Heading>
        <Body muted>Join your gym with its code, or start one, to see your teammates' rounds and a gym leaderboard.</Body>
        <Button label="Join or start a gym" icon="people-outline" variant="secondary" onPress={() => router.push('/gym-join')} />
      </Card>
    );
  }

  const { name, city, member_count: members } = gym.data;
  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.badge} aria-hidden>
          <Ionicons name="shield" size={22} color={colors.accentText} />
        </View>
        <View style={styles.fill}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={font.caption}>{[city, `${members} ${members === 1 ? 'member' : 'members'}`].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>
      <Button label="Open gym" variant="secondary" size="sm" onPress={() => router.push('/gym')} />
    </Card>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  fill: { flex: 1 },
  badge: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.accentFill, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 18, fontWeight: '700', color: colors.text },
}));
