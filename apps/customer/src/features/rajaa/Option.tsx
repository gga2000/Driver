import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, Text, useTheme, type IconName } from '@driver/ui';

/** A titled block on the الرجعة forms: small heading, optional hint, then the control. */
export function Section({ title, hint, children, testID }: { title: string; hint?: string; children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[3] }} testID={testID}>
      <View style={{ gap: 2 }}>
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        {hint ? (
          <Text variant="footnote" color="textMuted">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/**
 * Radio card (pickup choice, payment rail): icon, title, a line of detail, and children revealed
 * when selected (the rules of that choice, a note field).
 */
export function OptionCard({
  icon,
  title,
  detail,
  trailing,
  selected,
  disabled,
  onPress,
  children,
  testID,
}: {
  icon: IconName;
  title: string;
  detail?: string;
  trailing?: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  children?: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      aria-checked={selected}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={{
        borderRadius: theme.radius.lg,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.surface : theme.colors.surface,
        padding: theme.space[4],
        gap: theme.space[3],
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: selected ? theme.colors.accentTint : theme.colors.surfaceSunken,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={18} color={selected ? 'accentText' : 'textMuted'} strokeWidth={2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={600}>
            {title}
          </Text>
          {detail ? (
            <Text variant="caption" color="textMuted">
              {detail}
            </Text>
          ) : null}
        </View>
        {trailing ? (
          <Text variant="label" weight={600} tabular color={selected ? 'accentText' : 'textMuted'}>
            {trailing}
          </Text>
        ) : null}
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            borderWidth: 2,
            borderColor: selected ? theme.colors.accent : theme.colors.borderStrong,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.accent }} /> : null}
        </View>
      </View>
      {selected && children ? <View style={{ gap: theme.space[2] }}>{children}</View> : null}
    </Pressable>
  );
}

/** Plain rule list ("3 دقايق سماح بس…"): stated plainly, one line each. */
export function RuleList({ items, tone = 'textMuted' }: { items: readonly string[]; tone?: 'textMuted' | 'text' }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      {items.map((line) => (
        <View key={line} style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start' }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: theme.colors.borderStrong, marginTop: 9 }} />
          <Text variant="footnote" color={tone} style={{ flex: 1 }}>
            {line}
          </Text>
        </View>
      ))}
    </View>
  );
}
