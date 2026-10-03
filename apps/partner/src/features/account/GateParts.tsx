import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { Icon, Text, useTheme, withAlpha } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { Glyph } from './Glyph';
import type { GateKind } from './logic';

const ROUTE: Record<GateKind, '/checkin' | '/documents'> = { checkin: '/checkin', locked: '/checkin', document: '/documents' };

/**
 * Home banner while the online gate is closed: "سوّي التسجيل اليومي" (accent), the day's lock-out or an
 * expired document (danger). One tap to the screen that fixes it.
 */
export function GateBanner({ kind }: { kind: GateKind }) {
  const theme = useTheme();
  const t = useT();
  const danger = kind !== 'checkin';
  const title = kind === 'checkin' ? t('partner.gate_checkin_banner') : kind === 'locked' ? t('partner.gate_locked_banner') : t('partner.gate_doc_banner');
  const sub = kind === 'checkin' ? t('partner.gate_checkin_banner_sub') : kind === 'locked' ? t('partner.gate_locked_banner_sub') : t('partner.gate_doc_banner_sub');
  return (
    <Pressable
      testID={`gate-banner-${kind}`}
      accessibilityRole="button"
      onPress={() => {
        theme.haptic('light');
        router.push(ROUTE[kind]);
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[3],
        borderRadius: theme.radius.lg,
        backgroundColor: danger ? theme.colors.dangerTint : theme.colors.accentTint,
        borderWidth: 1,
        borderColor: withAlpha(danger ? theme.colors.danger : theme.colors.accent, 0.35),
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: danger ? theme.colors.danger : theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Glyph name={kind === 'checkin' ? 'face' : kind === 'locked' ? 'lock' : 'id-card'} size={22} color={danger ? '#FFFFFF' : theme.colors.onAccent} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="label" weight={700} color={danger ? 'dangerText' : 'accentText'}>
          {title}
        </Text>
        <Text variant="caption" color="text">
          {sub}
        </Text>
      </View>
      {kind !== 'locked' ? <Icon name="chevron-forward" size={20} color={danger ? 'dangerText' : 'accentText'} strokeWidth={2.4} /> : null}
    </Pressable>
  );
}

/**
 * The online switch while the gate is closed: a locked track that says why. A tap shakes it and opens
 * the screen that unlocks it (check-in or documents) — it never pretends to go online.
 */
export function BlockedSwitch({ kind }: { kind: GateKind }) {
  const theme = useTheme();
  const t = useT();
  const shake = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const label = kind === 'checkin' ? t('partner.switch_blocked_checkin') : kind === 'locked' ? t('partner.switch_blocked_locked') : t('partner.switch_blocked_doc');
  return (
    <View style={{ gap: theme.space[2] }}>
      <Pressable
        testID="online-switch-blocked"
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        accessibilityLabel={label}
        accessibilityHint={t('partner.switch_blocked_hint')}
        onPress={() => {
          theme.haptic('warning');
          if (!theme.reduceMotion) shake.value = withSequence(withTiming(-8, { duration: 50 }), withTiming(8, { duration: 70 }), withTiming(-5, { duration: 60 }), withTiming(0, { duration: 60 }));
          if (kind !== 'locked') router.push(ROUTE[kind]);
        }}
      >
        <Animated.View
          style={[
            { height: 72, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceSunken, borderWidth: 1.5, borderColor: theme.colors.border, justifyContent: 'center', paddingStart: 72, paddingEnd: theme.space[5] },
            style,
          ]}
        >
          <View style={{ position: 'absolute', start: 7, width: 58, height: 58, borderRadius: 29, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border }}>
            <Glyph name="lock" size={24} color="textMuted" strokeWidth={2.2} />
          </View>
          <Text variant="title" weight={700} color="textMuted" align="center" numberOfLines={1} style={{ fontSize: 17 }}>
            {label}
          </Text>
        </Animated.View>
      </Pressable>
      {kind !== 'locked' ? (
        <Text variant="caption" color="textMuted" align="center">
          {t('partner.switch_blocked_hint')}
        </Text>
      ) : null}
    </View>
  );
}
