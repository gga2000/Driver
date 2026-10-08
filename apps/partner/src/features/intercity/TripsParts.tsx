import { useMemo, useState } from 'react';
import { Image, Pressable, View, type ImageSourcePropType, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { partnerServices, partnerThemes, type ThemeColors } from '@driver/design-tokens';
import type { DriverDepartureView, IntercitySeatId, IntercitySeatLayout } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, DepartureTime, Icon, ModalSheet, Rule, StatusPill, Text, ThemeProvider, useSelectSpring, useTheme, withAlpha, type CarArtLayout, type IconName, type StatusTone, type Theme } from '@driver/ui';
import { useT, type TFn } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { PinPad } from './DepartureParts';
import { TripsActions, useTripsColors } from './TripsColors';
import { seatLook } from './GarageParts';
import { departureState, riderName, seatName, statusLabel } from './labels';
import { clockLabel, walkUpCash, type SeatOccupant } from './logic';

/**
 * الرجعة in the trips' own colours (partner redesign i1/i2/f1, Ali's Yes): date brown with gold. The
 * garage page opens on a brown band with the departure time on gold split-flap tiles, his own car seen
 * from above with every seat filling as riders board, a boarding-code sheet that goes rider by rider,
 * and the riders on board by seat for «وصلنا». Seats never say «رجال» or «نساء» (riders stopped choosing).
 */

/** The departure time on gold tiles with brown digits, for the brown band. */
export function GoldTime({ at, now, note, countdown, size = 'hero' }: { at: Date; now: Date; note?: string; countdown: boolean; size?: 'card' | 'hero' }) {
  const theme = useTheme();
  const trips = useTripsColors();
  const band = theme.services.trips;
  const colors = useMemo<ThemeColors>(
    () => ({ ...theme.colors, text: trips.on, bg: trips.fill, textMuted: withAlpha(band.on, 0.78), warningText: band.sub ?? trips.on }),
    [theme.colors, trips, band],
  );
  return (
    <ThemeProvider theme={theme.name} colors={colors} fonts={theme.fonts} haptics={theme.haptic} direction={theme.direction} reduceMotion={theme.reduceMotion}>
      <DepartureTime testID="departure-time" at={at} now={now.getTime()} size={size} countdown={countdown} note={note} />
    </ThemeProvider>
  );
}

/** Seats already sold (booked or boarded, walk-ups included) and how many of them are in the car. */
export function seatCounts(dep: Pick<DriverDepartureView, 'fill' | 'bookings' | 'walkUps'>): { sold: number; total: number; boarded: number; toBoard: number; free: number } {
  let boarded = dep.walkUps.length;
  let toBoard = 0;
  for (const b of dep.bookings) {
    if (b.state === 'checked_in' || b.state === 'completed') boarded += b.seatIds.length;
    else if (b.state === 'booked') toBoard += b.seatIds.length;
  }
  const sold = dep.fill.booked + dep.fill.walkUps;
  return { sold, total: dep.fill.seatsTotal, boarded, toBoard, free: Math.max(0, dep.fill.seatsTotal - sold - dep.fill.held) };
}

function seatsLeftLabel(t: TFn, n: number): string {
  if (n <= 0) return t('partner.ic_seats_left_none');
  if (n === 1) return t('partner.ic_seats_left_one');
  if (n === 2) return t('partner.ic_seats_left_two');
  return t('partner.ic_seats_left_few', { n });
}

/** The car as the board shows it: model, colour, plate. */
export function carLine(t: TFn, v: DriverDepartureView['vehicle']): string {
  const model = v.modelKey && v.modelKey !== 'other' ? t(`vehicle.model_${v.modelKey}` as MessageKey) : v.model;
  return [model, v.color, v.plate].filter(Boolean).join(' · ');
}

const STATE_TONE: Record<DriverDepartureView['state'], StatusTone> = {
  scheduled: 'neutral',
  boarding: 'accent',
  departed: 'info',
  arrived: 'success',
  closed: 'neutral',
  cancelled_by_driver: 'danger',
  cancelled_low_fill: 'danger',
};

/**
 * The garage band (i1): where to, the time big on gold tiles, the car, and the seats in one line —
 * "2 من 4 مقاعد · باقي مقعدين" — all in date brown and gold.
 */
export function TripsBand({ dep, from, to, now, note, orFull }: { dep: DriverDepartureView; from: string; to: string; now: Date; note?: string; orFull?: string }) {
  const theme = useTheme();
  const t = useT();
  const band = theme.services.trips;
  const trips = useTripsColors();
  const open = dep.state === 'scheduled' || dep.state === 'boarding';
  const c = seatCounts(dep);
  return (
    <View testID="departure-hero" style={{ backgroundColor: band.fill, borderRadius: theme.radius.xl, padding: theme.space[5], gap: theme.space[4], overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title" weight={700} color={band.on} numberOfLines={2}>
            {t('rajaa.route', { from, to })}
          </Text>
          <Text variant="footnote" weight={600} color={withAlpha(band.on, 0.72)} numberOfLines={1} tabular>
            {carLine(t, dep.vehicle)}
          </Text>
        </View>
        <StatusPill label={departureState(t, dep.state)} tone={STATE_TONE[dep.state]} live={dep.state === 'boarding' || dep.state === 'departed'} size="sm" />
      </View>
      <View style={{ gap: 2 }}>
        <GoldTime at={dep.departAt} now={now} countdown={open} note={note} />
        {orFull ? (
          <Text variant="footnote" weight={600} color={withAlpha(band.on, 0.72)} tabular>
            {orFull}
          </Text>
        ) : null}
      </View>
      <View style={{ gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: theme.space[3] }}>
          <Text variant="bodyStrong" weight={700} color={trips.on} tabular>
            {t('intercity.fill', { filled: c.sold, total: c.total })}
          </Text>
          <Text variant="footnote" weight={600} color={withAlpha(band.on, 0.78)} tabular>
            {[c.boarded > 0 ? t('partner.ic_fill_checked', { n: c.boarded }) : null, open ? seatsLeftLabel(t, c.free) : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <BandSeats dep={dep} />
      </View>
    </View>
  );
}

/** One gold bar per seat on the band: boarded full gold, sold outlined gold, free a faint line. */
export function BandSeats({ dep }: { dep: Pick<DriverDepartureView, 'seats' | 'bookings' | 'walkUps'> }) {
  const theme = useTheme();
  const trips = useTripsColors();
  const band = theme.services.trips;
  const tone = new Map<IntercitySeatId, 'in' | 'sold' | 'held' | 'free'>();
  for (const s of dep.seats) tone.set(s.id, 'free');
  for (const w of dep.walkUps) tone.set(w.seatId, 'in');
  for (const b of dep.bookings) {
    if (b.state === 'no_show' || b.state === 'cancelled' || b.state === 'expired') continue;
    for (const id of b.seatIds) tone.set(id, b.state === 'checked_in' || b.state === 'completed' ? 'in' : b.state === 'held' ? 'held' : 'sold');
  }
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} accessible={false}>
      {dep.seats.map((s) => {
        const v = tone.get(s.id) ?? 'free';
        return (
          <View
            key={s.id}
            testID={`band-seat-${s.id}-${v}`}
            style={{
              flex: 1,
              height: 10,
              borderRadius: 5,
              backgroundColor: v === 'in' ? trips.on : v === 'sold' ? withAlpha(trips.on, 0.28) : 'transparent',
              borderWidth: 1.5,
              borderStyle: v === 'held' ? 'dashed' : 'solid',
              borderColor: v === 'free' ? withAlpha(band.on, 0.3) : trips.on,
            }}
          />
        );
      })}
    </View>
  );
}

// ───────────────────────── his own car from above (i2) ─────────────────────────

const MARK = 44;
/** The painting is always light, so its marks use the sun palette in both schemes (like `CarSeatArt`). */
const SUN = partnerThemes.sun;

interface Mark {
  bg: string;
  border: string;
  fg: string;
  icon: IconName;
  dashed: boolean;
}

function markOf(theme: Theme, t: TFn, occ: SeatOccupant, editable: boolean): Mark {
  const l = seatLook({ ...theme, colors: SUN }, t, occ, editable);
  if (occ.kind === 'free') return { bg: withAlpha(SUN.surface, 0.82), border: SUN.accent, fg: SUN.accentText, icon: editable ? 'plus' : 'seat', dashed: true };
  if (occ.kind === 'rider' && occ.status === 'held') return { bg: SUN.warningTint, border: SUN.warning, fg: SUN.warningText, icon: 'clock', dashed: true };
  // Everyone else: a solid disc in the state's colour with a white sign, readable on the painting.
  const late = occ.kind === 'rider' && occ.status === 'late';
  return { bg: l.border, border: SUN.surface, fg: SUN.surface, icon: late ? 'phone' : l.icon, dashed: false };
}

function ArtSeat({ occ, at, tagW, editable, onPress }: { occ: SeatOccupant; at: { left: number; top: number }; tagW: number; editable: boolean; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  const m = markOf(theme, t, occ, editable);
  const l = seatLook(theme, t, occ, editable);
  // A seat that just filled (a rider boarded, a walk-up sat down) pops once; nothing loops.
  const filled = occ.kind === 'walkup' || (occ.kind === 'rider' && (occ.status === 'checked_in' || occ.status === 'completed'));
  const pop = useSelectSpring(filled);
  const tag = occ.kind === 'rider' ? riderName(t, occ.firstName) : occ.kind === 'walkup' ? t('partner.ic_seat_walkup') : t('partner.ic_seat_free');
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: at.left - tagW / 2, top: at.top - MARK / 2, width: tagW, alignItems: 'center' }}>
      <Pressable
        testID={`gseat-${occ.seatId}`}
        accessibilityRole="button"
        accessibilityLabel={[seatName(t, occ.seatId), l.title, l.sub, l.extra].filter(Boolean).join('، ')}
        hitSlop={4}
        onPress={() => {
          theme.haptic('selection');
          onPress();
        }}
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.92 : 1 }] })}
      >
        <Animated.View
          style={[
            {
              width: MARK,
              height: MARK,
              borderRadius: MARK / 2,
              backgroundColor: m.bg,
              borderWidth: m.dashed ? 2.5 : 3,
              borderStyle: m.dashed ? 'dashed' : 'solid',
              borderColor: m.border,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: SUN.shadow,
              shadowOpacity: 0.28,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 3 },
              elevation: 4,
            },
            pop,
          ]}
        >
          <Icon name={m.icon} size={20} color={m.fg} strokeWidth={2.6} />
        </Animated.View>
      </Pressable>
      <View pointerEvents="none" style={{ marginTop: 4, maxWidth: tagW, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: occ.kind === 'rider' ? SUN.inverse : SUN.surface }}>
        <Text variant="caption" weight={700} compact numberOfLines={1} color={occ.kind === 'rider' ? SUN.onInverse : SUN.textMuted}>
          {tag}
        </Text>
      </View>
    </View>
  );
}

/**
 * i2: his own car painted from above (the same picture his riders book on), a disc on every seat in
 * its state's colour and sign, the rider's first name under it. Tap a seat: the rider's sheet or the
 * walk-up sheet, exactly like the drawn map. Physical layout: never mirrored.
 */
export function CarArtSeats({
  art,
  layout,
  occupants,
  editable,
  onSeat,
  maxWidth = 360,
}: {
  art: CarArtLayout & { source: ImageSourcePropType; layout: IntercitySeatLayout };
  layout: IntercitySeatLayout;
  occupants: Map<IntercitySeatId, SeatOccupant>;
  editable: boolean;
  onSeat: (occ: SeatOccupant) => void;
  maxWidth?: number;
}) {
  const theme = useTheme();
  const t = useT();
  const [box, setBox] = useState(0);
  const width = Math.min(maxWidth, box || maxWidth);
  const height = width / art.aspect;
  const pos = (p: { x: number; y: number }) => ({ left: (p.x / 100) * width, top: (p.y / 100) * height });
  const ids = Object.keys(art.seats) as IntercitySeatId[];
  // Name tags as wide as the gap to the nearest seat on the same row allows.
  const tagW = (id: IntercitySeatId) => {
    const me = art.seats[id]!;
    const gaps = ids.filter((o) => o !== id && Math.abs(art.seats[o]!.y - me.y) < 6).map((o) => (Math.abs(art.seats[o]!.x - me.x) / 100) * width);
    return Math.max(MARK + 4, Math.min(84, ...gaps.map((g) => g - 4)));
  };
  return (
    <View onLayout={(e: LayoutChangeEvent) => setBox(e.nativeEvent.layout.width)} style={{ alignItems: 'center', backgroundColor: art.background, borderRadius: theme.radius.xl, overflow: 'hidden' }}>
      <View testID="garage-seatmap" accessibilityLabel={t('seat.map_label')} style={{ width, height, direction: 'ltr' }}>
        <Image source={art.source} accessible={false} resizeMode="contain" style={{ width, height }} />
        <View
          accessible
          accessibilityLabel={t('seat.driver')}
          pointerEvents="none"
          style={{ position: 'absolute', left: pos(art.driver).left - 30, top: pos(art.driver).top - 17, width: 60, alignItems: 'center' }}
        >
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: SUN.inverse, borderWidth: 2, borderColor: partnerServices.sun.trips.on, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="car" size={17} color={partnerServices.sun.trips.on} strokeWidth={2.4} />
          </View>
          <View style={{ marginTop: 4, paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999, backgroundColor: SUN.surface }}>
            <Text variant="caption" weight={700} compact color={SUN.text}>
              {t('partner.ic_seat_you')}
            </Text>
          </View>
        </View>
        {ids.map((id) => {
          if (layout !== art.layout) return null;
          const occ = occupants.get(id) ?? { kind: 'free' as const, seatId: id, premiumIqd: 0 };
          return <ArtSeat key={id} occ={occ} at={pos(art.seats[id]!)} tagW={tagW(id)} editable={editable} onPress={() => onSeat(occ)} />;
        })}
      </View>
    </View>
  );
}

/**
 * Under the painted car: one row per seat in seat order, each with the same disc, the name, the seat
 * and what is going on ("متأخر 6 دقيقة · إلك 1,000 دينار"), so nothing is said by colour alone.
 */
export function SeatRoster({ dep, occupants, editable, onSeat }: { dep: DriverDepartureView; occupants: Map<IntercitySeatId, SeatOccupant>; editable: boolean; onSeat: (occ: SeatOccupant) => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="seat-roster" style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.space[4] }}>
      {dep.seats.map((s, i) => {
        const occ = occupants.get(s.id) ?? { kind: 'free' as const, seatId: s.id, premiumIqd: s.premiumIqd };
        const l = seatLook(theme, t, occ, editable);
        const m = markOf(theme, t, occ, editable);
        const title = occ.kind === 'free' ? t('partner.ic_seat_free') : l.title;
        const sub =
          occ.kind === 'free'
            ? editable
              ? t('partner.gm_walkup_cash', { amount: amountParam(walkUpCash(dep, s.id)) })
              : seatName(t, s.id)
            : [occ.kind === 'rider' ? statusLabel(t, occ.status, occ.booking) : null, l.extra].filter(Boolean).join(' · ') || l.sub;
        const tappable = occ.kind === 'rider' || editable;
        return (
          <View key={s.id}>
            {i > 0 ? <Rule /> : null}
            <Pressable
              testID={`roster-${s.id}`}
              accessibilityRole="button"
              disabled={!tappable}
              accessibilityLabel={[seatName(t, s.id), title, sub].join('، ')}
              onPress={() => {
                theme.haptic('selection');
                onSeat(occ);
              }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 56, paddingVertical: theme.space[2], opacity: pressed ? 0.7 : 1 })}
            >
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: m.bg, borderWidth: 2, borderStyle: m.dashed ? 'dashed' : 'solid', borderColor: m.dashed ? m.border : m.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={m.icon} size={15} color={m.fg} strokeWidth={2.6} />
              </View>
              <View style={{ flex: 1, gap: 0 }}>
                <Text variant="label" weight={700} numberOfLines={1}>
                  {`${title} · ${seatName(t, s.id)}`}
                </Text>
                <Text variant="caption" weight={600} color={l.fg} numberOfLines={1} tabular>
                  {sub}
                </Text>
              </View>
              {tappable ? <Icon name="chevron-forward" size={16} color="textMuted" strokeWidth={2.4} /> : null}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

// ───────────────────────── boarding code, rider by rider (f1) ─────────────────────────

export interface CodeMatch {
  name: string;
  seats: string;
  at: Date;
}

/**
 * «رمز الصعود 2 من 4»: four big boxes and the keypad; the matched rider confirmed in green with the
 * first name and seat, then «الراكب الجاي» clears the boxes for the next one. The PIN stays on the
 * rider's phone: the driver only ever types it.
 */
export function BoardingCodeSheet({
  open,
  onClose,
  boarded,
  total,
  pin,
  error,
  busy,
  match,
  onKey,
  onNext,
}: {
  open: boolean;
  onClose: () => void;
  boarded: number;
  total: number;
  pin: string;
  error: boolean;
  busy: boolean;
  match: CodeMatch | null;
  onKey: (key: string) => void;
  onNext: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const allIn = total > 0 && boarded >= total;
  return (
    <ModalSheet
      visible={open}
      onClose={onClose}
      testID="code-sheet"
      title={t('partner.ic_pin_title')}
      aside={<StatusPill size="sm" tone={allIn ? 'success' : 'accent'} label={t('partner.ic_code_count', { n: boarded, total })} />}
      footer={
        match ? (
          <TripsActions>
            <Button testID="code-next" label={allIn ? t('partner.ic_code_done') : t('partner.ic_code_next')} variant="ink" size="lg" fullWidth onPress={allIn ? onClose : onNext} />
          </TripsActions>
        ) : undefined
      }
    >
      <View style={{ gap: theme.space[4] }}>
        {match ? (
          <View testID="code-ok" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], backgroundColor: theme.colors.successTint, borderRadius: theme.radius.lg, borderWidth: 1.5, borderColor: theme.colors.success, padding: theme.space[4] }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={22} color={theme.colors.surface} strokeWidth={2.8} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong" weight={700} numberOfLines={1}>
                {`${match.name} · ${match.seats}`}
              </Text>
              <Text variant="footnote" weight={600} color="successText" tabular>
                {t('partner.ic_code_ok', { time: clockLabel(match.at) })}
              </Text>
            </View>
          </View>
        ) : (
          <>
            <Text variant="footnote" color={error ? 'dangerText' : 'textMuted'} align="center" testID="code-hint">
              {error ? t('partner.ic_code_wrong') : t('partner.ic_pin_hint')}
            </Text>
            <PinPad pin={pin} onKey={onKey} busy={busy} error={error} />
          </>
        )}
      </View>
    </ModalSheet>
  );
}

// ───────────────────────── on the road (f1) ─────────────────────────

/** Who is in the car, by seat, so he can count them by eye before «وصلنا». */
export function AboardList({ dep, names }: { dep: DriverDepartureView; names: Map<string, string | null> }) {
  const theme = useTheme();
  const t = useT();
  const rows: { seat: IntercitySeatId; who: string }[] = [];
  for (const b of dep.bookings) {
    if (b.state !== 'checked_in' && b.state !== 'completed') continue;
    for (const id of b.seatIds) rows.push({ seat: id, who: riderName(t, names.get(b.bookingId)) });
  }
  for (const w of dep.walkUps) rows.push({ seat: w.seatId, who: t('partner.ic_seat_walkup') });
  const order = new Map(dep.seats.map((s, i) => [s.id, i]));
  rows.sort((a, b) => (order.get(a.seat) ?? 0) - (order.get(b.seat) ?? 0));
  return (
    <View testID="aboard" style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[4], gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Text variant="label" weight={700} style={{ flex: 1 }}>
          {t('partner.ic_aboard_title')}
        </Text>
        <StatusPill size="sm" tone="neutral" label={t('partner.ic_aboard_count', { n: rows.length })} />
      </View>
      {rows.map((r, i) => (
        <View key={`${r.seat}-${i}`}>
          {i > 0 ? <Rule /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 44 }}>
            <Icon name="check" size={16} color="successText" strokeWidth={2.6} />
            <Text variant="label" weight={700} style={{ flex: 1 }} numberOfLines={1}>
              {r.who}
            </Text>
            <Text variant="footnote" color="textMuted">
              {seatName(t, r.seat)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
