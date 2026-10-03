import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import type { BoardGroup, BoardOrder } from '@driver/contracts';
import { Button, CountdownRing, StatusPill, Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { clock12, secondsLeft } from '@/lib/time';
import { cardTiming, courierLine } from './logic';

export interface OrderCardProps {
  order: BoardOrder;
  /** Server time (ms). */
  now: number;
  /** Server clock for the accept ring. */
  clock: () => number;
  /** Still ringing (not accepted/rejected/silenced): pulses. */
  ringing?: boolean;
  /** Cap on item lines shown (the detail sheet shows all). */
  maxLines?: number;
  onAccept: () => void;
  onReject: () => void;
  onReady: () => void;
  onOpen: () => void;
  busyReady?: boolean;
}

/** Kitchen-ticket line: big quantity, the dish, modifiers muted, the note bold on a warm strip. */
function Line({ qty, name, modifiers, note, out }: { qty: number; name: string; modifiers: string[]; note: string | null; out: boolean }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ gap: 2, opacity: out ? 0.5 : 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
        <Text variant="title" weight={700} color="accentText" tabular style={{ minWidth: 30 }}>
          {`${qty}×`}
        </Text>
        <Text variant="bodyStrong" style={{ flex: 1, fontSize: 16, textDecorationLine: out ? 'line-through' : 'none' }}>
          {name}
        </Text>
        {out ? <StatusPill label={t('merchant.card.unavailable')} tone="danger" size="sm" /> : null}
      </View>
      {modifiers.length > 0 ? (
        <Text variant="footnote" color="textMuted" style={{ paddingStart: 38 }}>
          {modifiers.join(' · ')}
        </Text>
      ) : null}
      {note ? (
        <View style={{ marginStart: 38, alignSelf: 'flex-start', backgroundColor: theme.colors.warningTint, borderRadius: theme.radius.sm, paddingHorizontal: theme.space[2] }}>
          <Text variant="label" weight={700} style={{ color: theme.colors.text }}>
            {note}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function GroupHeader({ g, several }: { g: BoardGroup; several: boolean }) {
  const theme = useTheme();
  const t = useT();
  if (!several && g.kind === 'orderer') return null;
  const name = g.kind === 'orderer' ? t('merchant.card.orderer') : (g.label ?? t('merchant.card.orderer'));
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: g.kind === 'orderer' ? theme.colors.text : theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="caption" weight={700} style={{ color: g.kind === 'orderer' ? theme.colors.bg : theme.colors.onAccent, lineHeight: 18 }}>
            {name.slice(0, 1)}
          </Text>
        </View>
        <Text variant="label" weight={700}>
          {g.kind === 'orderer' ? name : t('merchant.per_person', { name })}
        </Text>
        <Text variant="caption" color="textMuted" tabular>
          {t('merchant.card.items', { count: g.itemCount })}
        </Text>
      </View>
      {g.note ? (
        <View style={{ marginStart: 30, alignSelf: 'flex-start', backgroundColor: theme.colors.warningTint, borderRadius: theme.radius.sm, paddingHorizontal: theme.space[2] }}>
          <Text variant="label" weight={700}>
            {g.note}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Items grouped by person; `maxLines` caps the card (the rest: "+3 أصناف ثانية"). */
export function OrderItems({ order, maxLines = 99 }: { order: BoardOrder; maxLines?: number }) {
  const theme = useTheme();
  const t = useT();
  const several = order.groups.length > 1;
  let shown = 0;
  let hidden = 0;
  const blocks = order.groups.map((g) => {
    const lines = g.lines.filter((l) => l.availability !== 'removed');
    const room = Math.max(0, maxLines - shown);
    const visible = lines.slice(0, room);
    shown += visible.length;
    hidden += lines.length - visible.length;
    if (visible.length === 0) return null;
    return (
      <View key={g.key} style={{ gap: theme.space[2] }}>
        <GroupHeader g={g} several={several} />
        <View style={{ gap: theme.space[2], paddingStart: several ? theme.space[1] : 0 }}>
          {visible.map((l) => (
            <Line key={l.lineId} qty={l.qty} name={l.name} modifiers={l.modifiers} note={l.note} out={l.availability === 'unavailable'} />
          ))}
        </View>
      </View>
    );
  });
  return (
    <View style={{ gap: theme.space[3] }}>
      {blocks}
      {hidden > 0 ? (
        <Text variant="footnote" color="accentText" weight={600}>
          {t('merchant.card.more_items', { count: hidden })}
        </Text>
      ) : null}
    </View>
  );
}

function usePulseBorder(active: boolean) {
  const p = useSharedValue(0);
  useEffect(() => {
    if (!active) {
      cancelAnimation(p);
      p.value = 0;
      return;
    }
    p.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(p);
  }, [active, p]);
  return useAnimatedStyle(() => ({ opacity: 0.35 + p.value * 0.65 }));
}

export function PaymentPill({ order }: { order: BoardOrder }) {
  const t = useT();
  const locale = useLocale();
  return order.paymentMethod === 'cash' ? (
    <StatusPill tone="warning" icon="wallet" label={`${t('merchant.card.cash')} · ${t('merchant.card.collect', { amount: iqd(order.collectCashIqd, { locale }) })}`} />
  ) : (
    <StatusPill tone="success" icon="check" label={t('merchant.card.prepaid')} />
  );
}

export function OrderCard({ order, now, clock, ringing = false, maxLines = 8, onAccept, onReject, onReady, onOpen, busyReady }: OrderCardProps) {
  const theme = useTheme();
  const t = useT();
  const isNew = order.column === 'new';
  const pulse = usePulseBorder(ringing && !theme.reduceMotion);
  const timing = cardTiming(order, now);
  const courier = courierLine(order.courier, now);
  const partialLeft = order.partial ? secondsLeft(order.partial.deadline, now) : 0;

  const timingPill =
    timing.kind === 'ready_in' ? (
      <StatusPill tone="accent" icon="clock" label={t('merchant.card.ready_in', { minutes: timing.minutes })} />
    ) : timing.kind === 'late' ? (
      <StatusPill tone="danger" icon="clock" live label={t('merchant.card.late', { minutes: timing.minutes })} />
    ) : timing.kind === 'ready_since' ? (
      <StatusPill tone="success" icon="check" label={timing.minutes < 1 ? t('merchant.card.ready_now') : t('merchant.card.ready_since', { minutes: timing.minutes })} />
    ) : null;

  return (
    <View testID={`order-${order.number}`} style={{ position: 'relative' }}>
      {isNew ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: -3,
              bottom: -3,
              start: -3,
              end: -3,
              borderRadius: theme.radius.xl + 3,
              borderWidth: 3,
              borderColor: theme.colors.accent,
            },
            pulse,
          ]}
        />
      ) : null}
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={t('merchant.detail.title', { number: order.number })}
        style={({ pressed }) => ({
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: order.late ? theme.colors.danger : theme.colors.border,
          padding: theme.space[4],
          gap: theme.space[3],
          shadowColor: isNew ? theme.colors.accent : theme.colors.shadow,
          shadowOpacity: isNew ? 0.22 : 0.07,
          shadowRadius: isNew ? 16 : 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: isNew ? 4 : 2,
          opacity: pressed ? 0.96 : 1,
        })}
      >
        {/* Header: big number + time; the accept ring on new orders. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight={700} tabular style={{ fontSize: 34, lineHeight: 44, letterSpacing: 0.5 }}>
              {t('merchant.card.number', { number: order.number })}
            </Text>
            <Text variant="footnote" color="textMuted" tabular>
              {[
                timing.kind === 'since' ? (timing.minutes < 1 ? t('merchant.card.just_now') : t('merchant.card.since', { minutes: timing.minutes })) : null,
                t('merchant.card.items', { count: order.itemCount }),
                order.groups.length > 1 ? t('merchant.detail.people', { count: order.groups.length }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          {isNew && order.acceptBy && !order.partial ? (
            <CountdownRing mode="accept" startedAt={order.acceptBy.getTime() - 90_000} durationMs={90_000} clock={clock} size={72} strokeWidth={6} testID={`ring-${order.number}`} />
          ) : (
            timingPill
          )}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          <PaymentPill order={order} />
          {order.scheduledFor ? <StatusPill tone="info" icon="clock" label={t('merchant.card.scheduled', { time: clock12(order.scheduledFor) })} /> : null}
          {order.catering ? <StatusPill tone="info" label={t('merchant.card.catering')} /> : null}
        </View>

        <View style={{ height: 1, backgroundColor: theme.colors.border }} />

        <OrderItems order={order} maxLines={maxLines} />

        {order.note ? (
          <View style={{ flexDirection: 'row', gap: theme.space[2], backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.md, padding: theme.space[3] }}>
            <MIcon name="note" size={18} color="textMuted" />
            <Text variant="label" weight={700} style={{ flex: 1 }}>
              {order.note}
            </Text>
          </View>
        ) : null}

        {order.partial ? (
          <StatusPill tone="warning" icon="clock" live label={t('merchant.card.partial_waiting', { seconds: partialLeft })} />
        ) : courier ? (
          <StatusPill tone={courier.tone} icon="bike" live={courier.live} label={t(courier.key, courier.params)} />
        ) : null}

        {isNew && !order.partial ? (
          <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
            <Button testID={`reject-${order.number}`} label={t('merchant.reject')} variant="secondary" size="lg" onPress={onReject} style={{ flex: 1 }} />
            <Button testID={`accept-${order.number}`} label={t('merchant.accept')} size="lg" haptic="medium" onPress={onAccept} style={{ flex: 2 }} />
          </View>
        ) : order.column === 'preparing' ? (
          <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
            <Button label={t('merchant.card.details')} variant="secondary" size="lg" onPress={onOpen} style={{ flex: 1 }} />
            <Button testID={`ready-${order.number}`} label={t('merchant.card.mark_ready')} icon="check" size="lg" haptic="success" loading={busyReady} onPress={onReady} style={{ flex: 2 }} />
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}
