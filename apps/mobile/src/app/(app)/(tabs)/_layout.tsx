'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs, useRouter } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUserId } from '@/features/auth/AuthProvider';
import { useRankedNeedsMe } from '@/features/ranked/api';
import { useFriends, useProfile } from '@/features/social/api';
import { Avatar } from '@/features/social/Avatar';
import { BrandLockup } from '@/ui/brand';
import { withPressFeedback } from '@/ui/components';
import { tapFeedback } from '@/ui/haptics';
import { colors, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';
import { headerFont } from '@/ui/typography';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * The bottom bar: icons only, like Instagram's, in MatIQ's Clean Pro style.
 * The tab you're on has a filled icon in a soft pill; Record is the "+" in
 * the middle; Ranked carries a red dot when a challenge or result needs you;
 * Profile shows your picture. Settings is behind the gear on Profile. Every
 * tab has a spoken name (`tabBarAccessibilityLabel`).
 */
export default function TabsLayout() {
  useTheme();
  const insets = useSafeAreaInsets();
  const userId = useUserId();
  const needsMe = useRankedNeedsMe(userId);
  const requests = (useFriends().data ?? []).filter((entry) => entry.direction === 'incoming').length;
  const profile = useProfile(userId).data;

  return (
    <Tabs
      screenListeners={{ tabPress: () => tapFeedback() }}
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        // No bright hairline under the header on a dark screen.
        headerShadowVisible: false,
        headerTitleAlign: 'left',
        headerTitleStyle: headerFont(26),
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          height: 58 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom + 4,
        },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Feed',
          tabBarAccessibilityLabel: 'Feed',
          headerTitle: () => <BrandLockup />,
          headerRight: () => (
            <HeaderButton icon="people-outline" label={requests > 0 ? `Friends, ${requests} new requests` : 'Friends'} href="/friends" dot={requests > 0} />
          ),
          tabBarIcon: ({ focused }) => <TabIcon name="home-outline" focusedName="home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="matches"
        options={{
          title: 'Matches',
          tabBarAccessibilityLabel: 'Matches',
          tabBarIcon: ({ focused }) => <MatchesIcon focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="record"
        options={{
          title: 'Record',
          tabBarAccessibilityLabel: 'Record a round',
          tabBarIcon: ({ focused }) => <RecordIcon focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="ranked"
        options={{
          title: 'Ranked',
          tabBarAccessibilityLabel: needsMe > 0 ? `Ranked, ${needsMe} need you` : 'Ranked',
          tabBarIcon: ({ focused }) => <TabIcon name="trophy-outline" focusedName="trophy" focused={focused} dot={needsMe > 0} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarAccessibilityLabel: 'Profile',
          headerRight: () => <HeaderButton icon="settings-outline" label="Settings" href="/settings" />,
          tabBarIcon: ({ focused }) => (
            <View style={[styles.avatarRing, focused && styles.avatarRingFocused]}>
              <Avatar path={profile?.avatar_path} name={profile?.display_name ?? ''} size={26} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

function Pill({ focused, children }: { focused: boolean; children: ReactNode }) {
  useTheme();
  return <View style={[styles.pill, focused && styles.pillFocused]}>{children}</View>;
}

function Dot() {
  useTheme();
  return <View style={styles.dot} aria-hidden />;
}

function TabIcon({ name, focusedName, focused, dot = false }: { name: IconName; focusedName: IconName; focused: boolean; dot?: boolean }) {
  useTheme();
  return (
    <Pill focused={focused}>
      <View>
        <Ionicons name={focused ? focusedName : name} size={24} color={focused ? colors.text : colors.textMuted} />
        {dot ? <Dot /> : null}
      </View>
    </Pill>
  );
}

/** A rounded square with a play triangle: your recorded rounds. */
function MatchesIcon({ focused }: { focused: boolean }) {
  useTheme();
  return (
    <Pill focused={focused}>
      <View style={[styles.square, focused ? styles.squareFocused : null]}>
        <Ionicons name="play" size={11} color={focused ? colors.background : colors.textMuted} style={styles.play} />
      </View>
    </Pill>
  );
}

/** The "+" in the middle of the bar. */
function RecordIcon({ focused }: { focused: boolean }) {
  useTheme();
  return (
    <View style={[styles.record, focused && styles.recordFocused]}>
      <Ionicons name="add" size={24} color={focused ? colors.accentText : colors.text} />
    </View>
  );
}

function HeaderButton({ icon, label, href, dot = false }: { icon: IconName; label: string; href: '/friends' | '/settings'; dot?: boolean }) {
  useTheme();
  const router = useRouter();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => router.push(href)} style={withPressFeedback(styles.headerButton)} hitSlop={4}>
      <View>
        <Ionicons name={icon} size={26} color={colors.text} />
        {dot ? <Dot /> : null}
      </View>
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  pill: { width: 58, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pillFocused: { backgroundColor: colors.surfaceHigh },
  dot: {
    position: 'absolute',
    right: -3,
    top: -2,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.background,
  },
  square: {
    width: 21,
    height: 21,
    borderRadius: 6,
    borderWidth: 1.8,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  squareFocused: { backgroundColor: colors.text, borderColor: colors.text },
  // Optical centre of the triangle.
  play: { marginLeft: 1 },
  record: { width: 42, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHigh },
  recordFocused: { backgroundColor: colors.accentFill },
  avatarRing: { padding: 2, borderRadius: 17, borderWidth: 1.5, borderColor: colors.control },
  avatarRingFocused: { borderColor: colors.text },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
}));
