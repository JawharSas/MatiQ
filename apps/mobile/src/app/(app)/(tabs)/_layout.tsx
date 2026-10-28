import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { BrandLockup } from '@/ui/brand';
import { colors } from '@/ui/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

function tabIcon(name: IconName, focusedName: IconName) {
  return ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
    <Ionicons name={focused ? focusedName : name} size={size} color={typeof color === 'string' ? color : colors.textMuted} />
  );
}

export default function TabsLayout() {
  // Room for icon + label above the home indicator on every platform.
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        // No bright hairline under the header on a dark screen.
        headerShadowVisible: false,
        headerTitleAlign: 'left',
        headerTitleStyle: { fontSize: 22, fontWeight: '800' },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 64 + insets.bottom,
          paddingTop: 4,
          paddingBottom: insets.bottom + 4,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Feed', headerTitle: () => <BrandLockup />, tabBarIcon: tabIcon('newspaper-outline', 'newspaper') }}
      />
      <Tabs.Screen name="record" options={{ title: 'Analyze', tabBarIcon: tabIcon('videocam-outline', 'videocam') }} />
      <Tabs.Screen name="ranked" options={{ title: 'Ranked', tabBarIcon: tabIcon('trophy-outline', 'trophy') }} />
      <Tabs.Screen name="matches" options={{ title: 'Matches', tabBarIcon: tabIcon('stats-chart-outline', 'stats-chart') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('person-circle-outline', 'person-circle') }} />
    </Tabs>
  );
}
