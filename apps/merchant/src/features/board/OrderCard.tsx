import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { BoardGroup, BoardOrder } from '@driver/contracts';
import { Button, CountdownRing, Icon, StatusPill, Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { useLocale, useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { iqd } from '@/lib/money';
import { clock12, secondsLeft } from '@/lib/time';
import type { AlarmStage } from './ladder';
import { LADDER } from './ladder';
import { PickupCode } from './CourierRadar';
import { canExtendPrep, cardTiming, courierLine, hasAllergy } from './logic';

export interface OrderCardProps {
  order: BoardOrder;
  /** Server time (ms). */
  now: number;
  /** Server clock for the accept ring. */
  clock: () => number;
  /** Still ringing (not accepted/rejected/snoozed): pulses. */
  ringing?: boolean;
  /** Its own alarm stage: in the last 30 s the border and ring turn danger and the card breathes. */
  stage?: AlarmStage | null;
  /** Cap on item lines shown (the detail sheet shows all). */
  maxLines?: number;
  /** One-tap accept (M-12): the store's usual prep time, busy minutes included, shown on the button. */
  oneTapMinutes?: number;
  /** One tap: accept with the usual time. Without it the button opens the time sheet (`onAccept`). */
  onAcceptNow?: () => void;
  /** Opens the time sheet (other prep times, partial accept). */
  onAccept: () => void;
  onReject: () => void;
  onReady: () => void;
  onOpen: () => void;
  /** "+5 د" once after accepting (M-12). */
  onExtend?: () => void;
  busyReady?: boolean;
  busyAccept?: boolean;
  busyExtend?: boolean;
  /**
   * Rush (M-05): a compact ticket — number, ring, payment, "5 صنف · 3 أشخاص", Accept/Reject. Tapping
   * it calls `onExpand` (the full ticket) instead of opening the detail sheet.
   */
  compact?: boolean;
  onExpand?: () => void;
}

/** "حساسية" on the card header when any kitchen note mentions an allergy (M-09): impossible to miss. */
export function AllergyPill({ testID }: { testID?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID={testID} accessibilityRole="text" accessibilityLabel={t('merchant.card.allergy_a11y')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, backgroundColor: theme.colors.danger }}>
      <MIcon name="alert" size={16} color={theme.colors.onDanger} strokeWidth={2.2} />
      <Text variant="footnote" weight={700} style={{ color: theme.colors.onDanger }} numberOfLines={1}>
        {t('merchant.card.allergy')}
      </Text>
    </View>
  );
}

/** The kitchen note block: muted, or on the danger tint when it carries an allergy. */
export function KitchenNote({ note, testID }: { note: string; testID?: string }) {
  const theme = useTheme();
  const allergy = hasAllergy({ note, groups: [] });
  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: theme.space[2], backgroundColor: allergy ? theme.colors.dangerTint : theme.colors.surfaceSunken, borderRadius: theme.radius.md, padding: theme.space[3] }}>
      <MIcon name={allergy ? 'alert' : 'note'} size={18} color={allergy ? 'dangerText' : 'textMuted'} />
      <Text variant="label" weight={700} color={allergy ? 'dangerText' : 'text'} style={{ flex: 1 }}>
        {note}
      </Text>
    </View>
  );
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

function usePulseBorder(active: boolean, fast: boolean) {
  const p = useSharedValue(0);
  useEffect(() => {
    if (!active) {
      cancelAnimation(p);
      p.value = 0;
      return;
    }
    p.value = withRepeat(withTiming(1, { duration: fast ? 450 : 900, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(p);
  }, [active, fast, p]);
  return useAnimatedStyle(() => ({ opacity: 0.35 + p.value * 0.65 }));
}

/** Last 30 s: the card swells 1.00 → 1.02 in 180 ms (ease-out) with each 2-s chime; off with reduce motion. */
function useBreath(active: boolean) {
  const p = useSharedValue(0);
  useEffect(() => {
    if (!active) {
      cancelAnimation(p);
      p.value = 0;
      return;
    }
    const swell = withSequence(withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) }), withTiming(0, { duration: 1640 }));
    p.value = withRepeat(swell, -1, false);
    return () => cancelAnimation(p);
  }, [active, p]);
  return useAnimatedStyle(() => ({ transform: [{ scale: 1 + p.value * 0.02 }] }));
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

/**
 * The width a ticket number needs on one line: tabular digits and «#» are ~0.6 em in IBM Plex Sans,
 * plus the letter spacing, with a little room. Keeps «#5427» from being squeezed into a column.
 */
export function numberMinWidth(label: string, fontSize: number): number {
  return Math.ceil(label.length * (fontSize * 0.62 + 0.5)) + 4;
}

export function OrderCard(props: OrderCardProps) {
  const { order, now, clock, ringing = false, stage = null, maxLines = 8, oneTapMinutes, onAcceptNow, onAccept, onReject, onReady, onOpen, onExtend, busyReady, busyAccept, busyExtend, compact = false, onExpand } = props;
  const theme = useTheme();
  const t = useT();
  const { wide, width } = useLayout();
  /** Three board columns under 1000 px leave a card ~190 px inside: the ticket number steps down. */
  const tight = wide && width < 1000;
  /** Under 1200 px the board's columns are too narrow for a row of three buttons. */
  const narrowBoard = wide && width < 1200;
  const numberLabel = t('merchant.card.number', { number: order.number });
  const numberType = theme.type[tight ? 'amount' : 'numeralSm'];
  const isNew = order.column === 'new';
  const allergy = hasAllergy(order);
  const hot = isNew && (stage === 'urgent' || stage === 'final');
  const pulse = usePulseBorder(ringing && !theme.reduceMotion, hot);
  const breath = useBreath(ringing && hot && !theme.reduceMotion);
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

  const acceptButtons = (size: 'md' | 'lg') => (
    <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center' }}>
      <Button testID={`reject-${order.number}`} label={t('merchant.reject')} variant="secondary" size={size} onPress={onReject} style={{ flex: 1 }} />
      {onAcceptNow && oneTapMinutes !== undefined ? (
        <>
          <Button testID={`accept-${order.number}`} label={t('merchant.accept.one_tap', { minutes: oneTapMinutes })} size={size} haptic="success" loading={busyAccept} onPress={onAcceptNow} style={{ flex: 2 }} />
          <Pressable
            testID={`accept-more-${order.number}`}
            accessibilityRole="button"
            accessibilityLabel={t('merchant.accept.more')}
            onPress={() => {
              theme.haptic('light');
              onAccept();
            }}
            style={({ pressed }) => ({ width: size === 'lg' ? 56 : 48, height: size === 'lg' ? 56 : 48, borderRadius: theme.radius.lg, borderWidth: 1.5, borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
          >
            <Icon name="chevron-down" size={22} color="text" strokeWidth={2} />
          </Pressable>
        </>
      ) : (
        <Button testID={`accept-${order.number}`} label={t('merchant.accept')} size={size} haptic="medium" onPress={onAccept} style={{ flex: 2 }} />
      )}
    </View>
  );

  const ringFrame = isNew ? (
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
          borderColor: hot ? theme.colors.danger : theme.colors.accent,
        },
        pulse,
      ]}
    />
  ) : null;

  if (compact && isNew) {
    // Rush ticket (M-05): everything needed to answer it, nothing to read. Tap → the full ticket.
    return (
      <Animated.View testID={`order-${order.number}`} style={[{ position: 'relative' }, breath]}>
        {ringFrame}
        <Pressable
          testID={`compact-${order.number}`}
          onPress={onExpand ?? onOpen}
          accessibilityRole="button"
          accessibilityLabel={t('merchant.rush.expand_a11y', { number: order.number })}
          style={({ pressed }) => ({
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.xl,
            borderWidth: 1,
            borderColor: hot ? theme.colors.danger : theme.colors.border,
            padding: theme.space[3],
            gap: theme.space[2],
            opacity: pressed ? 0.96 : 1,
          })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            {order.acceptBy && !order.partial ? (
              <CountdownRing mode="accept" startedAt={order.acceptBy.getTime() - 90_000} durationMs={90_000} urgentMs={LADDER.urgentAtMs} clock={clock} size={48} strokeWidth={5} testID={`ring-${order.number}`} />
            ) : null}
            <View style={{ flex: 1 }}>
              <Text weight={700} tabular style={{ fontSize: 24, lineHeight: 32 }}>
                {t('merchant.card.number', { number: order.number })}
              </Text>
              <Text variant="footnote" color="textMuted" tabular numberOfLines={1}>
                {[t('merchant.card.items', { count: order.itemCount }), order.groups.length > 1 ? t('merchant.detail.people', { count: order.groups.length }) : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Icon name="chevron-down" size={20} color="textMuted" strokeWidth={2} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {allergy ? <AllergyPill testID={`allergy-${order.number}`} /> : null}
            <PaymentPill order={order} />
            {order.gift ? <StatusPill tone="accent" icon="gift" label={t('merchant.board.gift')} /> : null}
            {order.scheduledFor ? <StatusPill tone="info" icon="clock" label={t('merchant.card.scheduled', { time: clock12(order.scheduledFor) })} /> : null}
          </View>
          {order.partial ? <StatusPill tone="warning" icon="clock" live label={t('merchant.card.partial_waiting', { seconds: partialLeft })} /> : acceptButtons('md')}
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View testID={`order-${order.number}`} style={[{ position: 'relative' }, breath]}>
      {ringFrame}
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={t('merchant.detail.title', { number: order.number })}
        style={({ pressed }) => ({
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: order.late || hot ? theme.colors.danger : theme.colors.border,
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
        {/* Header: big number + time; the accept ring on new orders. The number never breaks («#5427»
            in one piece): its block is never narrower than the number, and when the time pill does not
            fit beside it, the pill wraps under it. On a narrow tablet board (three columns under
            1000 px) the number steps down a size. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', columnGap: theme.space[3], rowGap: theme.space[2] }}>
          <View testID={`card-number-${order.number}`} style={{ flex: 1, minWidth: numberMinWidth(numberLabel, numberType.size), gap: 2 }}>
            <Text variant={tight ? 'amount' : 'numeralSm'} weight={700} tabular numberOfLines={1} style={{ letterSpacing: 0.5 }}>
              {numberLabel}
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
            <CountdownRing mode="accept" startedAt={order.acceptBy.getTime() - 90_000} durationMs={90_000} urgentMs={LADDER.urgentAtMs} clock={clock} size={72} strokeWidth={6} testID={`ring-${order.number}`} />
          ) : (
            timingPill
          )}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {allergy ? <AllergyPill testID={`allergy-${order.number}`} /> : null}
          <PaymentPill order={order} />
          {order.gift ? <StatusPill tone="accent" icon="gift" label={t('merchant.board.gift')} /> : null}
          {order.scheduledFor ? <StatusPill tone="info" icon="clock" label={t('merchant.card.scheduled', { time: clock12(order.scheduledFor) })} /> : null}
          {order.catering ? <StatusPill tone="info" label={t('merchant.card.catering')} /> : null}
        </View>

        <View style={{ height: 1, backgroundColor: theme.colors.border }} />

        <OrderItems order={order} maxLines={maxLines} />

        {/* M-09: the kitchen's note only; the courier's note stays in the detail sheet. */}
        {order.note ? <KitchenNote note={order.note} testID={`kitchen-note-${order.number}`} /> : null}

        {order.partial ? (
          <StatusPill tone="warning" icon="clock" live label={t('merchant.card.partial_waiting', { seconds: partialLeft })} />
        ) : courier ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space[2] }}>
            <StatusPill tone={courier.tone} icon="bike" live={courier.live} label={t(courier.key, courier.params)} />
            {/* Maps program r4: hand the food to the courier whose screen shows this code. */}
            {order.courier.pickupCode && (order.courier.state === 'on_the_way' || order.courier.state === 'arrived') ? <PickupCode code={order.courier.pickupCode} testID={`pickup-code-${order.number}`} /> : null}
          </View>
        ) : null}

        {isNew && !order.partial ? (
          acceptButtons('lg')
        ) : order.column === 'preparing' && narrowBoard ? (
          // A narrow board column has no room for three buttons in a row: «صار جاهز» takes the full
          // width on top, «+5 د» and «التفاصيل» share the line under it.
          <View style={{ gap: theme.space[2] }}>
            <Button testID={`ready-${order.number}`} label={t('merchant.card.mark_ready')} icon="check" size="lg" haptic="success" loading={busyReady} onPress={onReady} fullWidth />
            <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center' }}>
              {onExtend && canExtendPrep(order) ? (
                <Button testID={`extend-${order.number}`} label={t('merchant.extend.button')} variant="secondary" size="lg" loading={busyExtend} onPress={onExtend} accessibilityHint={t('merchant.extend.a11y')} />
              ) : null}
              <Button label={t('merchant.card.details')} variant="secondary" size="lg" onPress={onOpen} style={{ flex: 1 }} />
            </View>
          </View>
        ) : order.column === 'preparing' ? (
          <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center' }}>
            {onExtend && canExtendPrep(order) ? (
              <Button testID={`extend-${order.number}`} label={t('merchant.extend.button')} variant="secondary" size="lg" loading={busyExtend} onPress={onExtend} accessibilityHint={t('merchant.extend.a11y')} />
            ) : null}
            <Button label={t('merchant.card.details')} variant="secondary" size="lg" onPress={onOpen} style={{ flex: 1 }} />
            <Button testID={`ready-${order.number}`} label={t('merchant.card.mark_ready')} icon="check" size="lg" haptic="success" loading={busyReady} onPress={onReady} style={{ flex: 2 }} />
          </View>
        ) : null}
        {order.column === 'preparing' && order.prepExtended ? (
          <Text variant="caption" color="textMuted" testID={`extended-${order.number}`}>
            {t('merchant.extend.used')}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
