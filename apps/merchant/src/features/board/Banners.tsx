import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import type { BoardOrder, MissedOrder } from '@driver/contracts';
import { Icon, Text, useTheme, withAlpha } from '@driver/ui';
import { color } from '@driver/design-tokens';
import { MIcon, type MIconName } from '@/components/MIcon';
import { COUNTER } from '@/lib/counter';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import type { AlarmStage } from './ladder';
import { dishLine, hasAllergy, type NewOrderSummary } from './logic';

/** A pill button on a coloured strip (40 px tall, 44 px with its hit slop). */
function StripButton({ label, icon, onPress, testID, tone }: { label: string; icon?: MIconName; onPress: () => void; testID: string; tone: 'ink' | 'soft' | 'light' }) {
  const theme = useTheme();
  const bg = tone === 'ink' ? theme.colors.text : tone === 'light' ? theme.colors.surface : withAlpha(theme.colors.text, 0.12);
  const fg = tone === 'ink' ? theme.colors.surface : theme.colors.text;
  return (
    <Pressable hitSlop={2} testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], height: 40, paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, backgroundColor: bg, opacity: pressed ? 0.85 : 1 })}>
      {icon ? <MIcon name={icon} size={18} color={fg} /> : null}
      <Text variant="label" weight={700} style={{ color: fg }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export interface NewOrderBannerProps {
  /** Orders ringing now (not snoozed, sheet not open). */
  count: number;
  /** Orders quiet under "سكّت 30 ثانية". */
  snoozedCount: number;
  stage: AlarmStage | null;
  /** The order with the least time left, for "باقي 10 ثواني على #3912". */
  mostUrgent: { number: string; seconds: number | null } | null;
  /** Seconds until a snoozed order rings again. */
  snoozeSeconds: number | null;
  /** The browser hasn't allowed sound yet, or it is off in settings. */
  soundBlocked: boolean;
  onSnooze: () => void;
  onUnsnooze: () => void;
  onEnableSound: () => void;
  compact?: boolean;
  /**
   * M-10: the one "new" count (every order in جديد) and its state. The title says the same number as
   * the column and the badge — "3 طلبات تنتظر · 1 مسكّت" — instead of counting only what rings.
   */
  summary?: NewOrderSummary;
  /**
   * m6a: the store is closed and orders still wait — the strip shows them quietly ("المحل مسدود · ما
   * يرن") with no snooze button: closing already silenced the alarm.
   */
  storeClosed?: boolean;
  /**
   * a1 (tablet): the order to answer next, on the ribbon itself — its number, dishes, the cash and
   * one-tap «اقبل · 15 د» — so the kitchen answers from the top of the screen without finding the
   * ticket. Absent on a phone, while snoozed and while the store is closed.
   */
  featured?: { order: BoardOrder; oneTapMinutes: number; busy: boolean; onAccept: () => void; onOpen: () => void } | null;
  /**
   * t4, busy mode: «اقبل الكل (4) · 25 د» accepts every waiting order with no allergy and no note at
   * the shop's usual time; the others stay to be opened one by one.
   */
  acceptAll?: { count: number; minutes: number; busy: boolean; onPress: () => void } | null;
}

/** The ribbon's own accept: dark on saffron (and on red in the last 30 s), 52 px tall. */
function RibbonAccept({ label, busy, onPress, testID }: { label: string; busy: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={() => {
        theme.haptic('success');
        onPress();
      }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], height: 52, paddingHorizontal: theme.space[5], borderRadius: theme.radius.lg, backgroundColor: COUNTER.date, opacity: busy ? 0.7 : pressed ? 0.88 : 1 })}
    >
      <Icon name="check" size={20} color={COUNTER.onDate} strokeWidth={2.6} />
      <Text weight={700} tabular style={{ color: COUNTER.onDate, fontSize: 18, lineHeight: 26 }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** "3 طلبات تنتظر · 1 مسكّت · 1 ينتظر الزبون" (or "طلب جديد!" for a single fresh order). */
export function summaryTitle(t: ReturnType<typeof useT>, s: NewOrderSummary): string {
  if (s.total <= 1 && s.snoozed === 0 && s.withCustomer === 0) return t('merchant.board.alert_new');
  const head = s.total === 1 ? t('merchant.board.alert_waiting_one') : s.total === 2 ? t('merchant.board.alert_waiting_two') : t('merchant.board.alert_waiting', { count: s.total });
  return [head, s.snoozed > 0 ? t('merchant.board.alert_state_snoozed', { count: s.snoozed }) : null, s.withCustomer > 0 ? t('merchant.board.alert_state_customer', { count: s.withCustomer }) : null].filter(Boolean).join(' · ');
}

/**
 * "طلب جديد!" — the strip over the board while new orders wait (signature S-M1). It escalates with the
 * ladder (a2): accent for the first 60 s (the screen edge flashes in the middle 30), danger in the last
 * 30 s, where it names the order and counts down ("باقي 24 ثانية على #3912"). "سكّت 30 ثانية"
 * snoozes; while snoozed it says when it rings again and offers "رجّع الصوت". If the browser blocks sound it offers "شغّل صوت الطلبات" first.
 */
export function NewOrderBanner({ count, snoozedCount, stage, mostUrgent, snoozeSeconds, soundBlocked, onSnooze, onUnsnooze, onEnableSound, compact = false, summary, storeClosed = false, featured = null, acceptAll = null }: NewOrderBannerProps) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const p = useSharedValue(0);
  // a2: saffron while there is time (the middle step flashes the screen edge), red in the last 30 s.
  const hot = stage === 'final';
  const ringing = count > 0;
  useEffect(() => {
    if (theme.reduceMotion || !ringing) {
      cancelAnimation(p);
      p.value = 0;
      return;
    }
    p.value = withRepeat(withTiming(1, { duration: stage === 'calm' ? 700 : 350, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(p);
  }, [p, theme.reduceMotion, ringing, stage]);
  const bell = useAnimatedStyle(() => ({ transform: [{ rotate: `${(p.value - 0.5) * 24}deg` }] }));
  const glow = useAnimatedStyle(() => ({ opacity: 0.55 + p.value * 0.45 }));

  const total = count + snoozedCount;
  const seconds = mostUrgent?.seconds ?? null;
  const title =
    stage === 'final' && mostUrgent && seconds !== null
      ? seconds <= 1
        ? t('merchant.board.final_one', { number: mostUrgent.number })
        : seconds === 2
          ? t('merchant.board.final_two', { number: mostUrgent.number })
          : seconds <= 10
            ? t('merchant.board.final_many', { seconds, number: mostUrgent.number })
            : t('merchant.board.final_more', { seconds, number: mostUrgent.number })
      : summary
        ? summaryTitle(t, summary)
        : total > 1
          ? t('merchant.board.alert_count', { count: total })
          : t('merchant.board.alert_new');
  const sub = storeClosed
    ? t('merchant.board.alert_closed_quiet')
    : !ringing && snoozeSeconds !== null
      ? t('merchant.board.alert_snoozed', { seconds: Math.max(1, snoozeSeconds) })
      : stage === 'urgent' && seconds !== null
        ? t('merchant.board.alert_left', { seconds })
        : null;

  const show = ringing && !storeClosed && !compact ? featured : null;
  const bg = !ringing ? theme.colors.warningTint : hot ? theme.colors.danger : theme.colors.accent;
  const glowColor = hot ? color.danger[700] : color.primary[400];
  const fg = !ringing ? theme.colors.warningText : hot ? theme.colors.onDanger : theme.colors.onAccent;
  const action = storeClosed ? null : soundBlocked ? (
    <StripButton testID="sound-enable" tone="ink" icon="volume" label={t('merchant.sound.enable')} onPress={onEnableSound} />
  ) : ringing ? (
    <StripButton testID="alarm-snooze" tone={hot ? 'light' : 'soft'} icon="volume-off" label={t('merchant.board.alert_snooze')} onPress={onSnooze} />
  ) : (
    <StripButton testID="alarm-unsnooze" tone="ink" icon="volume" label={t('merchant.board.alert_unsnooze')} onPress={onUnsnooze} />
  );
  return (
    <View
      testID={stage === 'final' ? 'alarm-final-banner' : 'new-order-banner'}
      accessibilityLiveRegion={storeClosed ? 'polite' : 'assertive'}
      style={{ backgroundColor: bg, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space[3], rowGap: theme.space[2], paddingHorizontal: compact ? theme.space[4] : theme.space[5], paddingVertical: theme.space[3], overflow: 'hidden' }}
    >
      <View testID={`alarm-stage-${ringing ? (stage ?? 'calm') : storeClosed ? 'closed' : 'snoozed'}`} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
      {ringing ? <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: glowColor }, glow]} /> : null}
      <Animated.View style={[{ width: 40, height: 40, borderRadius: 20, backgroundColor: ringing ? theme.colors.text : withAlpha(theme.colors.warningText, 0.14), alignItems: 'center', justifyContent: 'center' }, bell]}>
        {ringing ? <Icon name="bell" size={22} color={theme.colors.surface} strokeWidth={2.2} /> : <MIcon name="volume-off" size={20} color={theme.colors.warningText} />}
      </Animated.View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight={700} tabular numberOfLines={compact && stage !== 'final' ? 1 : 2} style={{ fontSize: compact ? 18 : 22, lineHeight: compact ? 28 : 34, color: fg }}>
          {title}
        </Text>
        {sub ? (
          <Text variant="label" weight={600} tabular style={{ color: fg }}>
            {sub}
          </Text>
        ) : null}
      </View>
      {action}
      {acceptAll && !storeClosed ? <RibbonAccept testID="accept-all" label={t('merchant.rush.accept_all', { count: acceptAll.count, minutes: acceptAll.minutes })} busy={acceptAll.busy} onPress={acceptAll.onPress} /> : null}
      {show ? <FeaturedOrder f={show} t={t} locale={locale} /> : null}
    </View>
  );
}

/**
 * a1: the next order on the ribbon, a ticket stub in paper — number, dishes, allergy, cash — and its
 * one-tap accept. Tapping the stub opens the order.
 */
function FeaturedOrder({ f, t, locale }: { f: NonNullable<NewOrderBannerProps['featured']>; t: ReturnType<typeof useT>; locale: ReturnType<typeof useLocale> }) {
  const theme = useTheme();
  const o = f.order;
  const dishes = dishLine(o, 3);
  const allergy = hasAllergy(o);
  return (
    <View testID="ribbon-featured" style={{ flexBasis: '100%', flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      <Pressable
        testID="ribbon-open"
        onPress={f.onOpen}
        accessibilityRole="button"
        accessibilityLabel={t('merchant.detail.title', { number: o.number })}
        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 52, paddingHorizontal: theme.space[4], paddingVertical: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: COUNTER.paper, opacity: pressed ? 0.92 : 1 })}
      >
        <Text tabular style={[theme.face('display'), { fontSize: 24, lineHeight: 32, color: COUNTER.date }]}>
          {t('merchant.card.number', { number: o.number })}
        </Text>
        <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: theme.colors.border }} />
        <Text variant="bodyStrong" weight={700} numberOfLines={1} style={{ flex: 1, color: theme.colors.text }}>
          {dishes.shown.map((d) => `${d.qty}× ${d.name}`).join('،  ') + (dishes.more > 0 ? `  ${t('merchant.card.more_items', { count: dishes.more })}` : '')}
        </Text>
        {allergy ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, backgroundColor: theme.colors.danger }}>
            <MIcon name="alert" size={16} color={theme.colors.onDanger} strokeWidth={2.2} />
            <Text variant="footnote" weight={700} style={{ color: theme.colors.onDanger }}>
              {t('merchant.card.allergy')}
            </Text>
          </View>
        ) : null}
        <Text variant="label" weight={700} tabular numberOfLines={1} style={{ color: theme.colors.warningText }}>
          {o.paymentMethod === 'cash' ? `${t('merchant.card.cash')} · ${iqd(o.collectCashIqd, { locale })}` : t('merchant.card.prepaid')}
        </Text>
      </Pressable>
      <RibbonAccept testID="ribbon-accept" label={t('merchant.accept.one_tap', { minutes: f.oneTapMinutes })} busy={f.busy} onPress={f.onAccept} />
    </View>
  );
}

export type InfoTone = 'danger' | 'warning' | 'success' | 'neutral';

/** Store closed / paused / offline / missed orders: a calm strip with the next step. */
export function InfoStrip({
  tone,
  text,
  sub,
  action,
  secondary,
  more,
  icon,
  testID,
}: {
  tone: InfoTone;
  text: string;
  /** A second line (a suggestion that goes with the message). */
  sub?: string;
  action?: { label: string; onPress: () => void; testID?: string };
  secondary?: { label: string; onPress: () => void; testID?: string };
  /** Further outline buttons, placed before `secondary`. */
  more?: Array<{ label: string; onPress: () => void; testID?: string }>;
  icon?: MIconName;
  testID?: string;
}) {
  const theme = useTheme();
  const bg = tone === 'danger' ? theme.colors.dangerTint : tone === 'warning' ? theme.colors.warningTint : tone === 'success' ? theme.colors.successTint : theme.colors.surfaceSunken;
  const fg = tone === 'danger' ? 'dangerText' : tone === 'warning' ? 'warningText' : tone === 'success' ? 'successText' : 'text';
  const button = (b: { label: string; onPress: () => void; testID?: string }, solid: boolean) => (
    <Pressable
      key={b.label}
      hitSlop={4}
      testID={b.testID}
      accessibilityRole="button"
      onPress={b.onPress}
      style={{ height: 36, paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, backgroundColor: solid ? theme.colors.surface : 'transparent', borderWidth: solid ? 0 : 1, borderColor: withAlpha(theme.colors[fg], 0.35), justifyContent: 'center' }}
    >
      <Text variant="label" weight={700} color={fg} numberOfLines={1}>
        {b.label}
      </Text>
    </Pressable>
  );
  return (
    <View testID={testID} style={{ backgroundColor: bg, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space[3], rowGap: theme.space[2], paddingHorizontal: theme.space[5], paddingVertical: theme.space[2], minHeight: 48 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], flexGrow: 1, flexShrink: 1, flexBasis: 240 }}>
        <MIcon name={icon ?? (tone === 'neutral' ? 'clock' : 'power')} size={18} color={fg} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={600} color={fg}>
            {text}
          </Text>
          {sub ? (
            <Text variant="label" weight={700} color={fg}>
              {sub}
            </Text>
          ) : null}
        </View>
      </View>
      {action || secondary || more ? (
        <View style={{ flexDirection: 'row', gap: theme.space[2], marginStart: 'auto' }}>
          {(more ?? []).map((b) => button(b, false))}
          {secondary ? button(secondary, false) : null}
          {action ? button(action, true) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * "طلبات فاتتك" (M-01) in one sentence: one miss names the order and what happened; several list
 * their numbers. A partial accept the customer let lapse says it doesn't count. Since the counter
 * redesign it heads the «فاتك اليوم» sheet (the chip in the status bar carries a dot until seen).
 */
export function missedText(t: ReturnType<typeof useT>, missed: readonly MissedOrder[]): string {
  const timeouts = missed.filter((m) => m.reason === 'merchant_timeout');
  const first = missed[0];
  if (!first) return '';
  return missed.length === 1
    ? first.reason === 'partial_timeout'
      ? t('merchant.missed.partial', { number: first.number })
      : `${t('merchant.missed.one', { number: first.number })}${first.scored ? '' : ` · ${t('merchant.missed.not_scored')}`}`
    : timeouts.length === 0
      ? t('merchant.missed.partial_many', { numbers: missed.map((m) => `#${m.number}`).join('، ') })
      : missed.length === 2
        ? t('merchant.missed.two', { numbers: missed.map((m) => `#${m.number}`).join('، ') })
        : t('merchant.missed.many', { count: missed.length, numbers: missed.slice(0, 4).map((m) => `#${m.number}`).join('، ') + (missed.length > 4 ? '…' : '') });
}
