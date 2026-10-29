import { Image, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { colors } from '@/ui/theme';
import { useAvatarUrl } from './avatar';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts.at(-1)![0]}` : (parts[0]?.slice(0, 2) ?? '?');
  return letters.toUpperCase();
}

/** Profile picture through a short-lived signed URL, with an initials fallback. */
export function Avatar({ path, name, size = 40 }: { path: string | null | undefined; name: string; size?: number }) {
  const url = useAvatarUrl(path);
  const shape = { width: size, height: size, borderRadius: size / 2 };
  if (url.data) {
    return <Image source={{ uri: url.data }} style={[styles.image, shape]} accessibilityIgnoresInvertColors accessible={false} />;
  }
  return (
    // Decorative: the name is always shown next to it, so screen readers skip the initials.
    <View style={[styles.fallback, shape]} accessible={false} aria-hidden importantForAccessibility="no-hide-descendants">
      <Text style={[styles.initials, { fontSize: Math.round(size * 0.38) }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.surfaceRaised },
  fallback: { backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.textMuted, fontWeight: '700' },
});
