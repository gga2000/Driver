import { useEffect, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, FadeInDown, runOnJS, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';
import { RIDE_CARGO_ORDER, rideCargoKey, type CityPricingConfig, type Quote, type QuoteComponent, type RideCargo } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, Chip, ChipGroup, formatClock, Icon, PriceBreakdown, Skeleton, Text, useTheme, withAlpha, type IconName, type PriceItem } from '@driver/ui';
import { BottomPanel } from '@/features/track/Panels';
import { useLocale, useT, type TFn } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { addNoteChip, fareLines, hour12, ruleHours, surchargeEndsInMin, type RideVertical, type Spot, type Surcharge } from './logic';
import { TAXI_ART, TUKTUK_ART } from './vehicle-art';

export const VEHICLE: Record<RideVertical, { name: MessageKey; hint: MessageKey; icon: IconName }> = {
  taxi: { name: 'ride.vehicle_taxi', hint: 'ride.vehicle_taxi_hint', icon: 'car' },
  tuktuk: { name: 'ride.vehicle_tuktuk', hint: 'ride.vehicle_tuktuk_hint', icon: 'tuktuk' },
};

// ───────────────────────── route summary ─────────────────────────

/**
 * "● من … / ■ إلى …" with a change link: the trip the quotes are for. Simple mode (ride idea v2): the
 * two places in the larger type, and no change link (the back button is the one way back).
 */
export function RouteSummary({ pickup, dropoff, onEdit, simple = false }: { pickup: Spot; dropoff: Spot; onEdit: () => void; simple?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const line = (kind: 'pickup' | 'dropoff', s: Spot) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: simple ? 40 : 30 }}>
      <View style={{ width: 16, alignItems: 'center' }}>
        {kind === 'pickup' ? (
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.success, borderWidth: 2, borderColor: theme.colors.successTint }} />
        ) : (
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: theme.colors.text }} />
        )}
      </View>
      <Text variant={simple ? 'title' : 'body'} weight={kind === 'dropoff' ? 600 : 500} numberOfLines={simple ? 2 : 1} style={{ flex: 1 }}>
        {s.title}
        {s.subtitle && s.kind !== 'zone' ? (
          <Text variant={simple ? 'body' : 'footnote'} color="textMuted">
            {`  ${s.subtitle}`}
          </Text>
        ) : null}
      </Text>
    </View>
  );
  return (
    <View testID="ride-route" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      <View style={{ flex: 1 }}>
        {line('pickup', pickup)}
        <View style={{ width: 16, alignItems: 'center' }}>
          <View style={{ width: 2, height: 8, borderRadius: 1, backgroundColor: theme.colors.border }} />
        </View>
        {line('dropoff', dropoff)}
      </View>
      {simple ? null : (
        <Pressable accessibilityRole="button" onPress={onEdit} hitSlop={8} testID="ride-edit-route" style={({ pressed }) => ({ paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderRadius: 999, backgroundColor: pressed ? theme.colors.accentTint : theme.colors.surfaceSunken })}>
          <Text variant="label" weight={600} color="accentText">
            {t('ride.edit')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ───────────────────────── surcharge banner ─────────────────────────

export function SurchargeBanner({ s, city, vertical }: { s: Surcharge; city: CityPricingConfig | undefined; vertical: RideVertical }) {
  const theme = useTheme();
  const t = useT();
  const hours = ruleHours(city, vertical, s.key);
  const text =
    s.key === 'night'
      ? t('ride.night_banner', { amount: amountParam(s.amount), from: hour12(hours?.[0] ?? 23), to: hour12(hours?.[1] ?? 5) })
      : s.key === 'peak'
        ? t('ride.peak_banner', { amount: amountParam(s.amount) })
        : t('ride.weather_banner', { amount: amountParam(s.amount) });
  // Ride idea g4: the honest tip — the surcharge ends soon, so waiting a little costs less.
  const endsIn = s.key === 'weather' ? null : surchargeEndsInMin(hours, new Date());
  return (
    <View
      testID={`ride-surcharge-${s.key}`}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2], paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: theme.colors.infoTint }}
    >
      <Icon name={s.key === 'night' ? 'clock' : 'bell'} size={16} color="infoText" strokeWidth={2.2} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="footnote" weight={600} color="infoText">
          {text}
        </Text>
        {endsIn !== null ? (
          <Text variant="footnote" color="infoText" testID={`ride-surcharge-tip-${s.key}`}>
            {t(s.key === 'night' ? 'ride.night_ends_tip' : 'ride.peak_ends_tip', { n: endsIn, amount: amountParam(s.amount) })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ───────────────────────── vehicle row ─────────────────────────

/** Width × height of the vehicle drawing's stage at the start of a row. */
const ART_W = 68;
const ART_H = 52;

/**
 * One slim row per vehicle (ride ideas c2–c4): the drawing, the name, the clock you get there
 * («توصل 11:55»: the nearest one's minutes to you plus the ride) and the price on one line. The
 * chosen row springs a little and shows «التفاصيل» under its price. A tuktuk that can't reach an edge
 * area says why on its own full-width line, with «جرّب تكتك على كل حال». Simple mode (ride idea v2):
 * the name, the clock and the price in the larger type, no «أرخص بـ» pill and no details link.
 */
export function VehicleCard({
  vertical,
  quote,
  loading,
  selected,
  disabledReason,
  minutes,
  nearMinutes,
  arriveAt,
  cheaperBy,
  fitHint = null,
  index = 0,
  simple = false,
  onPress,
  onDetails,
  onTryAnyway,
}: {
  vertical: RideVertical;
  quote: Quote | undefined;
  loading: boolean;
  selected: boolean;
  /** Tuktuk to an edge zone: why it is off, with "try anyway". */
  disabledReason: string | null;
  minutes: number | null;
  /** The nearest free one's minutes to the pickup (maps program c10); null when none is around. */
  nearMinutes: number | null;
  /** When the rider gets there if he books now (ride idea c3). */
  arriveAt: Date | null;
  cheaperBy: number | null;
  /** Ride idea x5: «الأنسب للغراض» on the tuktuk once the rider says he carries things. */
  fitHint?: string | null;
  /** Position in the list, for the entrance stagger. */
  index?: number;
  /** Simple mode (ride idea v2): larger type, nothing secondary. */
  simple?: boolean;
  onPress: () => void;
  onDetails: () => void;
  onTryAnyway?: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const v = VEHICLE[vertical];
  const off = Boolean(disabledReason);
  const motion = !theme.reduceMotion;
  const scale = useSharedValue(1);
  useEffect(() => {
    // l3: the chosen row gives a small spring, never on first paint.
    if (selected && motion) scale.value = withSequence(withTiming(0.97, { duration: 70 }), withSpring(1, { damping: 11, stiffness: 260 }));
  }, [selected, motion, scale]);
  const springStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const amount = quote ? `${amountParam(quote.total)} ${t('quote.currency')}` : '';
  return (
    <Animated.View entering={motion ? FadeInDown.delay(60 * index).springify().damping(18) : undefined} style={springStyle}>
      <Pressable
        testID={`ride-vehicle-${vertical}`}
        accessibilityRole="radio"
        aria-checked={selected}
        aria-disabled={off}
        accessibilityLabel={[t(v.name), amount, arriveAt ? t('ride.arrive_at', { time: formatClock(arriveAt, { locale }) }) : null, off ? null : fitHint].filter(Boolean).join('، ')}
        accessibilityHint={t(v.hint)}
        disabled={off}
        onPress={() => {
          theme.haptic('selection');
          onPress();
        }}
        style={({ pressed }) => ({
          borderRadius: theme.radius.xl,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? theme.colors.accent : theme.colors.border,
          backgroundColor: selected ? withAlpha(theme.colors.accentTint, 0.6) : pressed ? theme.colors.surfaceSunken : theme.colors.surface,
          paddingVertical: selected ? theme.space[2] - 1 : theme.space[2],
          paddingStart: selected ? theme.space[2] - 1 : theme.space[2],
          paddingEnd: selected ? theme.space[3] - 1 : theme.space[3],
          gap: theme.space[2],
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], opacity: off ? 0.5 : 1 }}>
          <View style={{ width: ART_W, height: ART_H, borderRadius: theme.radius.lg, backgroundColor: selected ? theme.colors.surface : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <SvgXml xml={vertical === 'taxi' ? TAXI_ART : TUKTUK_ART} width={ART_W + 6} height={ART_W + 6} style={{ marginTop: 4 }} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            {/* DEV-16: at large text the «أرخص بـ» badge drops under the name instead of running out of the card. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: theme.space[2], rowGap: 2 }}>
              <Text variant={simple ? 'heading' : 'title'} weight={700} style={simple ? undefined : { fontSize: 18, lineHeight: 26 }}>
                {t(v.name)}
              </Text>
              {cheaperBy && cheaperBy > 0 && !off && !simple ? (
                <View style={{ paddingHorizontal: 8, minHeight: 22, borderRadius: 11, justifyContent: 'center', backgroundColor: theme.colors.successTint }}>
                  <Text variant="caption" weight={600} color="successText" style={{ lineHeight: 18 }}>
                    {t('ride.cheaper_by', { amount: amountParam(cheaperBy) })}
                  </Text>
                </View>
              ) : null}
            </View>
            {fitHint && !off ? (
              <View testID={`ride-fit-${vertical}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="bag" size={13} color="accentText" strokeWidth={2.2} />
                <Text variant="caption" weight={700} color="accentText">
                  {fitHint}
                </Text>
              </View>
            ) : null}
            {off ? null : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                {arriveAt ? (
                  <Text variant={simple ? 'body' : 'caption'} weight={700} tabular testID={`ride-minutes-${vertical}`} accessibilityLabel={minutes ? t('ride.trip_minutes', { minutes }) : undefined}>
                    {t('ride.arrive_at', { time: formatClock(arriveAt, { locale }) })}
                  </Text>
                ) : null}
                {nearMinutes ? (
                  <Text variant={simple ? 'body' : 'caption'} weight={600} color="successText" tabular testID={`ride-near-${vertical}`}>
                    {/* Simple mode's larger type puts it on its own line: no joining dot. */}
                    {`${arriveAt && !simple ? '· ' : ''}${t('ride.near_short', { minutes: nearMinutes })}`}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            {quote ? (
              <Text variant={simple ? 'heading' : 'title'} tabular numberOfLines={1} testID={`ride-price-${vertical}`} style={simple ? undefined : { fontSize: 19, lineHeight: 26 }}>
                {amountParam(quote.total)}
                <Text variant={simple ? 'body' : 'caption'} weight={500} color="textMuted">
                  {` ${t('quote.currency')}`}
                </Text>
              </Text>
            ) : loading ? (
              <Skeleton width={72} height={22} />
            ) : (
              <Text variant="caption" color="dangerText">
                {t('ride.quote_failed')}
              </Text>
            )}
            {selected && quote && !off && !simple ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t('ride.price_details')} onPress={onDetails} hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }} testID={`ride-details-${vertical}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Icon name="receipt" size={13} color="accentText" strokeWidth={2.2} />
                <Text variant="caption" weight={600} color="accentText">
                  {t('ride.details_short')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        {off ? (
          <View style={{ gap: theme.space[1], paddingBottom: theme.space[1] }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
              <Icon name="map-pin" size={15} color="warningText" strokeWidth={2.2} />
              <Text variant="footnote" color="warningText" style={{ flex: 1 }} testID="ride-tuktuk-edge">
                {disabledReason}
              </Text>
            </View>
            {onTryAnyway ? (
              <Pressable accessibilityRole="button" onPress={onTryAnyway} hitSlop={10} testID="ride-tuktuk-try" style={{ alignSelf: 'flex-start', paddingStart: 23, minHeight: 28, justifyContent: 'center' }}>
                <Text variant="label" weight={600} color="accentText">
                  {t('ride.tuktuk_edge_try')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

// ───────────────────────── the weather and the bags (ride step 4) ─────────────────────────

/**
 * Ride idea x1: a small warm line under the vehicles on a hot (cold) day — «اليوم حار، نبعثلك سيارة
 * مكيّفة». Information only: the fare does not change; dispatch sends the first waves to those cars.
 */
export function ClimateLine({ climate }: { climate: 'hot' | 'cold' }) {
  const theme = useTheme();
  const t = useT();
  const hot = climate === 'hot';
  return (
    <View
      testID={`ride-climate-${climate}`}
      accessibilityRole="text"
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[3], minHeight: 36, borderRadius: theme.radius.lg, backgroundColor: hot ? theme.colors.infoTint : theme.colors.accentTint }}
    >
      <Icon name={hot ? 'snow' : 'flame'} size={16} color={hot ? 'infoText' : 'accentText'} strokeWidth={2.2} />
      <Text variant="footnote" weight={600} color={hot ? 'infoText' : 'accentText'} style={{ flex: 1 }}>
        {t(hot ? 'ride.climate_hot' : 'ride.climate_cold')}
      </Text>
    </View>
  );
}

const CARGO_ICON: Record<RideCargo, IconName> = { bags: 'bag', gas: 'flame', big: 'parcel' };

/** Ride idea x5 «عندي غراض»: three calm chips (any, all or none) in the trip options. */
export function CargoChips({ value, onChange }: { value: readonly RideCargo[]; onChange: (next: RideCargo[]) => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ gap: theme.space[2] }} testID="ride-cargo">
      <Text variant="label" weight={600} color="textMuted">
        {t('ride.cargo_title')}
      </Text>
      <ChipGroup
        accessibilityLabel={t('ride.cargo_title')}
        mode="multi"
        value={[...value]}
        onChange={(next) => onChange(RIDE_CARGO_ORDER.filter((c) => next.includes(c)))}
        items={RIDE_CARGO_ORDER.map((c) => ({ id: c, label: t(rideCargoKey(c)), icon: CARGO_ICON[c] }))}
      />
      <Text variant="footnote" color="textMuted">
        {t('ride.cargo_hint')}
      </Text>
    </View>
  );
}

/** «أكياس سوق، قنينة غاز» — the rider's picks as one phrase. */
export function cargoList(cargo: readonly RideCargo[], t: TFn): string {
  return cargo.map((c) => t(rideCargoKey(c))).join('، ');
}

// ───────────────────────── trip options ─────────────────────────

/**
 * Ride idea c7: how you pay, where he picks you up and the note in one row («كاش · أطلع للشارع ·
 * ملاحظة»); tapping it opens `RideOptionsPanel` with the full controls.
 */
export function OptionsRow({ when, payment, pickup, note, onPress }: { when: string | null; payment: string; pickup: string; note: string; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  // A ride booked for later (joy J7d) leads with its time; «هسة» is the default and goes unsaid.
  const parts = [payment, pickup, note.trim() ? `«${note.trim()}»` : t('ride.note_add')];
  return (
    <Pressable
      testID="ride-options"
      accessibilityRole="button"
      accessibilityLabel={`${t('ride.options_title')}: ${[when, ...parts].filter(Boolean).join('، ')}`}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.lg,
        backgroundColor: pressed ? theme.colors.accentTint : theme.colors.surfaceSunken,
      })}
    >
      <Icon name={when ? 'clock' : 'wallet'} size={18} color={when ? 'liveText' : 'text'} strokeWidth={2} />
      <Text variant="label" weight={600} numberOfLines={1} style={{ flex: 1 }}>
        {when ? (
          <Text variant="label" weight={700} color="liveText">
            {`${when} · `}
          </Text>
        ) : null}
        {parts[0]}
        <Text variant="label" color="textMuted">
          {` · ${parts[1]} · `}
        </Text>
        <Text variant="label" color={note.trim() ? 'text' : 'accentText'} weight={note.trim() ? 500 : 600}>
          {parts[2]}
        </Text>
      </Text>
      <Icon name="chevron-down" size={18} color="textMuted" strokeWidth={2.2} />
    </Pressable>
  );
}

/** The trip options sheet: the controls the summary row stands for, and the cancel rule. */
export function RideOptionsPanel({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <BottomPanel onClose={onClose} testID="ride-options-panel">
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }} contentContainerStyle={{ gap: theme.space[4] }}>
        <Text variant="heading">{t('ride.options_title')}</Text>
        {children}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="shield" size={15} color="successText" strokeWidth={2.2} />
          <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
            {t('ride.cancel_policy')}
          </Text>
        </View>
      </ScrollView>
      <Button label={t('action.done')} fullWidth onPress={onClose} testID="ride-options-done" />
    </BottomPanel>
  );
}

// ───────────────────────── payment ─────────────────────────

export function PayOption({ icon, title, subtitle, selected, disabled, onPress, testID }: { icon: IconName; title: string; subtitle: string; selected: boolean; disabled?: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      aria-checked={selected}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        padding: theme.space[3],
        borderRadius: theme.radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? withAlpha(theme.colors.accentTint, 0.55) : theme.colors.surface,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Icon name={icon} size={20} color={selected ? 'accentText' : 'text'} strokeWidth={2} />
      <View style={{ flex: 1 }}>
        <Text variant="label" weight={600}>
          {title}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={2} style={{ lineHeight: 17 }}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

// ───────────────────────── fare breakdown ─────────────────────────

const LINE: Partial<Record<QuoteComponent['key'], { label: MessageKey; reason?: MessageKey }>> = {
  base: { label: 'quote.base', reason: 'ride.reason_base' },
  door_pickup: { label: 'quote.door_pickup', reason: 'ride.reason_door' },
  street_pickup: { label: 'quote.street_pickup', reason: 'quote.reason.street_pickup' },
  night: { label: 'quote.night', reason: 'ride.reason_night' },
  peak: { label: 'quote.peak', reason: 'quote.reason.peak' },
  weather: { label: 'quote.rain', reason: 'quote.reason.rain' },
  wait: { label: 'quote.wait' },
  promo: { label: 'quote.promo' },
};

/** Every component of the quote with its one-line reason (voice guide §2.5). */
export function fareItems(q: Quote, t: TFn, locale: 'ar-IQ' | 'en', city: CityPricingConfig | undefined, vertical: RideVertical): PriceItem[] {
  const night = ruleHours(city, vertical, 'night');
  return fareLines(q).map((c, i) => {
    const name = LINE[c.key];
    const reason = name?.reason ? t(name.reason, { from: hour12(night?.[0] ?? 23), to: hour12(night?.[1] ?? 5) }) : undefined;
    return { key: `${c.key}${c.leg ?? i}`, label: name ? t(name.label) : locale === 'en' ? c.label_en : c.label_ar, amount: c.amount, ...(reason ? { reason } : {}) };
  });
}

export function FarePanel({ vertical, quote, city, locale, onClose }: { vertical: RideVertical; quote: Quote; city: CityPricingConfig | undefined; locale: 'ar-IQ' | 'en'; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <BottomPanel onClose={onClose} testID="ride-fare-panel">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 44, height: 44, borderRadius: theme.radius.lg, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={VEHICLE[vertical].icon} size={24} color="accentText" strokeWidth={1.9} />
        </View>
        <Text variant="heading" style={{ flex: 1 }}>
          {t('ride.breakdown_title', { vehicle: t(VEHICLE[vertical].name) })}
        </Text>
      </View>
      <PriceBreakdown items={fareItems(quote, t, locale, city, vertical)} total={quote.total} note={t('quote.quote_locked')} testID="ride-fare" />
      <Button label={t('action.ok')} variant="secondary" fullWidth onPress={onClose} testID="ride-fare-close" />
    </BottomPanel>
  );
}

/** The note's quick words (ride idea p4): what riders in Aziziyah tell a driver most. */
const NOTE_CHIPS = ['ride.note_chip_pharmacy', 'ride.note_chip_green_door', 'ride.note_chip_alley_end'] as const satisfies readonly MessageKey[];

/** One tap adds the words to the note; a chip already in it shows chosen (edit the note to drop it). */
export function NoteChips({ note, onNote }: { note: string; onNote: (note: string) => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2] }} testID="ride-note-chips">
      {NOTE_CHIPS.map((key, i) => {
        const words = t(key);
        const on = note.split('،').some((p) => p.trim() === words);
        return (
          <Chip
            key={key}
            role="button"
            label={words}
            selected={on}
            onPress={() => {
              if (on) return;
              theme.haptic('selection');
              onNote(addNoteChip(note, words));
            }}
            testID={`ride-note-chip-${i}`}
          />
        );
      })}
    </ScrollView>
  );
}

const BLOOM_MS = 520;

/**
 * Ride idea l4: after «اطلب», the button grows into the search rings — a soft disc spreading from
 * the button over the screen with two rings running ahead of it — and then the live screen opens on
 * its radar, so there is no blank jump. `onDone` navigates; under reduce-motion it runs at once.
 */
export function RequestBloom({ fromBottom, onDone }: { fromBottom: number; onDone: () => void }) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const p = useSharedValue(0);
  const cx = width / 2;
  const cy = height - fromBottom;
  // Far enough to reach the farthest corner from the button.
  const r = Math.hypot(Math.max(cx, width - cx), cy);
  useEffect(() => {
    if (theme.reduceMotion) {
      onDone();
      return;
    }
    p.value = withTiming(1, { duration: BLOOM_MS, easing: Easing.out(Easing.cubic) }, (done) => {
      if (done) runOnJS(onDone)();
    });
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const disc = useAnimatedStyle(() => ({ transform: [{ scale: 0.04 + p.value * 0.96 }] }));
  // The rings run ahead of the disc (×1.35 and ×1.7 its pace) and fade as they reach the edge.
  const ring1 = useAnimatedStyle(() => {
    const q = Math.min(1, p.value * 1.35);
    return { opacity: 0.7 * (1 - q), transform: [{ scale: 0.04 + q * 0.96 }] };
  });
  const ring2 = useAnimatedStyle(() => {
    const q = Math.min(1, p.value * 1.7);
    return { opacity: 0.7 * (1 - q), transform: [{ scale: 0.04 + q * 0.96 }] };
  });
  const circle = { position: 'absolute' as const, left: cx - r, top: cy - r, width: r * 2, height: r * 2, borderRadius: r };
  return (
    <View pointerEvents="auto" style={StyleSheet.absoluteFill} testID="ride-request-bloom" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[circle, { backgroundColor: theme.colors.accentTint }, disc]} />
      <Animated.View style={[circle, { borderWidth: 3, borderColor: theme.colors.accent }, ring1]} />
      <Animated.View style={[circle, { borderWidth: 2, borderColor: theme.colors.accent }, ring2]} />
    </View>
  );
}
