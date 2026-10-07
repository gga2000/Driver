import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';
import type { RideSwitchQuote } from '@driver/contracts';
import { color as palette } from '@driver/design-tokens';
import { Button, Icon, Skeleton, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import type { RideVertical } from './logic';
import { TAXI_ART, TUKTUK_ART } from './vehicle-art';

const VEHICLE = { taxi: 'ride.vehicle_taxi', tuktuk: 'ride.vehicle_tuktuk' } as const;

/**
 * Three minutes and no driver (J-D7, L-03; ride idea m5): say so plainly and kindly, with a small
 * drawing of the vehicle asked for handing over to the other one, and offer the way out — the other
 * vehicle at the server's fare (the customer confirms it), keep searching, or cancel for free. While
 * the quote loads the card holds its place; without one (a driver took it meanwhile, the zone isn't
 * served) the drawing keeps only the asked vehicle and it offers keep searching and cancel.
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
      <SwitchArt asked={asked} other={quote?.vertical ?? null} />
      <View style={{ gap: 2 }}>
        <Text variant="bodyStrong" testID="ride-switch-title">
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
      {quote && other ? <Button label={t('ride.switch_yes', { vehicle: other })} fullWidth loading={switching} onPress={() => onSwitch(quote)} testID="ride-switch-yes" /> : null}
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        <Button label={t('ride.switch_keep')} variant="secondary" style={{ flex: 1 }} onPress={onKeep} disabled={switching} testID="ride-switch-keep" />
        <Button label={t('ride.switch_cancel')} variant="ghost" style={{ flex: 1 }} onPress={onCancel} disabled={switching} testID="ride-switch-cancel" />
      </View>
    </Animated.View>
  );
}

const ART = { taxi: TAXI_ART, tuktuk: TUKTUK_ART } as const;

/** The asked vehicle, quiet, and (when there is an offer) the other one, ready, with an arrow between. */
function SwitchArt({ asked, other }: { asked: RideVertical; other: RideVertical | null }) {
  const theme = useTheme();
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ height: 84, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[3], overflow: 'hidden' }}
      testID="ride-switch-art"
    >
      <View style={{ opacity: other ? 0.35 : 0.8 }}>
        <SvgXml xml={ART[asked]} width={other ? 76 : 92} height={other ? 76 : 92} />
      </View>
      {other ? (
        <>
          <Icon name="arrow-forward" size={20} color="textMuted" strokeWidth={2.4} />
          <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.delay(120).duration(theme.motion.duration.base)}>
            <SvgXml xml={ART[other]} width={92} height={92} />
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}
