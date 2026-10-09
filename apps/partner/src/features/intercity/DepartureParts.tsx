import { Linking, Pressable, View } from 'react-native';
import { openNav, useNavApp } from '@/features/work/nav';
import type { DriverBookingRow } from '@driver/contracts';
import { Avatar, Button, Icon, IconButton, StatusPill, Text, useTheme, withAlpha, type IconName, type StatusTone } from '@driver/ui';
import { DigitPad } from '@/components/DigitPad';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { dropLabel, paymentLabel, pickupLabel, riderName, seatsList, statusLabel } from './labels';
import { mapsUrl, riderStatus, type PickupStop, type RiderStatus } from './logic';

// ───────────────────────── rider status tones ─────────────────────────

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

// ───────────────────────── PIN pad ─────────────────────────

/** Four boxes and a big keypad (64 px keys, left-to-right like every phone keypad); the 4th digit submits. */
export function PinPad({ pin, onKey, busy, error }: { pin: string; onKey: (key: string) => void; busy: boolean; error: boolean }) {
  const theme = useTheme();
  const t = useT();
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
      {/* Check-up item 8: the app's one keypad. */}
      <DigitPad keyTestID={(k) => `pin-key-${k}`} deleteLabel={t('partner.ic_pin_clear')} disabled={busy} onKey={onKey} />
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
  onMessage,
  busy,
}: {
  booking: DriverBookingRow;
  firstName: string | null;
  onNoShow: () => void;
  onPickup: (accept: boolean) => void;
  /** Step 4c: his chat with this rider. */
  onMessage?: () => void;
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
            {[paymentLabel(t, booking), pickupLabel(t, booking), dropLabel(t, booking), booking.largeBags ? t('partner.ic_bags') : null, booking.lapChildren > 0 ? t('partner.ic_lap', { n: booking.lapChildren }) : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <StatusPill label={statusLabel(t, s, booking)} tone={STATUS_TONE[s]} size="sm" live={s === 'late'} />
        {onMessage ? <IconButton icon="chat" variant="tonal" accessibilityLabel={t('chat.trip.message_rider')} onPress={onMessage} testID={`rider-chat-${booking.bookingId}`} /> : null}
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
        const rider = s.bookings[0] ? riderName(t, names.get(s.bookings[0].bookingId)) : '';
        const title =
          s.kind === 'garage'
            ? `${t('partner.ic_route_garage')} · ${garageName}`
            : s.kind === 'door'
              ? t('partner.ic_route_door', { name: rider })
              : s.kind === 'pin'
                ? t('partner.ic_route_pin', { name: rider })
                : (s.nameAr ?? '');
        return (
          <View key={s.key} style={{ flexDirection: 'row', gap: theme.space[3] }}>
            <View style={{ alignItems: 'center', width: 28 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: s.kind === 'garage' ? theme.colors.text : s.kind === 'door' || s.kind === 'pin' ? theme.colors.accent : theme.colors.info }}>
                <Text variant="caption" weight={700} color={s.kind === 'door' || s.kind === 'pin' ? 'onAccent' : 'surface'} tabular>
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
