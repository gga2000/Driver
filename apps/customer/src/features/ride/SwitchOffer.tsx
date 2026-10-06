import { View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import type { RideSwitchQuote } from '@driver/contracts';
import { color as palette } from '@driver/design-tokens';
import { Button, Icon, Skeleton, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import type { RideVertical } from './logic';

const VEHICLE = { taxi: 'ride.vehicle_taxi', tuktuk: 'ride.vehicle_tuktuk' } as const;

/**
 * Three minutes and no driver (J-D7, L-03): say so plainly and offer the way out — the other vehicle
 * at the server's fare (the customer confirms it), keep searching, or cancel for free. While the
 * quote loads the card holds its place; without one (a driver took it meanwhile, the zone isn't
 * served) it offers only keep searching and cancel.
 */
export function SwitchOfferCard({
  asked,
  quote,
  loading,
  switching,
  onSwitch,
  onKeep,
  onCancel,
}: {
  asked: RideVertical;
  quote: RideSwitchQuote | undefined;
  loading: boolean;
  switching: boolean;
  onSwitch: (q: RideSwitchQuote) => void;
  onKeep: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const other = quote ? t(VEHICLE[quote.vertical]) : null;
  return (
    <Animated.View
      testID="ride-switch-offer"
      accessibilityLiveRegion="polite"
      entering={theme.reduceMotion ? undefined : FadeInDown.duration(theme.motion.duration.base)}
      exiting={theme.reduceMotion ? undefined : FadeOut.duration(theme.motion.duration.fast)}
      style={{
        gap: theme.space[3],
        padding: theme.space[4],
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        shadowColor: palette.neutral[1000],
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 4,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentTint }}>
          <Icon name={quote?.vertical === 'tuktuk' ? 'tuktuk' : quote ? 'car' : 'search'} size={20} color="accentText" strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={700} testID="ride-switch-title">
            {t('ride.switch_title', { vehicle: t(VEHICLE[asked]) })}
          </Text>
          {loading ? (
            <Skeleton width="80%" height={16} />
          ) : (
            <Text variant="footnote" color="textMuted" testID="ride-switch-body">
              {quote && other ? t('ride.switch_body', { vehicle: other, amount: amountParam(quote.totalIqd) }) : t('ride.switch_none_body')}
            </Text>
          )}
        </View>
      </View>
      {quote && other ? <Button label={t('ride.switch_yes', { vehicle: other })} fullWidth loading={switching} onPress={() => onSwitch(quote)} testID="ride-switch-yes" /> : null}
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        <Button label={t('ride.switch_keep')} variant="secondary" style={{ flex: 1 }} onPress={onKeep} disabled={switching} testID="ride-switch-keep" />
        <Button label={t('ride.switch_cancel')} variant="ghost" style={{ flex: 1 }} onPress={onCancel} disabled={switching} testID="ride-switch-cancel" />
      </View>
    </Animated.View>
  );
}
