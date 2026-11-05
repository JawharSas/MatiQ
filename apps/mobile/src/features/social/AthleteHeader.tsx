'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from '@/ui/text';
import { colors, font, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';
import { CONDENSED } from '@/ui/typography';
import { Avatar } from './Avatar';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface AthleteHeaderProps {
  avatarPath: string | null | undefined;
  displayName: string;
  username: string;
  /** Counts beside the picture ("12 Matches"). */
  stats?: readonly { label: string; value: string | number }[];
  /** Short facts after the username ("Private", "Owner"). */
  tags?: readonly { label: string; icon: IconName }[];
  bio?: string | null;
  /** Shown in place of an empty bio (on your own profile). */
  bioPlaceholder?: string;
  /** Buttons under the header. */
  children?: ReactNode;
}

/**
 * The top of a profile, like a fighter's card: the picture with the counts
 * beside it, then the name, @username and tags, the bio, and the actions.
 */
export function AthleteHeader({ avatarPath, displayName, username, stats = [], tags = [], bio, bioPlaceholder, children }: AthleteHeaderProps) {
  useTheme();
  return (
    <View style={styles.header}>
      <View style={styles.top}>
        <Avatar path={avatarPath} name={displayName} size={84} />
        {stats.length > 0 ? (
          <View style={styles.stats}>
            {stats.map((stat) => (
              <View key={stat.label} style={styles.stat} accessible accessibilityLabel={`${stat.value} ${stat.label}`}>
                <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                  {stat.value}
                </Text>
                <Text style={styles.statLabel} numberOfLines={1}>
                  {stat.label}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Identity displayName={displayName} username={username} tags={tags} beside />
        )}
      </View>
      {stats.length > 0 ? <Identity displayName={displayName} username={username} tags={tags} /> : null}
      {bio ? <Text style={font.body}>{bio}</Text> : bioPlaceholder ? <Text style={font.caption}>{bioPlaceholder}</Text> : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

function Identity({ displayName, username, tags, beside = false }: { displayName: string; username: string; tags: AthleteHeaderProps['tags'] & {}; beside?: boolean }) {
  useTheme();
  return (
    <View style={[styles.identity, beside && styles.identityBeside]}>
      <Text style={styles.name} numberOfLines={2}>
        {displayName}
      </Text>
      <View style={styles.meta}>
        <Text style={font.caption}>@{username}</Text>
        {tags.map((tag) => (
          <View key={tag.label} style={styles.tag}>
            <Ionicons name={tag.icon} size={13} color={colors.textMuted} aria-hidden />
            <Text style={font.caption}>{tag.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  header: { gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  stats: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center', minWidth: 64, flexShrink: 1 },
  statValue: { fontFamily: CONDENSED, fontWeight: '800', fontSize: 26, lineHeight: 30, color: colors.text, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 13, color: colors.textMuted },
  identity: { gap: 2 },
  identityBeside: { flex: 1 },
  name: { fontSize: 20, lineHeight: 26, fontWeight: '700', color: colors.text },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.md, rowGap: 2 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
}));
