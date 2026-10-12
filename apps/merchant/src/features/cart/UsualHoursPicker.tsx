import { Pressable, View } from 'react-native';
import type { CartUsualHours } from '@driver/contracts';
import { Icon, Text, useTheme } from '@driver/ui';
import { timeLabel } from '@/features/hours/logic';
import { useT, type TKey } from '@/lib/i18n';

/** Half-hour steps; a cart's day runs from 6 الصبح to 6 الصبح, so «6 المغرب → 1 بالليل» never wraps. */
const STEP = 30;
const DAY = 24 * 60;
const DAY_START = 6 * 60;

/** "HH:MM" → minutes since 6 الصبح. */
export function dayMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return (h * 60 + m - DAY_START + DAY) % DAY;
}
/** Minutes since 6 الصبح → "HH:MM". */
export function clockOf(min: number): string {
  const m = (min + DAY_START) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** The usual carts of Aziziyah, one tap each; the steppers fine-tune. */
const PRESETS: { key: TKey; hours: CartUsualHours }[] = [
  { key: 'merchant.cart.preset_morning', hours: { from: '06:00', to: '11:00' } },
  { key: 'merchant.cart.preset_afternoon', hours: { from: '16:00', to: '22:00' } },
  { key: 'merchant.cart.preset_evening', hours: { from: '18:00', to: '00:00' } },
  { key: 'merchant.cart.preset_late', hours: { from: '20:00', to: '02:00' } },
];

/** Where the band's words sit along the day (minutes since 6 الصبح). */
const MARKS: { key: TKey; at: number }[] = [
  { key: 'merchant.cart.mark_noon', at: 6 * 60 },
  { key: 'merchant.cart.mark_sunset', at: 12 * 60 },
  { key: 'merchant.cart.mark_midnight', at: 18 * 60 },
];

/**
 * «متى تفتح عادة؟» (Ali 2026-10-12: the hour grid was bad). One look at the day: a band from 6 الصبح to
 * 6 الصبح with tonight's hours in fuchsia. A tap on a usual pattern («من المغرب لنص الليل») sets both
 * ends, and two rows («أفتح ‹ 6 المغرب ›», «أسد ‹ 12 بالليل ›») move each end by half an hour.
 */
export function UsualHoursPicker({ value, onChange }: { value: CartUsualHours; onChange: (v: CartUsualHours) => void }) {
  const theme = useTheme();
  const t = useT();
  const c = theme.services.carts;
  const from = dayMinutes(value.from);
  // "00:00" closing is the end of the cart's night, not its start.
  const toRaw = dayMinutes(value.to);
  const to = toRaw <= from ? toRaw + DAY : toRaw;
  const end = Math.min(to, DAY);

  const setFrom = (f: number) => {
    const nf = Math.max(0, Math.min(DAY - STEP, f));
    const span = end - from;
    onChange({ from: clockOf(nf), to: clockOf(Math.min(DAY, nf + span)) });
  };
  const setTo = (e: number) => onChange({ from: value.from, to: clockOf(Math.max(from + STEP, Math.min(DAY, e))) });

  const active = PRESETS.find((p) => p.hours.from === value.from && p.hours.to === value.to)?.key;

  return (
    <View style={{ gap: theme.space[4] }} testID="cart-usual-picker">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        {PRESETS.map((p) => {
          const selected = active === p.key;
          return (
            <Pressable
              key={p.key}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => {
                theme.haptic('selection');
                onChange(p.hours);
              }}
              testID={`cart-preset-${p.key.split('_').pop()}`}
              style={({ pressed }) => ({ minHeight: 44, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[4], justifyContent: 'center', borderWidth: selected ? 0 : 1, borderColor: theme.colors.border, backgroundColor: selected ? c.fill : pressed ? theme.colors.surfaceSunken : theme.colors.surface })}
            >
              <Text variant="label" weight={selected ? 700 : 500} style={selected ? { color: c.on } : undefined}>
                {t(p.key)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, padding: theme.space[4], gap: theme.space[4], ...theme.elevation[1] }}>
        <DayBand from={from} end={end} />
        <View style={{ height: 1, backgroundColor: theme.colors.border }} />
        <EndRow label={t('merchant.cart.usual_from')} time={timeLabel(t, value.from)} onLess={() => setFrom(from - STEP)} onMore={() => setFrom(from + STEP)} lessOff={from <= 0} moreOff={from >= DAY - STEP} testID="cart-usual-from" />
        <EndRow label={t('merchant.cart.usual_to')} time={timeLabel(t, clockOf(end))} onLess={() => setTo(end - STEP)} onMore={() => setTo(end + STEP)} lessOff={end <= from + STEP} moreOff={end >= DAY} testID="cart-usual-to" />
      </View>
    </View>
  );
}

/** The day as a band, 6 الصبح at the start edge, with the open hours in fuchsia and a few words under it. */
function DayBand({ from, end }: { from: number; end: number }) {
  const theme = useTheme();
  const t = useT();
  const c = theme.services.carts;
  const pct = (m: number) => `${(m / DAY) * 100}%` as const;
  return (
    <View style={{ gap: theme.space[2] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ height: 28, borderRadius: 14, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }}>
        {/* The night: 6 المغرب to 6 الصبح, a shade darker. */}
        <View style={{ position: 'absolute', top: 0, bottom: 0, start: pct(12 * 60), end: 0, backgroundColor: theme.colors.text, opacity: 0.08 }} />
        <View testID="cart-usual-band" style={{ position: 'absolute', top: 4, bottom: 4, start: pct(from), width: pct(end - from), borderRadius: 10, backgroundColor: c.fill }} />
      </View>
      <View style={{ height: 18 }}>
        {MARKS.map((m) => (
          <View key={m.key} style={{ position: 'absolute', start: pct(m.at), width: 80, marginStart: -40, alignItems: 'center' }}>
            <Text variant="caption" color="textMuted" numberOfLines={1}>
              {t(m.key)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** «أفتح  ‹ 6 المغرب ›»: one end of the hours, half an hour per tap. */
function EndRow({ label, time, onLess, onMore, lessOff, moreOff, testID }: { label: string; time: string; onLess: () => void; onMore: () => void; lessOff: boolean; moreOff: boolean; testID: string }) {
  const theme = useTheme();
  const t = useT();
  const button = (icon: 'minus' | 'plus', off: boolean, onPress: () => void, a11y: string, id: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      testID={id}
      style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface, opacity: off ? 0.35 : 1 })}
    >
      <Icon name={icon} size={22} color={theme.colors.text} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }} testID={testID}>
      <Text variant="body" color="textMuted" style={{ width: 52 }}>
        {label}
      </Text>
      {button('minus', lessOff, onLess, t('merchant.cart.usual_earlier'), `${testID}-less`)}
      <Text variant="title" face="display" align="center" tabular style={{ flex: 1 }} accessibilityLiveRegion="polite">
        {time}
      </Text>
      {button('plus', moreOff, onMore, t('merchant.cart.usual_later'), `${testID}-more`)}
    </View>
  );
}
