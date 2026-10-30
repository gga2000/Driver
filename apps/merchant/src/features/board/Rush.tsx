import { Pressable, View } from 'react-native';
import type { BoardOrder } from '@driver/contracts';
import { Button, CountdownRing, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { LADDER } from './ladder';

/**
 * The phone's sticky accept bar (S-M2, M-06), above the tab bar: the next order's ring and number with
 * "ارفض" and the one-tap "اقبل · 15 د" — Accept is never below the fold on a long or group order.
 */
export function StickyAcceptBar({ order, clock, oneTapMinutes, busy, noRing = false, onAccept, onReject, onOpen }: { order: BoardOrder; clock: () => number; oneTapMinutes: number; busy: boolean; noRing?: boolean; onAccept: () => void; onReject: () => void; onOpen: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID="sticky-accept"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        paddingHorizontal: theme.space[4],
        paddingVertical: theme.space[3],
        backgroundColor: theme.colors.surface,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        shadowColor: theme.colors.shadow,
        shadowOpacity: 0.12,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -4 },
        elevation: 8,
      }}
    >
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={t('merchant.detail.title', { number: order.number })} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 48 }}>
        {order.acceptBy && !noRing ? <CountdownRing mode="accept" startedAt={order.acceptBy.getTime() - 90_000} durationMs={90_000} urgentMs={LADDER.finalAtMs} clock={clock} size={40} strokeWidth={4} testID="sticky-ring" /> : null}
        <Text weight={700} tabular style={{ fontSize: 18, lineHeight: 26 }}>
          {t('merchant.card.number', { number: order.number })}
        </Text>
      </Pressable>
      <Button testID="sticky-reject" label={t('merchant.reject')} variant="secondary" size="lg" onPress={onReject} style={{ flex: 1, paddingHorizontal: theme.space[2] }} />
      <Button testID="sticky-accept-now" label={t('merchant.accept.one_tap_full', { minutes: oneTapMinutes })} size="lg" haptic="success" loading={busy} onPress={onAccept} style={{ flex: 2, paddingHorizontal: theme.space[2] }} />
    </View>
  );
}
