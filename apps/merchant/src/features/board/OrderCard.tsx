import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { BoardGroup, BoardOrder } from '@driver/contracts';
import { Button, CountdownRing, Icon, StatusPill, Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { COUNTER } from '@/lib/counter';
import { TornEdge } from './TornEdge';
import { useLocale, useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { iqd } from '@/lib/money';
import { usePrefs } from '@/lib/prefs';
import { clock12, secondsLeft } from '@/lib/time';
import type { AlarmStage } from './ladder';
import { LADDER, stageFor } from './ladder';
import { useServerSelect, useServerTime } from './clock';
import { PickupCode } from './PickupCode';
import { Glyph } from '../menu/Glyph';
import { lineLook, packApart, type LineLook } from './kind';
import { canExtendPrep, cardTiming, courierLine, dishLine, hasAllergy, needsReading, prepLeft, tickKey } from './logic';

export interface OrderCardProps {
  order: BoardOrder;
  /** Server time (ms); left out on the board, where each ticket follows the shared clock itself (h3). */
  now?: number;
  /** Server clock for the accept ring. */
  clock: () => number;
  /** Still ringing (not accepted/rejected/snoozed): pulses. */
  ringing?: boolean;
  /** Its own alarm stage: in the last 30 s the border and ring turn danger and the card breathes. Left out, the card works it out from `acceptBy`. */
  stage?: AlarmStage | null;
  /** Cap on item lines shown (the detail sheet shows all). */
  maxLines?: number;
  /** Day-one d07: no countdown ring (the shop is paused offline: a ring stuck at 0 only alarms). */
  noRing?: boolean;
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
  /**
   * Phone «هسة» (o2): every new order after the first is one line — ring, number, dishes — and a
   * tap brings it to the top (`onExpand`).
   */
  row?: boolean;
  /**
   * Tablet rush rows (r2): the row carries its own button — one-tap «اقبل · 15 د», or «شوفه واقبل»
   * (the accept sheet, notes on top) when it has an allergy or a note.
   */
  rowAction?: boolean;
  /** Cooking tickets (o10): the lines the kitchen ticked off on this tablet, and the tap that ticks one. */
  ticks?: { ticked: ReadonlySet<string>; toggle: (orderId: string, lineId: string) => void };
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

/** s6 «خط كبير»: ticket type 30 % bigger, read from across the kitchen (a setting on this device). */
export const BIG_TEXT = 1.3;
function useTicketType(): (size: number, lineHeight: number) => { fontSize: number; lineHeight: number } | null {
  const big = usePrefs().bigText;
  return (size, lineHeight) => (big ? { fontSize: Math.round(size * BIG_TEXT), lineHeight: Math.round(lineHeight * BIG_TEXT) } : null);
}

/** The kitchen note block: muted, or on the danger tint when it carries an allergy. */
export function KitchenNote({ note, testID }: { note: string; testID?: string }) {
  const theme = useTheme();
  const allergy = hasAllergy({ note, groups: [] });
  const type = useTicketType();
  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: theme.space[2], backgroundColor: allergy ? theme.colors.dangerTint : theme.colors.surfaceSunken, borderRadius: theme.radius.md, padding: theme.space[3] }}>
      <MIcon name={allergy ? 'alert' : 'note'} size={18} color={allergy ? 'dangerText' : 'textMuted'} />
      <Text variant="label" weight={700} color={allergy ? 'dangerText' : 'text'} style={[{ flex: 1 }, type(14, 22)]}>
        {note}
      </Text>
    </View>
  );
}

/** j6 / k4: a drink's or a sweet's mark after the dish name, in its kind's colour (hot / cold for drinks). */
function KindMark({ look }: { look: LineLook }) {
  const t = useT();
  if (look.kind === 'kitchen') return null;
  const drink = look.kind === 'drink';
  const fg = drink ? COUNTER.kindDrink : COUNTER.kindSweet;
  const word = look.temp === 'cold' ? t('merchant.display.cold') : look.temp === 'hot' ? t('merchant.display.hot') : t('merchant.board.kind_sweet');
  return (
    <View testID={`kind-${look.kind}${look.temp ? `-${look.temp}` : ''}`} style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 3, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: drink ? COUNTER.kindDrinkWash : COUNTER.kindSweetWash }}>
      {look.temp ? <Glyph name={look.temp === 'cold' ? 'snow' : 'steam'} size={12} color={fg} strokeWidth={2.2} /> : null}
      <Text variant="caption" weight={700} style={{ color: fg }}>
        {word}
      </Text>
    </View>
  );
}

/** k4: an order with cold and hot things says so once, under its lines: the cold goes in its own bag. */
function PackApart({ order }: { order: BoardOrder }) {
  const theme = useTheme();
  const t = useT();
  const pack = packApart(order.groups.flatMap((g) => g.lines));
  if (!pack) return null;
  return (
    <View testID="pack-apart" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], borderRadius: theme.radius.md, backgroundColor: COUNTER.kindDrinkWash, paddingHorizontal: theme.space[3], paddingVertical: theme.space[2] }}>
      <Glyph name="snow" size={16} color={COUNTER.kindDrink} strokeWidth={2.2} />
      <Text variant="label" weight={700} style={{ flex: 1, color: COUNTER.kindDrink }}>
        {t('merchant.board.pack_apart', { cold: pack.cold })}
      </Text>
    </View>
  );
}

/** Kitchen-ticket line: big quantity, the dish, modifiers muted, the note bold on a warm strip; drinks and sweets wear their kind's edge (j6). */
function Line({ qty, name, modifiers, note, out, done, onTick, testID }: { qty: number; name: string; modifiers: string[]; note: string | null; out: boolean; done?: boolean; onTick?: () => void; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const struck = out || done === true;
  const type = useTicketType();
  const look = lineLook(name);
  const edge = look.kind === 'drink' ? COUNTER.kindDrink : look.kind === 'sweet' ? COUNTER.kindSweet : 'transparent';
  const body = (
    <View style={{ gap: 2, opacity: out ? 0.5 : done ? 0.45 : 1, borderStartWidth: 4, borderStartColor: edge, paddingStart: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
        <Text variant="title" tabular style={[theme.face('display'), { minWidth: 30, color: COUNTER.qty }, type(18, 30)]}>
          {`${qty}×`}
        </Text>
        <Text variant="bodyStrong" weight={700} style={[{ flex: 1, fontSize: 17, lineHeight: 26, textDecorationLine: struck ? 'line-through' : 'none' }, type(17, 26)]}>
          {name}
        </Text>
        <KindMark look={look} />
        {out ? <StatusPill label={t('merchant.card.unavailable')} tone="danger" size="sm" /> : null}
        {onTick ? (
          // d22: the box says what it is for — «خلصت» — on a pill, filled green once ticked.
          <View style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingStart: 5, paddingEnd: 10, borderRadius: 17, borderWidth: 1.5, borderColor: done ? COUNTER.ready : theme.colors.borderStrong, backgroundColor: done ? COUNTER.ready : 'transparent' }}>
            <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: done ? COUNTER.onDate : theme.colors.borderStrong, backgroundColor: done ? COUNTER.ready : COUNTER.paper, alignItems: 'center', justifyContent: 'center' }}>
              {done ? <Icon name="check" size={14} color={COUNTER.onDate} strokeWidth={3} /> : null}
            </View>
            <Text variant="caption" weight={700} style={{ color: done ? COUNTER.onDate : theme.colors.text, textDecorationLine: 'none' }}>
              {t('merchant.board.tick_done')}
            </Text>
          </View>
        ) : null}
      </View>
      {modifiers.length > 0 ? (
        <Text variant="footnote" color="textMuted" style={[{ paddingStart: 38 }, type(13, 22)]}>
          {modifiers.map((m, i) => (
            // k5: how sweet is the one choice the cup can't show afterwards, so it reads bold in the drink's colour.
            <Text key={`${i}-${m}`} variant="footnote" weight={/سكر|شكر|sugar/i.test(m) ? 700 : 400} style={[{ color: /سكر|شكر|sugar/i.test(m) ? COUNTER.kindDrink : theme.colors.textMuted }, type(13, 22)]}>
              {i > 0 ? ' · ' : ''}
              {m}
            </Text>
          ))}
        </Text>
      ) : null}
      {note ? (
        <View style={{ marginStart: 38, alignSelf: 'flex-start', backgroundColor: theme.colors.warningTint, borderRadius: theme.radius.sm, paddingHorizontal: theme.space[2] }}>
          <Text variant="label" weight={700} style={[{ color: theme.colors.text }, type(14, 22)]}>
            {note}
          </Text>
        </View>
      ) : null}
    </View>
  );
  if (!onTick) return body;
  // o10: the whole line is the target (≥ 44 px tall); one tap strikes it, another brings it back.
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        theme.haptic('light');
        onTick();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done === true }}
      accessibilityLabel={t('merchant.board.tick_a11y', { qty, name })}
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', borderRadius: theme.radius.sm, opacity: pressed ? 0.8 : 1 })}
    >
      {body}
    </Pressable>
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
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: g.kind === 'orderer' ? COUNTER.date : COUNTER.dateRaised, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="caption" weight={700} style={{ color: COUNTER.onDate, lineHeight: 18 }}>
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
export function OrderItems({ order, maxLines = 99, ticks }: { order: BoardOrder; maxLines?: number; ticks?: OrderCardProps['ticks'] }) {
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
            <Line
              key={l.lineId}
              qty={l.qty}
              name={l.name}
              modifiers={l.modifiers}
              note={l.note}
              out={l.availability === 'unavailable'}
              {...(ticks && l.availability === 'available'
                ? { done: ticks.ticked.has(tickKey(order.id, l.lineId)), onTick: () => ticks.toggle(order.id, l.lineId), testID: `tick-${order.number}-${l.lineId}` }
                : {})}
            />
          ))}
        </View>
      </View>
    );
  });
  return (
    <View style={{ gap: theme.space[3] }}>
      {blocks}
      <PackApart order={order} />
      {hidden > 0 ? (
        <Text variant="footnote" weight={700} style={{ color: COUNTER.qty }}>
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
 * o5: the time left on a cooking ticket as a bar that drains — readable from across the kitchen
 * without reading numbers. Date brown while there's time, red (and full) once it is late. d22: kept,
 * with its name above it («الوقت الباقي للتحضير»).
 */
export function PrepBar({ fraction, late, testID }: { fraction: number; late: boolean; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const pct = Math.round((late ? 1 : fraction) * 100);
  const tone = late ? COUNTER.late : fraction < 0.25 ? COUNTER.newBadge : COUNTER.date;
  // d22: the bar says what it measures (it read as an unexplained black line).
  return (
    <View testID={testID} accessibilityRole="progressbar" accessibilityLabel={late ? t('merchant.board.prep_bar_late') : t('merchant.board.prep_bar', { percent: pct })} style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="clock" size={14} color={late ? COUNTER.late : theme.colors.textMuted} />
        <Text variant="caption" weight={600} style={{ color: late ? COUNTER.late : theme.colors.textMuted }} numberOfLines={1}>
          {late ? t('merchant.board.prep_bar_label_late') : t('merchant.board.prep_bar_label')}
        </Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden', flexDirection: 'row' }}>
        <View style={{ width: `${pct}%`, borderRadius: 4, backgroundColor: tone }} />
      </View>
    </View>
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
  const { order, clock, ringing = false, maxLines = 8, noRing = false, oneTapMinutes, onAcceptNow, onAccept, onReject, onReady, onOpen, onExtend, busyReady, busyAccept, busyExtend, compact = false, onExpand, row = false, rowAction = false, ticks } = props;
  const theme = useTheme();
  const t = useT();
  const { wide, width } = useLayout();
  /** Three board columns under 1000 px leave a card ~190 px inside: the ticket number steps down. */
  const tight = wide && width < 1000;
  const numberLabel = t('merchant.card.number', { number: order.number });
  const numberType = theme.type[tight ? 'amount' : 'numeralSm'];
  // h3: a ticket re-draws on its own when its numbers change: every 10 s («من 4 د», the prep bar),
  // every second only while it counts a customer's answer down, and when its ring changes stage.
  const step = order.partial ? 1000 : 10_000;
  const tickNow = useServerTime(step);
  const now = props.now ?? tickNow;
  const acceptBy = order.acceptBy?.getTime() ?? null;
  const liveStage = useServerSelect((at) => (ringing && acceptBy !== null ? stageFor(acceptBy - at) : null));
  const stage = props.stage !== undefined ? props.stage : liveStage;
  const isNew = order.column === 'new';
  const allergy = hasAllergy(order);
  const hot = isNew && stage === 'final';
  const pulse = usePulseBorder(ringing && !theme.reduceMotion, hot);
  const breath = useBreath(ringing && hot && !theme.reduceMotion);
  const timing = cardTiming(order, now);
  const courier = courierLine(order.courier, now);
  const partialLeft = order.partial ? secondsLeft(order.partial.deadline, now) : 0;
  const drain = prepLeft(order, now);

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
          <Button testID={`accept-${order.number}`} label={t('merchant.accept.one_tap_full', { minutes: oneTapMinutes })} size={size} haptic="success" loading={busyAccept} onPress={onAcceptNow} style={{ flex: 2 }} />
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

  if (row && isNew) {
    // Phone «هسة» (o2): one line per order waiting behind the first; tap brings it to the top.
    const dishes = dishLine(order, 2);
    return (
      <Animated.View testID={`order-${order.number}`} style={[{ position: 'relative' }, breath]}>
        <Pressable
          testID={`row-${order.number}`}
          onPress={onExpand ?? onOpen}
          accessibilityRole="button"
          accessibilityLabel={t('merchant.board.row_a11y', { number: order.number, count: order.itemCount })}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[3],
            minHeight: 64,
            paddingHorizontal: theme.space[3],
            paddingVertical: theme.space[2],
            borderRadius: theme.radius.lg,
            backgroundColor: COUNTER.paper,
            borderWidth: hot ? 2 : 1,
            borderColor: hot ? COUNTER.late : theme.colors.border,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          {order.acceptBy && !order.partial && !noRing ? (
            <CountdownRing mode="accept" startedAt={order.acceptBy.getTime() - 90_000} durationMs={90_000} urgentMs={LADDER.finalAtMs} clock={clock} size={40} strokeWidth={4} testID={`ring-${order.number}`} />
          ) : (
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.warningTint, alignItems: 'center', justifyContent: 'center' }}>
              <MIcon name="hourglass" size={18} color="warningText" />
            </View>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Text tabular style={[theme.face('display'), { fontSize: 20, lineHeight: 28, color: COUNTER.date }]}>
                {t('merchant.card.number', { number: order.number })}
              </Text>
              {allergy ? <MIcon name="alert" size={18} color="dangerText" strokeWidth={2.4} /> : null}
            </View>
            <Text variant="footnote" color="textMuted" numberOfLines={1}>
              {dishes.shown.map((d) => `${d.qty}× ${d.name}`).join('، ') + (dishes.more > 0 ? ` ${t('merchant.card.more_items', { count: dishes.more })}` : '')}
            </Text>
          </View>
          {rowAction && !order.partial ? (
            needsReading(order) ? (
              <Button testID={`row-open-${order.number}`} label={t('merchant.rush.row_open')} variant="secondary" size="md" onPress={onAccept} />
            ) : onAcceptNow && oneTapMinutes !== undefined ? (
              <Button testID={`accept-${order.number}`} label={t('merchant.accept.one_tap_full', { minutes: oneTapMinutes })} size="md" haptic="success" loading={busyAccept} onPress={onAcceptNow} />
            ) : null
          ) : (
            <Icon name="chevron-forward" size={20} color="textMuted" strokeWidth={2} />
          )}
        </Pressable>
      </Animated.View>
    );
  }

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
            backgroundColor: COUNTER.paper,
            borderRadius: theme.radius.xl,
            borderWidth: 1,
            borderColor: hot ? COUNTER.late : theme.colors.border,
            padding: theme.space[3],
            gap: theme.space[2],
            opacity: pressed ? 0.96 : 1,
          })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            {order.acceptBy && !order.partial && !noRing ? (
              <CountdownRing mode="accept" startedAt={order.acceptBy.getTime() - 90_000} durationMs={90_000} urgentMs={LADDER.finalAtMs} clock={clock} size={48} strokeWidth={5} testID={`ring-${order.number}`} />
            ) : null}
            <View style={{ flex: 1 }}>
              <Text tabular style={[theme.face('display'), { fontSize: 24, lineHeight: 32, color: COUNTER.date }]}>
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
            {order.scheduledFor ? <StatusPill tone="neutral" icon="clock" label={t('merchant.card.scheduled', { time: clock12(order.scheduledFor) })} /> : null}
          </View>
          {/* o1: a short ticket is still a ticket — the first dishes, readable, never just a number. */}
          <OrderItems order={order} maxLines={3} />
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
          // Paper ticket (redesign step 1): cream paper, a torn top edge, square top corners. A late
          // order turns red all over (tint + thick outline), not just its pill.
          backgroundColor: order.late ? COUNTER.lateWash : COUNTER.paper,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          borderBottomLeftRadius: theme.radius.xl,
          borderBottomRightRadius: theme.radius.xl,
          borderWidth: order.late ? 3 : 1,
          borderTopWidth: order.late ? 3 : 0,
          borderColor: order.late || hot ? COUNTER.late : theme.colors.border,
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
        {order.late ? null : <TornEdge color={COUNTER.paper} />}
        {/* Header: big number + time; the accept ring on new orders. The number never breaks («#5427»
            in one piece): its block is never narrower than the number, and when the time pill does not
            fit beside it, the pill wraps under it. On a narrow tablet board (three columns under
            1000 px) the number steps down a size. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', columnGap: theme.space[3], rowGap: theme.space[2] }}>
          <View testID={`card-number-${order.number}`} style={{ flex: 1, minWidth: numberMinWidth(numberLabel, numberType.size), gap: 2 }}>
            <Text variant={tight ? 'amount' : 'numeralSm'} tabular numberOfLines={1} style={[theme.face('display'), { letterSpacing: 0.5, color: COUNTER.date }]}>
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
          {isNew && order.acceptBy && !order.partial && !noRing ? (
            <CountdownRing mode="accept" startedAt={order.acceptBy.getTime() - 90_000} durationMs={90_000} urgentMs={LADDER.finalAtMs} clock={clock} size={72} strokeWidth={6} testID={`ring-${order.number}`} />
          ) : (
            timingPill
          )}
        </View>
        {drain ? <PrepBar fraction={drain.fraction} late={drain.late} testID={`prep-bar-${order.number}`} /> : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {allergy ? <AllergyPill testID={`allergy-${order.number}`} /> : null}
          <PaymentPill order={order} />
          {order.gift ? <StatusPill tone="accent" icon="gift" label={t('merchant.board.gift')} /> : null}
          {order.scheduledFor ? <StatusPill tone="neutral" icon="clock" label={t('merchant.card.scheduled', { time: clock12(order.scheduledFor) })} /> : null}
          {order.catering ? <StatusPill tone="neutral" label={t('merchant.card.catering')} /> : null}
        </View>

        <View style={{ height: 1, backgroundColor: theme.colors.border }} />

        <OrderItems order={order} maxLines={maxLines} {...(order.column === 'preparing' && ticks ? { ticks } : {})} />

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
        ) : order.column === 'preparing' ? (
          // A ticket is never wider than a board column (about 370 px on a 1280 tablet), which has no room
          // for three buttons in a row (day-one d03: «التفاصيل» broke into «التفا / صيل»): «صار جاهز» takes
          // the full width on top, «+5 دقايق» and «التفاصيل» share the line under it.
          <View style={{ gap: theme.space[2] }}>
            <Button testID={`ready-${order.number}`} label={t('merchant.card.mark_ready')} icon="check" size="lg" haptic="success" loading={busyReady} onPress={onReady} fullWidth />
            <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center' }}>
              {onExtend && canExtendPrep(order) ? (
                <Button testID={`extend-${order.number}`} label={t('merchant.extend.button_full')} variant="secondary" size="lg" loading={busyExtend} onPress={onExtend} accessibilityHint={t('merchant.extend.a11y')} />
              ) : null}
              <Button testID={`details-${order.number}`} label={t('merchant.card.details')} variant="secondary" size="lg" onPress={onOpen} style={{ flex: 1 }} />
            </View>
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
