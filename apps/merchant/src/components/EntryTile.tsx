import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Text, useTheme } from '@driver/ui';
import { MIcon, type MIconName } from './MIcon';

/** A big tappable row for hubs (المزيد, settings): icon in a soft square, title, hint, end node. */
export function EntryTile({ icon, title, hint, onPress, trailing, tone = 'default', testID }: { icon: MIconName; title: string; hint?: string; onPress?: () => void; trailing?: ReactNode; tone?: 'default' | 'danger'; testID?: string }) {
  const theme = useTheme();
  const danger = tone === 'danger';
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[4],
        padding: theme.space[4],
        minHeight: 76,
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: danger ? theme.colors.dangerTint : theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
        <MIcon name={icon} size={24} color={danger ? 'dangerText' : 'accentText'} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" color={danger ? 'dangerText' : 'text'} style={{ fontSize: 16 }}>
          {title}
        </Text>
        {hint ? (
          <Text variant="footnote" color="textMuted">
            {hint}
          </Text>
        ) : null}
      </View>
      {trailing ?? (onPress ? <MIcon name="chevron-forward" size={20} color="textMuted" /> : null)}
    </Pressable>
  );
}
