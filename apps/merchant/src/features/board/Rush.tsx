import { Pressable, View } from 'react-native';
import type { BoardOrder } from '@driver/contracts';
import { Button, CountdownRing, Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { useT } from '@/lib/i18n';
import { LADDER } from './ladder';
import { hasAllergy } from './logic';

/**
 * Rush queue (signature S-M2, M-05): on a tablet with three or more orders waiting, one chip per new
 * order at the top of "جديد" — ticket number, a mini countdown ring and the dish count — in answer
 * order (least time left first). All of them fit at once, however many there are; tapping a chip
 * opens that ticket in the column below.
 */
export function RushQueue({ orders, clock, selectedId, onPick }: { orders: readonly BoardOrder[]; clock: () => number; selectedId: string | null; onPick: (o: BoardOrder) => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="rush-queue" accessibilityLabel={t('merchant.rush.queue_a11y', { count: orders.length })} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: theme.space[3] }}>
      {orders.map((o) => {
        const selected = o.id === selectedId;
        const allergy = hasAllergy(o);
        return (
          <Pressable
            key={o.id}
            testID={`rush-chip-${o.number}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={t('merchant.rush.chip_a11y', { number: o.number, count: o.itemCount })}
            onPress={() => {
              theme.haptic('light');
              onPick(o);
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              minHeight: 44,
              paddingStart: 4,
              paddingEnd: theme.space[3],
              borderRadius: theme.radius.pill,
              backgroundColor: selected ? theme.colors.accentTint : theme.colors.surface,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? theme.colors.accent : theme.colors.borderStrong,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            {o.acceptBy && !o.partial ? (
              <CountdownRing mode="accept" startedAt={o.acceptBy.getTime() - 90_000} durationMs={90_000} urgentMs={LADDER.urgentAtMs} clock={clock} size={34} strokeWidth={4} testID={`rush-ring-${o.number}`} />
            ) : (
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.colors.warningTint, alignItems: 'center', justifyContent: 'center' }}>
                <MIcon name="hourglass" size={16} color="warningText" />
              </View>
            )}
            <View>
              <Text variant="bodyStrong" tabular style={{ lineHeight: 20 }}>
                {`#${o.number}`}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                {allergy ? <MIcon name="alert" size={12} color="dangerText" strokeWidth={2.4} /> : null}
                <Text variant="caption" color={allergy ? 'dangerText' : 'textMuted'} tabular style={{ lineHeight: 16 }}>
                  {t('merchant.card.items', { count: o.itemCount })}
                </Text>
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The phone's sticky accept bar (S-M2, M-06), above the tab bar: the next order's ring and number with
 * "ارفض" and the one-tap "اقبل · 15 د" — Accept is never below the fold on a long or group order.
 */
export function StickyAcceptBar({ order, clock, oneTapMinutes, busy, onAccept, onReject, onOpen }: { order: BoardOrder; clock: () => number; oneTapMinutes: number; busy: boolean; onAccept: () => void; onReject: () => void; onOpen: () => void }) {
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
        {order.acceptBy ? <CountdownRing mode="accept" startedAt={order.acceptBy.getTime() - 90_000} durationMs={90_000} urgentMs={LADDER.urgentAtMs} clock={clock} size={40} strokeWidth={4} testID="sticky-ring" /> : null}
        <Text weight={700} tabular style={{ fontSize: 18, lineHeight: 26 }}>
          {`#${order.number}`}
        </Text>
      </Pressable>
      <Button testID="sticky-reject" label={t('merchant.reject')} variant="secondary" size="lg" onPress={onReject} style={{ flex: 1, paddingHorizontal: theme.space[2] }} />
      <Button testID="sticky-accept-now" label={t('merchant.accept.one_tap', { minutes: oneTapMinutes })} size="lg" haptic="success" loading={busy} onPress={onAccept} style={{ flex: 2, paddingHorizontal: theme.space[2] }} />
    </View>
  );
}
