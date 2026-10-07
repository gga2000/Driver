import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { OrderTracking } from '@driver/contracts';
import { Icon, ltr, Text, useTheme, useToast } from '@driver/ui';
import type { Phase } from '@/features/track/timeline';
import { useT } from '@/lib/i18n';
import { rideNearAt } from './safety';

/** The trip code's height in the collapsed sheet (two lines of text beside the digits, plus padding). */
export const TRIP_CODE_H = 84;

/**
 * s1 «رمز المشوار» (ride step 3): on a night ride, the 4 digits the rider tells the driver before
 * getting in. Big and calm in the collapsed sheet from the search until the ride starts; the driver
 * never sees them, so he has to ask. Read out digit by digit to screen readers.
 */
export function TripCodeCard({ code }: { code: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID="ride-trip-code"
      accessible
      accessibilityLabel={t('ride.trip_code_a11y', { digits: code.split('').join(' ') })}
      style={{
        minHeight: TRIP_CODE_H - theme.space[3],
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingVertical: theme.space[2],
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.accentTint,
      }}
    >
      <Icon name="lock" size={20} color="accentText" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight={700}>
          {t('ride.trip_code_title')}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={2}>
          {t('ride.trip_code_hint')}
        </Text>
      </View>
      <View style={{ paddingHorizontal: theme.space[3], paddingVertical: theme.space[1], borderRadius: theme.radius.md, backgroundColor: theme.colors.surface }}>
        <Text variant="numeralMd" weight={700} tabular style={{ letterSpacing: 6 }}>
          {ltr(code)}
        </Text>
      </View>
    </View>
  );
}

/**
 * d3 «السايق قريب، اطلع هسة»: the same moment as the push, on the open screen — one toast and one buzz
 * per ride, when the server stamps the pickup (the one ETA put him a minute away).
 */
export function useRideNearToast(v: OrderTracking | undefined, phase: Phase | null): void {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const said = useRef<string | null>(null);
  const nearAt = rideNearAt(v, phase);
  const orderId = v?.order.id ?? null;
  useEffect(() => {
    if (!orderId || !nearAt || said.current === orderId) return;
    said.current = orderId;
    theme.haptic('medium');
    toast.show({ message: t('ride.near_toast'), tone: 'info', icon: 'car' });
    // `theme`, `toast` and `t` are stable for the screen's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, nearAt]);
}
