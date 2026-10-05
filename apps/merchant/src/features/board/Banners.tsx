import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import type { MissedOrder } from '@driver/contracts';
import { Icon, Text, useTheme, withAlpha } from '@driver/ui';
import { color } from '@driver/design-tokens';
import { MIcon, type MIconName } from '@/components/MIcon';
import { useT } from '@/lib/i18n';
import type { AlarmStage } from './ladder';
import type { NewOrderSummary } from './logic';

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
}

/** "3 طلبات تنتظر · 1 مسكّت · 1 ينتظر الزبون" (or "طلب جديد!" for a single fresh order). */
export function summaryTitle(t: ReturnType<typeof useT>, s: NewOrderSummary): string {
  if (s.total <= 1 && s.snoozed === 0 && s.withCustomer === 0) return t('merchant.board.alert_new');
  const head = s.total === 1 ? t('merchant.board.alert_waiting_one') : s.total === 2 ? t('merchant.board.alert_waiting_two') : t('merchant.board.alert_waiting', { count: s.total });
  return [head, s.snoozed > 0 ? t('merchant.board.alert_state_snoozed', { count: s.snoozed }) : null, s.withCustomer > 0 ? t('merchant.board.alert_state_customer', { count: s.withCustomer }) : null].filter(Boolean).join(' · ');
}

/**
 * "طلب جديد!" — the strip over the board while new orders wait (signature S-M1). It escalates with the
 * ladder: accent while there is time, danger in the last 30 s, and in the last 10 s it names the order
 * and counts down ("باقي 7 ثواني على #3912"). "سكّت 30 ثانية" snoozes; while snoozed it says when it
 * rings again and offers "رجّع الصوت". If the browser blocks sound it offers "شغّل صوت الطلبات" first.
 */
export function NewOrderBanner({ count, snoozedCount, stage, mostUrgent, snoozeSeconds, soundBlocked, onSnooze, onUnsnooze, onEnableSound, compact = false, summary }: NewOrderBannerProps) {
  const theme = useTheme();
  const t = useT();
  const p = useSharedValue(0);
  const hot = stage === 'urgent' || stage === 'final';
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
          : t('merchant.board.final_many', { seconds, number: mostUrgent.number })
      : summary
        ? summaryTitle(t, summary)
        : total > 1
          ? t('merchant.board.alert_count', { count: total })
          : t('merchant.board.alert_new');
  const sub = !ringing && snoozeSeconds !== null ? t('merchant.board.alert_snoozed', { seconds: Math.max(1, snoozeSeconds) }) : stage === 'urgent' && seconds !== null ? t('merchant.board.alert_left', { seconds }) : null;

  const bg = !ringing ? theme.colors.warningTint : hot ? theme.colors.danger : theme.colors.accent;
  const glowColor = hot ? color.danger[700] : color.primary[400];
  const fg = !ringing ? theme.colors.warningText : hot ? theme.colors.onDanger : theme.colors.onAccent;
  const action = soundBlocked ? (
    <StripButton testID="sound-enable" tone="ink" icon="volume" label={t('merchant.sound.enable')} onPress={onEnableSound} />
  ) : ringing ? (
    <StripButton testID="alarm-snooze" tone={hot ? 'light' : 'soft'} icon="volume-off" label={t('merchant.board.alert_snooze')} onPress={onSnooze} />
  ) : (
    <StripButton testID="alarm-unsnooze" tone="ink" icon="volume" label={t('merchant.board.alert_unsnooze')} onPress={onUnsnooze} />
  );
  return (
    <View
      testID={stage === 'final' ? 'alarm-final-banner' : 'new-order-banner'}
      accessibilityLiveRegion="assertive"
      style={{ backgroundColor: bg, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: compact ? theme.space[4] : theme.space[5], paddingVertical: theme.space[3], overflow: 'hidden' }}
    >
      <View testID={`alarm-stage-${ringing ? (stage ?? 'calm') : 'snoozed'}`} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
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
    </View>
  );
}

export type InfoTone = 'danger' | 'warning' | 'neutral';

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
  const bg = tone === 'danger' ? theme.colors.dangerTint : tone === 'warning' ? theme.colors.warningTint : theme.colors.surfaceSunken;
  const fg = tone === 'danger' ? 'dangerText' : tone === 'warning' ? 'warningText' : 'text';
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
 * "طلبات فاتتك" (M-01): sticky under the header until "تمام". One miss names the order and what
 * happened; several list their numbers. A partial accept the customer let lapse says it doesn't count.
 * After two misses in 30 minutes the same strip suggests busy mode or a short close (one strip, not two).
 */
export function MissedStrip({ missed, onOk, nudge }: { missed: readonly MissedOrder[]; onOk: () => void; nudge?: { text: string; onBusy: () => void; onClose: () => void } }) {
  const t = useT();
  if (missed.length === 0) return null;
  const timeouts = missed.filter((m) => m.reason === 'merchant_timeout');
  const first = missed[0]!;
  const text =
    missed.length === 1
      ? first.reason === 'partial_timeout'
        ? t('merchant.missed.partial', { number: first.number })
        : `${t('merchant.missed.one', { number: first.number })}${first.scored ? '' : ` · ${t('merchant.missed.not_scored')}`}`
      : timeouts.length === 0
        ? t('merchant.missed.partial_many', { numbers: missed.map((m) => `#${m.number}`).join('، ') })
        : missed.length === 2
          ? t('merchant.missed.two', { numbers: missed.map((m) => `#${m.number}`).join('، ') })
          : t('merchant.missed.many', { count: missed.length, numbers: missed.slice(0, 4).map((m) => `#${m.number}`).join('، ') + (missed.length > 4 ? '…' : '') });
  return (
    <InfoStrip
      tone="danger"
      icon="bell"
      testID="missed-strip"
      text={text}
      {...(nudge ? { sub: nudge.text } : {})}
      action={{ label: t('merchant.missed.ok'), onPress: onOk, testID: 'missed-ok' }}
      {...(nudge
        ? {
            secondary: { label: t('merchant.missed.busy'), onPress: nudge.onBusy, testID: 'missed-nudge-busy' },
            more: [{ label: t('merchant.missed.close'), onPress: nudge.onClose, testID: 'missed-nudge-close' }],
          }
        : {})}
    />
  );
}
