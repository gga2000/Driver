import { Linking, Pressable, View } from 'react-native';
import { openNav, useNavApp } from '@/features/work/nav';
import Svg, { Path } from 'react-native-svg';
import type { DriverBookingRow, IntercitySeatId, IntercitySeatLayout } from '@driver/contracts';
import { Avatar, Button, Icon, SEAT_ROWS, StatusPill, Text, useTheme, withAlpha, type IconName, type StatusTone } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { paymentLabel, pickupLabel, riderName, seatName, seatsList, statusLabel, travellingAsLabel } from './labels';
import { mapsUrl, riderStatus, type PickupStop, type RiderStatus, type SeatOccupant } from './logic';

// ───────────────────────── seat map (driver) ─────────────────────────

const STATUS_TONE: Record<RiderStatus, StatusTone> = {
  held: 'warning',
  checked_in: 'success',
  at_garage: 'info',
  late: 'danger',
  waiting: 'neutral',
  pickup_pending: 'warning',
  no_show: 'neutral',
  completed: 'success',
};

export function statusTone(s: RiderStatus): StatusTone {
  return STATUS_TONE[s];
}

/**
 * The driver's car, top-down (front at the top, driver on the left; never mirrored): every seat
 * shows who sits there by first name and where they are (صعد ✓ / بالكراج / متأخر / ماسك), walk-ups
 * marked, free seats inviting a walk-up tap. The selected seat gets a ring.
 */
export function DriverSeatMap({
  layout,
  occupants,
  selected,
  onSelect,
  editable,
}: {
  layout: IntercitySeatLayout;
  occupants: Map<IntercitySeatId, SeatOccupant>;
  selected: IntercitySeatId | null;
  onSelect: (id: IntercitySeatId) => void;
  editable: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const rows = SEAT_ROWS[layout];
  const cell = { w: 92, h: 78 };
  const gap = 10;
  const padX = 18;
  const padTop = 44;
  const padBottom = 26;
  const width = cell.w * 3 + gap * 2 + padX * 2;
  const height = padTop + rows.length * cell.h + (rows.length - 1) * gap + padBottom;
  return (
    <View style={{ alignItems: 'center' }}>
      <View accessibilityLabel={t('seat.map_label')} style={{ width, height, direction: 'ltr' }}>
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 4,
            right: 4,
            bottom: 0,
            borderRadius: 46,
            borderTopLeftRadius: 64,
            borderTopRightRadius: 64,
            backgroundColor: theme.colors.surfaceSunken,
            borderWidth: 1.5,
            borderColor: theme.colors.border,
          }}
        />
        <View style={{ position: 'absolute', top: 16, left: 40, right: 40, height: 10, borderTopLeftRadius: 40, borderTopRightRadius: 40, borderTopWidth: 2, borderColor: theme.colors.borderStrong }} />
        <View style={{ position: 'absolute', top: padTop, left: padX, gap }}>
          {rows.map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', gap }}>
              {row.map((c, ci) => {
                if (c === null) return <View key={ci} style={{ width: cell.w, height: cell.h }} />;
                if (c === 'driver') return <DriverCell key={ci} w={cell.w} h={cell.h} />;
                const occ = occupants.get(c) ?? { kind: 'free' as const, seatId: c, premiumIqd: 0 };
                return <SeatCell key={ci} occ={occ} w={cell.w} h={cell.h} selected={selected === c} onPress={() => onSelect(c)} editable={editable} />;
              })}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function DriverCell({ w, h }: { w: number; h: number }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View accessible accessibilityLabel={t('seat.driver')} style={{ width: w, height: h, borderRadius: 16, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: theme.colors.surface, borderWidth: 1.5, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <Path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 11h17M12 14v6.5M9 11a3 3 0 0 0 6 0" stroke={theme.colors.textMuted} strokeWidth={1.8} fill="none" strokeLinecap="round" />
      </Svg>
      <Text variant="caption" color="textMuted">
        {t('seat.driver')}
      </Text>
    </View>
  );
}

function SeatCell({ occ, w, h, selected, onPress, editable }: { occ: SeatOccupant; w: number; h: number; selected: boolean; onPress: () => void; editable: boolean }) {
  const theme = useTheme();
  const t = useT();
  const c = theme.colors;
  let bg = c.surface;
  let border = c.borderStrong;
  let dashed = false;
  let title = '';
  let sub = '';
  let fg: 'text' | 'textMuted' | 'successText' | 'infoText' | 'warningText' | 'dangerText' | 'accentText' = 'text';
  let icon: IconName | null = null;
  if (occ.kind === 'free') {
    dashed = true;
    bg = occ.seatId === 'front' ? c.accentTint : c.surface;
    border = occ.seatId === 'front' ? c.accent : c.borderStrong;
    title = t('partner.ic_seat_free');
    sub = occ.premiumIqd > 0 ? amountParam(occ.premiumIqd, { sign: true }) : seatName(t, occ.seatId);
    fg = occ.seatId === 'front' ? 'accentText' : 'textMuted';
    icon = editable ? 'plus' : null;
  } else if (occ.kind === 'walkup') {
    bg = c.infoTint;
    border = c.info;
    title = t('partner.ic_seat_walkup');
    sub = occ.travellingAs ? travellingAsLabel(t, occ.travellingAs) : seatName(t, occ.seatId);
    fg = 'infoText';
    icon = 'garage';
  } else {
    const s = occ.status;
    title = riderName(t, occ.firstName);
    sub = statusLabel(t, s, occ.booking);
    if (s === 'checked_in' || s === 'completed') {
      bg = c.successTint;
      border = c.success;
      fg = 'successText';
      icon = 'check';
    } else if (s === 'late') {
      bg = c.dangerTint;
      border = c.danger;
      fg = 'dangerText';
      icon = 'clock';
    } else if (s === 'held' || s === 'pickup_pending') {
      bg = c.warningTint;
      border = c.warning;
      dashed = s === 'held';
      fg = 'warningText';
      icon = s === 'held' ? 'clock' : 'home';
    } else if (s === 'at_garage') {
      bg = c.infoTint;
      border = c.info;
      fg = 'infoText';
      icon = 'map-pin';
    } else {
      bg = c.surface;
      border = c.text;
      fg = 'textMuted';
      icon = 'user';
    }
  }
  return (
    <Pressable
      testID={`dseat-${occ.seatId}`}
      accessibilityRole="button"
      accessibilityLabel={`${seatName(t, occ.seatId)}، ${title}، ${sub}`}
      aria-selected={selected}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={{
        width: w,
        height: h,
        borderRadius: 16,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        backgroundColor: bg,
        borderWidth: selected ? 3 : 1.5,
        borderStyle: dashed && !selected ? 'dashed' : 'solid',
        borderColor: selected ? c.accent : border,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
        gap: 0,
        shadowColor: c.accent,
        shadowOpacity: selected ? 0.35 : 0,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      {icon ? <Icon name={icon} size={16} color={fg} strokeWidth={2.2} /> : null}
      <Text variant="label" weight={700} numberOfLines={1} color={occ.kind === 'rider' ? 'text' : fg} style={{ lineHeight: 20 }}>
        {title}
      </Text>
      <Text variant="caption" weight={600} numberOfLines={1} color={fg} tabular compact style={{ lineHeight: 16 }}>
        {sub}
      </Text>
    </Pressable>
  );
}

// ───────────────────────── PIN pad ─────────────────────────

/** Four boxes and a big keypad (left-to-right like every phone keypad); the 4th digit submits. */
export function PinPad({ pin, onKey, busy, error }: { pin: string; onKey: (key: string) => void; busy: boolean; error: boolean }) {
  const theme = useTheme();
  const t = useT();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', ''];
  return (
    <View style={{ gap: theme.space[4] }}>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.space[3], direction: 'ltr' }} testID="pin-boxes">
        {[0, 1, 2, 3].map((i) => {
          const ch = pin[i] ?? '';
          const active = i === pin.length && !busy;
          return (
            <View
              key={i}
              style={{
                width: 56,
                height: 64,
                borderRadius: theme.radius.lg,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.surfaceSunken,
                borderWidth: 2,
                borderColor: error ? theme.colors.danger : active ? theme.colors.accent : 'transparent',
              }}
            >
              <Text variant="heading" tabular>
                {ch}
              </Text>
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: theme.space[2], direction: 'ltr', maxWidth: 3 * 96 + 2 * 8, alignSelf: 'center' }}>
        {keys.map((k, i) =>
          k === '' ? (
            <View key={i} style={{ width: 96, height: 56 }} />
          ) : (
            <Pressable
              key={i}
              testID={`pin-key-${k}`}
              accessibilityRole="button"
              accessibilityLabel={k === 'back' ? t('partner.ic_pin_clear') : k}
              disabled={busy}
              onPress={() => {
                theme.haptic('light');
                onKey(k);
              }}
              style={({ pressed }) => ({
                width: 96,
                height: 56,
                borderRadius: theme.radius.lg,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? theme.colors.accentTint : k === 'back' ? 'transparent' : theme.colors.surface,
                borderWidth: k === 'back' ? 0 : 1,
                borderColor: theme.colors.border,
              })}
            >
              {k === 'back' ? <Icon name="arrow-forward" size={22} color="textMuted" /> : <Text variant="heading" tabular>{k}</Text>}
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}

// ───────────────────────── manifest row ─────────────────────────

/** One booking: who, which seats, how they pay and board, where they are, and what he can do. */
export function RiderRow({
  booking,
  firstName,
  onNoShow,
  onPickup,
  busy,
}: {
  booking: DriverBookingRow;
  firstName: string | null;
  onNoShow: () => void;
  onPickup: (accept: boolean) => void;
  busy: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const s = riderStatus(booking);
  const name = riderName(t, firstName);
  const doorPending = s === 'pickup_pending';
  return (
    <View testID={`rider-${booking.bookingId}`} style={{ gap: theme.space[2], paddingVertical: theme.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Avatar name={name} size={40} />
        <View style={{ flex: 1, gap: 0 }}>
          <Text variant="label" weight={700} numberOfLines={1}>
            {`${name} · ${seatsList(t, booking.seatIds)}`}
          </Text>
          <Text variant="caption" color="textMuted" numberOfLines={2} tabular>
            {[travellingAsLabel(t, booking.travellingAs), paymentLabel(t, booking), pickupLabel(t, booking), booking.largeBags ? t('partner.ic_bags') : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <StatusPill label={statusLabel(t, s, booking)} tone={STATUS_TONE[s]} size="sm" live={s === 'late'} />
      </View>
      {doorPending ? (
        <View style={{ gap: theme.space[2], backgroundColor: theme.colors.warningTint, borderRadius: theme.radius.md, padding: theme.space[3] }}>
          <Text variant="footnote" weight={600} color="warningText" tabular>
            {t('partner.ic_door_request', { min: booking.pickup.detourMin ?? 0, amount: amountParam(booking.pickup.feeIqd, { sign: true }) })}
          </Text>
          {booking.pickup.note ? (
            <Text variant="caption" color="text">
              {booking.pickup.note}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
            <Button testID={`door-accept-${booking.bookingId}`} label={t('partner.ic_door_accept')} size="sm" icon="check" onPress={() => onPickup(true)} disabled={busy} style={{ flex: 1 }} />
            <Button testID={`door-decline-${booking.bookingId}`} label={t('partner.ic_door_decline')} size="sm" variant="secondary" onPress={() => onPickup(false)} disabled={busy} style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}
      {booking.canNoShow ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingStart: 52 }}>
          <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
            {booking.prepaid || booking.prepayRail === 'trusted_cash' ? t('partner.ic_noshow_rule_prepaid') : t('partner.ic_noshow_rule_cash')}
          </Text>
          <Button testID={`noshow-${booking.bookingId}`} label={t('partner.ic_noshow_cta')} size="sm" variant="secondary" icon="x" onPress={onNoShow} disabled={busy} />
        </View>
      ) : null}
    </View>
  );
}

// ───────────────────────── pickup route ─────────────────────────

/** The ordered pickup run: garage → doors (nearest first) → on-the-way points, each with its riders. */
export function PickupRoute({ stops, garageName, names }: { stops: readonly PickupStop[]; garageName: string; names: Map<string, string | null> }) {
  const theme = useTheme();
  const t = useT();
  // Maps program d3: his navigation app when he has chosen one, Google Maps on the web otherwise.
  const navApp = useNavApp().app;
  return (
    <View testID="pickup-route" style={{ gap: 0 }}>
      {stops.map((s, i) => {
        const last = i === stops.length - 1;
        const who = s.bookings.map((b) => riderName(t, names.get(b.bookingId))).join('، ');
        const title = s.kind === 'garage' ? `${t('partner.ic_route_garage')} · ${garageName}` : s.kind === 'door' ? t('partner.ic_route_door', { name: riderName(t, names.get(s.bookings[0]!.bookingId)) }) : (s.nameAr ?? '');
        return (
          <View key={s.key} style={{ flexDirection: 'row', gap: theme.space[3] }}>
            <View style={{ alignItems: 'center', width: 28 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: s.kind === 'garage' ? theme.colors.text : s.kind === 'door' ? theme.colors.accent : theme.colors.info }}>
                <Text variant="caption" weight={700} color={s.kind === 'door' ? 'onAccent' : 'surface'} tabular>
                  {String(i + 1)}
                </Text>
              </View>
              {!last ? <View style={{ flex: 1, width: 2, backgroundColor: theme.colors.border, marginVertical: 2 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : theme.space[4], gap: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <Text variant="label" weight={600} style={{ flex: 1 }} numberOfLines={1}>
                  {title}
                </Text>
                {i > 0 ? (
                  <Text variant="caption" color="textMuted" tabular>
                    {t('partner.ic_route_leg', { km: s.legKm.toFixed(1) })}
                  </Text>
                ) : null}
                {s.kind !== 'garage' ? (
                  <Pressable hitSlop={8} accessibilityRole="link" onPress={() => void (navApp ? openNav(navApp, s.at) : Linking.openURL(mapsUrl(s.at))).catch(() => undefined)} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, height: 28, borderRadius: 14, backgroundColor: withAlpha(theme.colors.info, 0.1) }}>
                    <Icon name="location-arrow" size={13} color="infoText" />
                    <Text variant="caption" weight={600} color="infoText">
                      {t('partner.ic_route_open')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {who ? (
                <Text variant="caption" color="textMuted" numberOfLines={1}>
                  {who}
                </Text>
              ) : null}
              {s.note ? (
                <Text variant="caption" color="text" numberOfLines={2}>
                  {s.note}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ───────────────────────── checklist row ─────────────────────────

/** A pre-departure step (selfie, garage check-in): done ✓ or one button. */
export function StepRow({ icon, title, body, done, doneLabel, cta, onPress, busy, testID }: { icon: IconName; title: string; body: string; done: boolean; doneLabel: string; cta: string; onPress: () => void; busy: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[3] }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? theme.colors.successTint : theme.colors.accentTint }}>
        <Icon name={done ? 'check' : icon} size={20} color={done ? 'successText' : 'accentText'} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="label" weight={600} color={done ? 'successText' : 'text'}>
          {done ? doneLabel : title}
        </Text>
        {!done ? (
          <Text variant="caption" color="textMuted">
            {body}
          </Text>
        ) : null}
      </View>
      {!done ? <Button testID={`${testID}-cta`} label={cta} size="sm" onPress={onPress} loading={busy} /> : null}
    </View>
  );
}
