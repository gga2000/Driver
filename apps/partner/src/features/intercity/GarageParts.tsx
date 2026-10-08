import { Pressable, View, useWindowDimensions } from 'react-native';
import type { DriverDepartureView, IntercitySeatId, IntercitySeatLayout, TravellingAs } from '@driver/contracts';
import { Button, Chip, Icon, ModalSheet, SEAT_ROWS, StatusPill, Text, useTheme, type IconName, type Theme } from '@driver/ui';
import { CALLS_LIVE } from '@/features/chat/calls';
import { useT, type TFn } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { statusTone, PinPad } from './DepartureParts';
import { legendLabel, paymentLabel, pickupLabel, riderName, seatName, statusLabel, travellingAsLabel } from './labels';
import { clockLabel, garageCell, meterMoney, walkUpCash, type LegendState, type SeatOccupant } from './logic';

/**
 * الرجعة garage mode (partner audit S-5): at the garage the seat map is the page. Every seat says who
 * sits there and where they are with a colour, an icon and words (never colour alone); a booked
 * seat opens that rider's PIN sheet, an empty one the walk-up sheet. Physical layout: front at the
 * top, driver on the left, never mirrored.
 */

type Fg = 'text' | 'textMuted' | 'successText' | 'infoText' | 'warningText' | 'dangerText' | 'accentText';

interface SeatLook {
  bg: string;
  border: string;
  dashed: boolean;
  fg: Fg;
  icon: IconName;
  title: string;
  sub: string;
  /** Third line: the late meter "إلك 1,000 دينار". */
  extra: string | null;
}

/** Colours, icon and words of a seat, per state (the legend uses the same). */
export function seatLook(theme: Theme, t: TFn, occ: SeatOccupant, editable: boolean): SeatLook {
  const c = theme.colors;
  if (occ.kind === 'free') {
    const front = occ.seatId === 'front';
    return {
      bg: front ? c.accentTint : c.surface,
      border: front ? c.accent : c.borderStrong,
      dashed: true,
      fg: front ? 'accentText' : 'textMuted',
      icon: editable ? 'plus' : 'seat',
      title: t('partner.ic_seat_free'),
      sub: occ.premiumIqd > 0 ? amountParam(occ.premiumIqd, { sign: true }) : seatName(t, occ.seatId),
      extra: null,
    };
  }
  if (occ.kind === 'walkup') {
    return { bg: c.infoTint, border: c.info, dashed: false, fg: 'infoText', icon: 'garage', title: t('partner.ic_seat_walkup'), sub: occ.travellingAs ? travellingAsLabel(t, occ.travellingAs) : seatName(t, occ.seatId), extra: null };
  }
  const s = occ.status;
  const name = riderName(t, occ.firstName);
  if (s === 'checked_in' || s === 'completed') {
    const at = occ.booking.checkedInAt;
    return { bg: c.successTint, border: c.success, dashed: false, fg: 'successText', icon: 'check', title: name, sub: at ? t('partner.gm_boarded_at', { time: clockLabel(at) }) : statusLabel(t, s, occ.booking), extra: null };
  }
  if (s === 'late') {
    const m = meterMoney(occ.booking.meterMinutes);
    return {
      bg: c.dangerTint,
      border: c.danger,
      dashed: false,
      fg: 'dangerText',
      icon: 'phone',
      title: name,
      sub: statusLabel(t, s, occ.booking),
      extra: m.toDriverIqd > 0 ? t('partner.gm_meter_yours', { amount: amountParam(m.toDriverIqd) }) : null,
    };
  }
  if (s === 'held' || s === 'pickup_pending') {
    return { bg: c.warningTint, border: c.warning, dashed: s === 'held', fg: 'warningText', icon: s === 'held' ? 'clock' : 'home', title: name, sub: statusLabel(t, s, occ.booking), extra: null };
  }
  if (s === 'at_garage') {
    return { bg: c.infoTint, border: c.info, dashed: false, fg: 'infoText', icon: 'map-pin', title: name, sub: statusLabel(t, s, occ.booking), extra: null };
  }
  return { bg: c.surface, border: c.text, dashed: false, fg: 'textMuted', icon: 'user', title: name, sub: statusLabel(t, s, occ.booking), extra: null };
}

export function GarageSeatMap({
  layout,
  occupants,
  editable,
  onSeat,
}: {
  layout: IntercitySeatLayout;
  occupants: Map<IntercitySeatId, SeatOccupant>;
  editable: boolean;
  onSeat: (occ: SeatOccupant) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const { width: screen } = useWindowDimensions();
  const rows = SEAT_ROWS[layout];
  const gap = 8;
  const padX = 14;
  const padTop = 46;
  const padBottom = 28;
  const cell = garageCell(screen, { gap, padX });
  const width = cell.w * 3 + gap * 2 + padX * 2;
  const height = padTop + rows.length * cell.h + (rows.length - 1) * gap + padBottom;
  return (
    <View style={{ alignItems: 'center' }}>
      <View testID="garage-seatmap" accessibilityLabel={t('seat.map_label')} style={{ width, height, direction: 'ltr' }}>
        {/* The car, top-down: body and a windscreen arc. */}
        <View style={{ position: 'absolute', top: 0, left: 2, right: 2, bottom: 0, borderRadius: 48, borderTopLeftRadius: 72, borderTopRightRadius: 72, backgroundColor: theme.colors.surfaceSunken, borderWidth: 1.5, borderColor: theme.colors.border }} />
        <View style={{ position: 'absolute', top: 16, left: 44, right: 44, height: 12, borderTopLeftRadius: 44, borderTopRightRadius: 44, borderTopWidth: 2, borderColor: theme.colors.borderStrong }} />
        <View style={{ position: 'absolute', top: padTop, left: padX, gap }}>
          {rows.map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', gap }}>
              {row.map((c, ci) => {
                if (c === null) return <View key={ci} style={{ width: cell.w, height: cell.h }} />;
                if (c === 'driver') return <DriverSeat key={ci} w={cell.w} h={cell.h} />;
                const occ = occupants.get(c) ?? { kind: 'free' as const, seatId: c, premiumIqd: 0 };
                return <GarageSeat key={ci} occ={occ} w={cell.w} h={cell.h} editable={editable} onPress={() => onSeat(occ)} />;
              })}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function DriverSeat({ w, h }: { w: number; h: number }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View accessible accessibilityLabel={t('seat.driver')} style={{ width: w, height: h, borderRadius: 18, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: theme.colors.surface, borderWidth: 1.5, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <Icon name="car" size={22} color="textMuted" />
      <Text variant="caption" color="textMuted">
        {t('seat.driver')}
      </Text>
    </View>
  );
}

function GarageSeat({ occ, w, h, editable, onPress }: { occ: SeatOccupant; w: number; h: number; editable: boolean; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  const l = seatLook(theme, t, occ, editable);
  // A late rider's seat leads with the call: "اتصل" over the name, the minutes and the meter.
  const call = occ.kind === 'rider' && occ.status === 'late';
  return (
    <Pressable
      testID={`gseat-${occ.seatId}`}
      accessibilityRole="button"
      accessibilityLabel={[seatName(t, occ.seatId), l.title, l.sub, l.extra, call ? t('partner.gm_call') : null].filter(Boolean).join('، ')}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        width: w,
        height: h,
        borderRadius: 18,
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        backgroundColor: l.bg,
        borderWidth: occ.kind === 'rider' && occ.status === 'late' ? 2.5 : 1.5,
        borderStyle: l.dashed ? 'dashed' : 'solid',
        borderColor: l.border,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 6,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      {call ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="phone" size={16} color={l.fg} strokeWidth={2.4} />
          <Text variant="caption" weight={700} color={l.fg} compact style={{ lineHeight: 20 }}>
            {t('partner.gm_call')}
          </Text>
        </View>
      ) : (
        <Icon name={l.icon} size={20} color={l.fg} strokeWidth={2.4} />
      )}
      <Text variant="label" weight={700} numberOfLines={1} color={occ.kind === 'rider' ? 'text' : l.fg} style={{ lineHeight: 22 }}>
        {l.title}
      </Text>
      <Text variant="caption" weight={600} numberOfLines={1} color={l.fg} tabular compact style={{ lineHeight: 18 }}>
        {l.sub}
      </Text>
      {l.extra ? (
        <Text variant="caption" weight={700} numberOfLines={1} color={l.fg} tabular compact style={{ lineHeight: 18 }}>
          {l.extra}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** The legend under the map: swatch + icon + word for each state on it. */
export function GarageLegend({ states }: { states: readonly LegendState[] }) {
  const theme = useTheme();
  const t = useT();
  const sample = (s: LegendState): SeatOccupant => {
    if (s === 'free') return { kind: 'free', seatId: 'back_left', premiumIqd: 0 };
    if (s === 'walkup') return { kind: 'walkup', seatId: 'back_left', travellingAs: null };
    const booking = { bookingId: '', riderId: '', seatIds: [], state: s === 'checked_in' ? 'checked_in' : s === 'held' ? 'held' : 'booked', travellingAs: 'rijal', payment: null, prepaid: false, prepayRail: null, totalIqd: 0, pickup: { kind: 'garage', meetingPointId: null, nameAr: null, lat: 0, lng: 0, note: null, feeIqd: 0, status: 'accepted', detourMin: null }, largeBags: false, atGarage: false, checkedInAt: null, meterMinutes: null, canNoShow: false } as unknown as Extract<SeatOccupant, { kind: 'rider' }>['booking'];
    return { kind: 'rider', seatId: 'back_left', booking, firstName: '', status: s };
  };
  return (
    <View testID="garage-legend" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: theme.space[3], rowGap: theme.space[2] }}>
      {states.map((s) => {
        const l = seatLook(theme, t, sample(s), false);
        return (
          <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: l.bg, borderWidth: 1.5, borderStyle: l.dashed ? 'dashed' : 'solid', borderColor: l.border, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={s === 'free' ? 'plus' : s === 'late' ? 'clock' : l.icon} size={13} color={l.fg} strokeWidth={2.4} />
            </View>
            <Text variant="caption" color="text">
              {legendLabel(t, s)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ───────────────────────── the rider's sheet ─────────────────────────

/**
 * Tap a booked seat: this rider's sheet. The PIN pad (64 px keys) checks in only this rider (the
 * server refuses another rider's PIN on this seat); a late rider shows the meter and a big call; a
 * door pickup waits for his answer; no-show when the server allows it.
 */
export function RiderSheet({
  occ,
  open,
  onClose,
  pin,
  pinError,
  onPinKey,
  checkingIn,
  onCall,
  calling,
  onNoShow,
  onPickup,
  busy,
}: {
  occ: Extract<SeatOccupant, { kind: 'rider' }> | null;
  open: boolean;
  onClose: () => void;
  pin: string;
  pinError: boolean;
  onPinKey: (key: string) => void;
  checkingIn: boolean;
  onCall: () => void;
  calling: boolean;
  onNoShow: () => void;
  onPickup: (accept: boolean) => void;
  busy: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  if (!occ) return null;
  const b = occ.booking;
  const name = riderName(t, occ.firstName);
  const late = occ.status === 'late';
  const m = meterMoney(b.meterMinutes);
  const canPin = b.state === 'booked';
  const doorPending = occ.status === 'pickup_pending';
  return (
    <ModalSheet
      visible={open}
      onClose={onClose}
      testID="rider-sheet"
      title={canPin ? t('partner.gm_pin_title', { name }) : name}
      subtitle={[seatName(t, occ.seatId), travellingAsLabel(t, b.travellingAs), paymentLabel(t, b), pickupLabel(t, b)].join(' · ')}
      aside={<StatusPill size="sm" tone={statusTone(occ.status)} live={late} label={occ.status === 'checked_in' && b.checkedInAt ? t('partner.gm_boarded_at', { time: clockLabel(b.checkedInAt) }) : statusLabel(t, occ.status, b)} />}
    >
      <View style={{ gap: theme.space[4] }}>
        {late ? (
          <View testID="rider-late" style={{ gap: theme.space[3], backgroundColor: theme.colors.dangerTint, borderRadius: theme.radius.lg, padding: theme.space[4] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Icon name="clock" size={20} color="dangerText" />
              <Text variant="bodyStrong" color="dangerText" style={{ flex: 1 }} tabular>
                {statusLabel(t, occ.status, b)}
              </Text>
              {m.toDriverIqd > 0 ? (
                <Text variant="bodyStrong" color="dangerText" tabular>
                  {t('partner.gm_meter_yours', { amount: amountParam(m.toDriverIqd) })}
                </Text>
              ) : null}
            </View>
            <Button testID="rider-call" label={CALLS_LIVE ? t('partner.gm_call_rider', { name }) : `${t('partner.gm_call_rider', { name })} · ${t('soon.badge')}`} icon="phone" variant={CALLS_LIVE ? 'secondary' : 'ghost'} size="lg" fullWidth loading={calling} onPress={onCall} style={CALLS_LIVE ? undefined : { opacity: 0.6 }} />
          </View>
        ) : b.state === 'booked' ? (
          <Button testID="rider-call" label={CALLS_LIVE ? t('partner.gm_call_rider', { name }) : `${t('partner.gm_call_rider', { name })} · ${t('soon.badge')}`} icon="phone" variant="ghost" size="sm" loading={calling} onPress={onCall} style={{ alignSelf: 'flex-start', opacity: CALLS_LIVE ? 1 : 0.6 }} />
        ) : null}
        {doorPending ? (
          <View style={{ gap: theme.space[2], backgroundColor: theme.colors.warningTint, borderRadius: theme.radius.md, padding: theme.space[3] }}>
            <Text variant="footnote" weight={600} color="warningText" tabular>
              {t('partner.ic_door_request', { min: b.pickup.detourMin ?? 0, amount: amountParam(b.pickup.feeIqd, { sign: true }) })}
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
              <Button testID="sheet-door-accept" label={t('partner.ic_door_accept')} size="sm" icon="check" onPress={() => onPickup(true)} disabled={busy} style={{ flex: 1 }} />
              <Button testID="sheet-door-decline" label={t('partner.ic_door_decline')} size="sm" variant="secondary" onPress={() => onPickup(false)} disabled={busy} style={{ flex: 1 }} />
            </View>
          </View>
        ) : null}
        {canPin ? (
          <View style={{ gap: theme.space[2] }}>
            <Text variant="footnote" color={pinError ? 'dangerText' : 'textMuted'} align="center" testID="rider-pin-hint">
              {pinError ? t('partner.gm_pin_wrong', { name }) : t('partner.ic_pin_hint')}
            </Text>
            <PinPad pin={pin} onKey={onPinKey} busy={checkingIn} error={pinError} />
          </View>
        ) : null}
        {b.canNoShow ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
              {b.prepaid || b.prepayRail === 'trusted_cash' ? t('partner.ic_noshow_rule_prepaid') : t('partner.ic_noshow_rule_cash')}
            </Text>
            <Button testID="sheet-noshow" label={t('partner.ic_noshow_cta')} size="sm" variant="secondary" icon="x" onPress={onNoShow} disabled={busy} />
          </View>
        ) : null}
      </View>
    </ModalSheet>
  );
}

// ───────────────────────── the walk-up sheet ─────────────────────────

const TRAVELLING_AS: readonly TravellingAs[] = ['rijal', 'nisa', 'aila'];

/** Tap an empty seat: who sits (رجال / نساء / عائلة) and the cash to take, quoted by the server. A walk-up seat: remove. */
export function WalkUpSheet({
  dep,
  occ,
  open,
  onClose,
  as,
  onAs,
  onConfirm,
  onRemove,
  busy,
}: {
  dep: DriverDepartureView;
  occ: Extract<SeatOccupant, { kind: 'free' | 'walkup' }> | null;
  open: boolean;
  onClose: () => void;
  as: TravellingAs;
  onAs: (v: TravellingAs) => void;
  onConfirm: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  if (!occ) return null;
  const cash = walkUpCash(dep, occ.seatId);
  const marked = occ.kind === 'walkup';
  return (
    <ModalSheet
      visible={open}
      onClose={onClose}
      testID="walkup-sheet"
      title={t('partner.ic_walkup_title', { seat: seatName(t, occ.seatId) })}
      footer={
        marked ? (
          <Button testID="walkup-remove" label={t('partner.ic_walkup_remove')} variant="secondary" size="lg" fullWidth onPress={onRemove} loading={busy} />
        ) : (
          <Button testID="walkup-confirm" label={t('partner.ic_walkup_confirm')} icon="garage" size="lg" fullWidth onPress={onConfirm} loading={busy} />
        )
      }
    >
      <View style={{ gap: theme.space[4] }}>
        {marked ? (
          <Text variant="body" color="textMuted">
            {occ.travellingAs ? travellingAsLabel(t, occ.travellingAs) : t('partner.ic_seat_walkup')}
          </Text>
        ) : (
          <>
            <View style={{ gap: theme.space[2] }}>
              <Text variant="label" color="textMuted">
                {t('partner.ic_walkup_as')}
              </Text>
              <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
                {TRAVELLING_AS.filter((v) => !dep.familyOnly || v === 'aila').map((v) => (
                  <Chip key={v} testID={`walkup-as-${v}`} role="radio" label={travellingAsLabel(t, v)} selected={as === v} onPress={() => onAs(v)} style={{ flex: 1, minHeight: 48 }} />
                ))}
              </View>
            </View>
            <View testID="walkup-cash" style={{ alignItems: 'center', gap: 2, backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[4] }}>
              <Icon name="wallet" size={22} color="text" />
              <Text variant="heading" tabular align="center">
                {t('partner.gm_walkup_cash', { amount: amountParam(cash) })}
              </Text>
            </View>
            {!dep.selfieAt ? (
              <Text variant="caption" color="warningText">
                {t('partner.ic_walkup_not_counted')}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </ModalSheet>
  );
}
