import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { PartnerMerchantPrep, PartnerPay } from '@driver/contracts';
import type { PartnerServiceColor } from '@driver/design-tokens';
import { Icon, Text, useTheme, type IconName } from '@driver/ui';
import { PAY_KEY } from '@/features/work/logic';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * The order slip's parts (partner redesign o1–o13): the service band with the cash chip, the time bar,
 * the money's named parts as chips, the kitchen time, and the one-line notes.
 */

export const SERVICE_ICON: Record<'food' | 'taxi' | 'tuktuk' | 'trips', IconName> = { food: 'food', taxi: 'taxi', tuktuk: 'tuktuk', trips: 'rajaa' };

/** o1 + o8: the top of the slip in the service's colour — what it is, and the cash to collect in a dark chip. */
export function SlipBand({ color, icon, kind, isNew, cash, prepaid }: { color: PartnerServiceColor; icon: IconName; kind: string; isNew: string; cash: string | null; prepaid: string | null }) {
  const theme = useTheme();
  return (
    <View testID="slip-band" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[5], paddingTop: theme.space[4], paddingBottom: theme.space[3], backgroundColor: color.fill }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: color.on, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={22} color={color.fill} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="caption" weight={600} style={{ color: color.on, opacity: 0.85 }}>
          {isNew}
        </Text>
        <Text variant="title" weight={700} style={{ color: color.on }} numberOfLines={1}>
          {kind}
        </Text>
      </View>
      {cash ? (
        <View testID="offer-cash" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.inverse, borderRadius: 999, paddingHorizontal: theme.space[3], minHeight: 36 }}>
          <Icon name="cash" size={18} color="onInverse" strokeWidth={2} />
          <Text variant="label" weight={700} color="onInverse" tabular>
            {cash}
          </Text>
        </View>
      ) : prepaid ? (
        <View testID="offer-cash" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.surface, borderRadius: 999, paddingHorizontal: theme.space[3], minHeight: 36 }}>
          <Icon name="check" size={16} color="successText" strokeWidth={2.4} />
          <Text variant="label" weight={700} color="successText">
            {prepaid}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * o6: the time left as a bar across the slip, draining toward the start edge in one smooth linear run
 * (re-synced only on drift), turning danger in the last seconds.
 */
export function TimeBar({ share, remainingMs, urgent, ink, label }: { share: number; remainingMs: number; urgent: boolean; ink: string; label: string }) {
  const theme = useTheme();
  const w = useSharedValue(share);
  useEffect(() => {
    if (theme.reduceMotion) {
      w.value = share;
      return;
    }
    if (Math.abs(w.value - share) > 0.04 || remainingMs <= 0) w.value = share;
    w.value = withTiming(0, { duration: Math.max(0, remainingMs), easing: Easing.linear });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.round(share * 20), theme.reduceMotion]);
  const style = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(1, w.value)) * 100}%` }));
  return (
    <View testID="slip-time" accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }} style={{ height: 6, backgroundColor: theme.colors.surfaceSunken }}>
      <Animated.View style={[{ height: 6, backgroundColor: urgent ? theme.colors.danger : ink, borderTopEndRadius: 3, borderBottomEndRadius: 3 }, style]} />
    </View>
  );
}

/** o2: the money's named parts as chips under it («توصيل 1,500» «ليل +250»). */
export function PayChips({ pay }: { pay: PartnerPay }) {
  const theme = useTheme();
  const t = useT();
  if (pay.components.length <= 1 && pay.takePct === null) return null;
  return (
    <View testID="pay-chips" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {pay.components.length > 1
        ? pay.components.map((c, i) => {
            const bonus = c.key === 'pickup_compensation' || c.key === 'batch_bonus' || c.key === 'tip' || c.key === 'peak' || c.key === 'night' || c.key === 'weather';
            return (
              <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 10, minHeight: 28, backgroundColor: bonus && i > 0 ? theme.colors.accentTint : theme.colors.surfaceSunken }}>
                <Text variant="caption" color={bonus && i > 0 ? 'accentText' : 'textMuted'}>
                  {t(PAY_KEY[c.key])}
                </Text>
                <Text variant="caption" weight={700} tabular color={bonus && i > 0 ? 'accentText' : 'text'}>
                  {amountParam(c.amountIqd, { sign: i > 0 })}
                </Text>
              </View>
            );
          })
        : null}
      {pay.takePct !== null ? (
        <View style={{ justifyContent: 'center', minHeight: 28 }}>
          <Text variant="caption" color="textMuted" tabular>
            {t('partner.offer_take', { pct: pay.takePct })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** o9: the kitchen's time, big enough to read in a glance: «جاهز بعد 9 دقيقة» / «جاهز للاستلام». */
export function KitchenTime({ prep }: { prep: PartnerMerchantPrep }) {
  const theme = useTheme();
  const t = useT();
  const ready = prep.state === 'ready' || prep.state === 'picked_up';
  const label = ready ? t('partner.offer_prep_ready') : prep.state === 'preparing' ? (prep.readyInMin ? t('partner.offer_prep_preparing', { minutes: prep.readyInMin }) : t('partner.offer_prep_cooking')) : t('partner.offer_prep_waiting');
  return (
    <View testID="prep-pill" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: theme.space[3], minHeight: 36, backgroundColor: ready ? theme.colors.successTint : theme.colors.warningTint }}>
      <Icon name={ready ? 'check' : 'clock'} size={18} color={ready ? 'successText' : 'warningText'} strokeWidth={2.2} />
      <Text variant="label" weight={700} color={ready ? 'successText' : 'warningText'} tabular>
        {label}
      </Text>
    </View>
  );
}

/** One note on the slip (second order, nudge, AC, cargo…): an icon, a bold line and an optional second. */
export function SlipNote({ testID, icon, title, body, bg, ink, enter = true }: { testID: string; icon: IconName; title: string; body?: string | null; bg: string; ink: string; enter?: boolean }) {
  const theme = useTheme();
  return (
    <Animated.View entering={enter && !theme.reduceMotion ? FadeInDown.duration(240) : undefined} testID={testID} style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center', backgroundColor: bg, borderRadius: 16, paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], minHeight: 48 }}>
      <Icon name={icon} size={20} color={ink} strokeWidth={2.3} />
      <View style={{ flex: 1 }}>
        <Text variant="label" weight={700} style={{ color: ink }} tabular>
          {title}
        </Text>
        {body ? (
          <Text variant="caption" color="textMuted" tabular>
            {body}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}
