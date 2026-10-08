import { View, type StyleProp, type ViewStyle } from 'react-native';
import { formatClock, formatMinutes, pluralKey, t, type Locale } from '@driver/i18n';
import { formatAmount } from '../format';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeProvider';
import { Card } from './Card';
import { Text } from './Text';

/** The waiting clock of a «يستناك وترجع» trip (structural: the same shape as the contract's `RequestWaitClock`). */
export interface WaitClockValue {
  startedAt: Date;
  endedAt: Date | null;
  includedHours: number;
  extraHourIqd: number;
  freeMin: number;
  /** False while the extra-hour charge is switched off: the clock shows, no money does. */
  charged: boolean;
}

/** w3: the reminder this many minutes before the included hours run out. */
export const WAIT_CLOCK_REMINDER_MIN = 10;

export type WaitPhase = 'included' | 'ending' | 'grace' | 'extra' | 'done';

export interface WaitClockState {
  phase: WaitPhase;
  /** Whole minutes waited so far (or in all). */
  waitedMin: number;
  includedEndsAt: Date;
  /** When the free minutes after the included hours end. */
  graceEndsAt: Date;
  /** Minutes of included time left (0 once past). */
  leftMin: number;
  /** Minutes past the included hours (0 before). */
  overMin: number;
  /** Started extra hours (after the free minutes). */
  extraHours: number;
  /** What the extra adds to the cash (0 while the charge is off). */
  extraIqd: number;
  /** Share of the included time used, 0–1 (1 once past; 1 when nothing is included). */
  fill: number;
}

/** Where a waiting clock stands; pure, so the same numbers show in both apps and the tests. */
export function waitClockState(c: WaitClockValue, now: Date): WaitClockState {
  const end = c.endedAt ?? now;
  const waitedMin = Math.max(0, Math.floor((end.getTime() - c.startedAt.getTime()) / 60_000));
  const includedMin = c.includedHours * 60;
  const includedEndsAt = new Date(c.startedAt.getTime() + includedMin * 60_000);
  const graceEndsAt = new Date(includedEndsAt.getTime() + c.freeMin * 60_000);
  const leftMin = Math.max(0, includedMin - waitedMin);
  const overMin = Math.max(0, waitedMin - includedMin);
  const pastGrace = waitedMin - includedMin - c.freeMin;
  const extraHours = pastGrace > 0 ? Math.ceil(pastGrace / 60) : 0;
  const extraIqd = c.charged ? extraHours * c.extraHourIqd : 0;
  const phase: WaitPhase = c.endedAt
    ? 'done'
    : overMin === 0 && leftMin > WAIT_CLOCK_REMINDER_MIN
      ? 'included'
      : overMin === 0
        ? 'ending'
        : extraHours === 0
          ? 'grace'
          : 'extra';
  return { phase, waitedMin, includedEndsAt, graceEndsAt, leftMin, overMin, extraHours, extraIqd, fill: includedMin > 0 ? Math.min(1, waitedMin / includedMin) : 1 };
}

export interface WaitClockProps {
  clock: WaitClockValue;
  now: Date;
  /** `rider`: «السايق يستناك»; `driver`: «تنتظر الراكب». */
  side: 'rider' | 'driver';
  locale?: Locale;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** "2:05": hours and minutes waited, for the big number. */
function hm(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * w2–w4: one live clock both sides see. The bar fills over the included hours, turns amber in the last
 * 10 minutes (w3), and past them says plainly what happens: the free minutes, then the extra hours with
 * their price (only when the charge is on; no money is shown while it is off).
 */
export function WaitClock({ clock, now, side, locale, testID = 'wait-clock', style }: WaitClockProps) {
  const theme = useTheme();
  const s = waitClockState(clock, now);
  const tr = (key: Parameters<typeof t>[0], params?: Record<string, string | number>) => t(key, params, locale);
  const time = (d: Date) => formatClock(d, { locale });
  const over = s.phase === 'grace' || s.phase === 'extra' || (s.phase === 'done' && s.overMin > 0);
  const tone = s.phase === 'ending' || over ? 'warning' : s.phase === 'done' ? 'success' : 'accent';
  const barColor = tone === 'warning' ? theme.colors.warning : tone === 'success' ? theme.colors.success : theme.colors.accent;

  const title = s.phase === 'done' ? tr('rajaa.wait_title_done') : tr(side === 'rider' ? 'rajaa.wait_title_rider' : 'rajaa.wait_title_driver');
  const extraLine =
    clock.extraHourIqd === 0
      ? tr('rajaa.wait_over_free', { duration: formatMinutes(s.overMin, { locale }) })
      : clock.charged
        ? tr(pluralKey('rajaa.wait_extra', s.extraHours), { n: s.extraHours, amount: formatAmount(s.extraIqd) })
        : tr('rajaa.wait_over', { duration: formatMinutes(s.overMin, { locale }) });
  const line =
    clock.includedHours === 0 && !over
      ? tr('rajaa.wait_included_none')
      : s.phase === 'included'
        ? tr('rajaa.wait_included_until', { time: time(s.includedEndsAt) })
        : s.phase === 'ending'
          ? tr('rajaa.wait_left', { duration: formatMinutes(s.leftMin, { locale }) })
          : s.phase === 'grace'
            ? tr('rajaa.wait_grace', { time: time(s.graceEndsAt) })
            : s.phase === 'extra' || over
              ? extraLine
              : tr('rajaa.wait_within', { duration: formatMinutes(s.waitedMin, { locale }) });

  return (
    <Card testID={testID} padding={4} elevation={0} tone={tone === 'warning' ? 'tint' : undefined} style={style}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="clock" size={18} color={tone === 'warning' ? 'warningText' : tone === 'success' ? 'successText' : 'accentText'} />
          <Text variant="label" weight={600} style={{ flex: 1 }} accessibilityRole="header">
            {title}
          </Text>
          <Text variant="footnote" color="textMuted" tabular>
            {tr('rajaa.wait_since', { time: time(clock.startedAt) })}
          </Text>
        </View>
        <Text
          testID={`${testID}-elapsed`}
          variant="numeralSm"
          tabular
          accessibilityLabel={tr('rajaa.wait_elapsed_a11y', { duration: formatMinutes(s.waitedMin, { locale }) })}
        >
          {hm(s.waitedMin)}
        </Text>
        {clock.includedHours > 0 ? (
          <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }}>
            <View style={{ position: 'absolute', start: 0, top: 0, bottom: 0, width: `${s.fill * 100}%`, borderRadius: 4, backgroundColor: barColor }} />
          </View>
        ) : null}
        <Text testID={`${testID}-line`} variant="footnote" weight={600} color={tone === 'warning' ? 'warningText' : 'text'} tabular>
          {line}
        </Text>
      </View>
    </Card>
  );
}
