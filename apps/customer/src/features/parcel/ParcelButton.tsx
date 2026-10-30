import { ActivityIndicator, Pressable, View } from 'react-native';
import { Icon, Text, useTheme, withAlpha, type IconName } from '@driver/ui';
import { parcelSwatch } from './palette';

/**
 * The parcel's own big button (concept A1 «دزّه · 2,000 دينار →»): henna with its ink, the word at the start,
 * an amount beside it and the way forward in a round end cap. Disabled reads as the surface, not a faded henna.
 */
export function ParcelButton({
  label,
  amount,
  onPress,
  disabled,
  loading,
  icon = 'arrow-forward',
  tone = 'henna',
  accessibilityHint,
  testID,
}: {
  label: string;
  amount?: string | null;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  /** `ink`: the dark pill (B2 «دز ثاني»), henna in the cap. */
  tone?: 'henna' | 'ink';
  accessibilityHint?: string;
  testID?: string;
}) {
  const theme = useTheme();
  const sw = parcelSwatch(theme);
  const off = disabled || loading;
  const bg = disabled ? theme.colors.surfaceSunken : tone === 'ink' ? theme.colors.inverse : sw.fill;
  const fg = disabled ? theme.colors.textMuted : tone === 'ink' ? theme.colors.onInverse : sw.on;
  const capBg = disabled ? theme.colors.border : tone === 'ink' ? sw.fill : withAlpha(sw.on, 0.95);
  const capFg = disabled ? theme.colors.textMuted : tone === 'ink' ? sw.on : sw.fill;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={amount ? `${label} ${amount}` : label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(loading) }}
      disabled={off}
      onPress={() => {
        theme.haptic('light');
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: 60,
        borderRadius: theme.radius.pill,
        backgroundColor: bg,
        flexDirection: 'row',
        alignItems: 'center',
        paddingStart: theme.space[5],
        paddingEnd: theme.space[2],
        gap: theme.space[3],
        opacity: pressed ? 0.92 : 1,
        transform: [{ scale: pressed && !theme.reduceMotion ? 0.985 : 1 }],
      })}
    >
      <Text variant="title" weight={700} color={fg} numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <View style={{ flex: 1 }} />
      {amount ? (
        <Text variant="bodyStrong" color={fg} tabular numberOfLines={1} testID={testID ? `${testID}-amount` : undefined}>
          {amount}
        </Text>
      ) : null}
      <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: capBg, alignItems: 'center', justifyContent: 'center' }}>
        {loading ? <ActivityIndicator color={capFg} /> : <Icon name={icon} size={22} color={capFg} strokeWidth={2.4} />}
      </View>
    </Pressable>
  );
}
