import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Icon, Text, useTheme, withAlpha } from '@driver/ui';
import { color } from '@driver/design-tokens';
import { MIcon } from '@/components/MIcon';
import { unlock } from '@/lib/alert-sound';
import { useT } from '@/lib/i18n';

/**
 * "طلب جديد!" — the loud strip over the board while new orders wait. Pulses with the chime; "سكّت
 * الصوت" silences the current ones (a newer order rings again). On the web the browser blocks sound
 * until a tap, so the strip offers "شغّل صوت الطلبات" first.
 */
export function NewOrderBanner({ count, soundBlocked, onSilence }: { count: number; soundBlocked: boolean; onSilence: () => void }) {
  const theme = useTheme();
  const t = useT();
  const p = useSharedValue(0);
  useEffect(() => {
    if (theme.reduceMotion) return;
    p.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(p);
  }, [p, theme.reduceMotion]);
  const bell = useAnimatedStyle(() => ({ transform: [{ rotate: `${(p.value - 0.5) * 24}deg` }] }));
  const glow = useAnimatedStyle(() => ({ opacity: 0.55 + p.value * 0.45 }));
  return (
    <View testID="new-order-banner" accessibilityLiveRegion="assertive" style={{ backgroundColor: theme.colors.accent, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[5], paddingVertical: theme.space[3] }}>
      <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: color.primary[400] }, glow]} />
      <Animated.View style={[{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.text, alignItems: 'center', justifyContent: 'center' }, bell]}>
        <Icon name="bell" size={22} color={theme.colors.surface} strokeWidth={2.2} />
      </Animated.View>
      <Text weight={700} style={{ flex: 1, fontSize: 22, lineHeight: 34, color: theme.colors.onAccent }}>
        {count > 1 ? t('merchant.board.alert_count', { count }) : t('merchant.board.alert_new')}
      </Text>
      {soundBlocked ? (
        <Pressable hitSlop={2} testID="sound-enable" accessibilityRole="button" onPress={unlock} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], height: 40, paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, backgroundColor: theme.colors.text }}>
          <MIcon name="volume" size={18} color={theme.colors.surface} />
          <Text variant="label" weight={700} style={{ color: theme.colors.surface }}>
            {t('merchant.sound.enable')}
          </Text>
        </Pressable>
      ) : (
        <Pressable hitSlop={2} testID="alarm-silence" onPress={onSilence} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], height: 40, paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, backgroundColor: withAlpha(theme.colors.text, 0.12) }}>
          <MIcon name="volume" size={18} color="text" />
          <Text variant="label" weight={700}>
            {t('merchant.board.alert_silence')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Store closed / paused / offline: a calm strip with the next step. */
export function InfoStrip({ tone, text, action, testID }: { tone: 'danger' | 'warning' | 'neutral'; text: string; action?: { label: string; onPress: () => void }; testID?: string }) {
  const theme = useTheme();
  const bg = tone === 'danger' ? theme.colors.dangerTint : tone === 'warning' ? theme.colors.warningTint : theme.colors.surfaceSunken;
  const fg = tone === 'danger' ? 'dangerText' : tone === 'warning' ? 'warningText' : 'text';
  return (
    <View testID={testID} style={{ backgroundColor: bg, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[5], paddingVertical: theme.space[2], minHeight: 48 }}>
      <MIcon name={tone === 'neutral' ? 'clock' : 'power'} size={18} color={fg} />
      <Text variant="label" weight={600} color={fg} style={{ flex: 1 }}>
        {text}
      </Text>
      {action ? (
        <Pressable hitSlop={4} accessibilityRole="button" onPress={action.onPress} style={{ height: 36, paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, justifyContent: 'center' }}>
          <Text variant="label" weight={700} color={fg}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
