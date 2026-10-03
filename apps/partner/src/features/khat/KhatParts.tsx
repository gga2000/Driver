import { Pressable, View } from 'react-native';
import type { AbsenceReason, KhatRunTrip, KhatStopView, SubstituteOffer } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Avatar, Button, Chip, Icon, StatusPill, Text, useTheme, type IconName } from '@driver/ui';
import { childrenCount } from '@/features/intercity/labels';
import { clockLabel } from '@/features/intercity/logic';
import { zoneName } from '@/features/work/logic';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { canReportAbsent, childAction, deliveredShare, type KhatPlace } from './logic';

export const ABSENCE_REASONS: readonly AbsenceReason[] = ['guardian_notice', 'not_at_stop', 'sick', 'other'];

/** Header of the run: delivered of travelling, on board, absent, with a progress bar. */
export function RunProgress({ trip }: { trip: KhatRunTrip }) {
  const theme = useTheme();
  const t = useT();
  const share = deliveredShare(trip);
  return (
    <View testID="khat-progress" style={{ gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2], flexWrap: 'wrap' }}>
        <Text variant="title" tabular>
          {t('partner.kh_progress', { delivered: trip.delivered, total: trip.childrenTotal - trip.absent })}
        </Text>
        {trip.onBoard > 0 ? <StatusPill label={t('partner.kh_on_board', { n: trip.onBoard })} tone="accent" size="sm" icon="car" /> : null}
        {trip.absent > 0 ? <StatusPill label={t('partner.kh_absent_count', { n: trip.absent })} tone="neutral" size="sm" /> : null}
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }}>
        {share > 0 ? <View style={{ height: 8, borderRadius: 4, width: `${Math.max(share * 100, 3)}%`, backgroundColor: theme.colors.success }} /> : null}
      </View>
    </View>
  );
}

/**
 * One place on the run (a pickup zone or the school): its time, its children by first name and,
 * for the current place, big tap buttons. Done places fold to one line; upcoming ones stay quiet.
 */
export function PlaceCard({
  place,
  index,
  trip,
  busyStopId,
  absenceFor,
  onTap,
  onAskAbsence,
  onAbsence,
  onCancelAbsence,
}: {
  place: KhatPlace;
  index: number;
  trip: KhatRunTrip;
  busyStopId: string | null;
  absenceFor: string | null;
  onTap: (stop: KhatStopView) => void;
  onAskAbsence: (childRef: string) => void;
  onAbsence: (childRef: string, reason: AbsenceReason) => void;
  onCancelAbsence: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const current = place.status === 'current';
  const done = place.status === 'done';
  const title = place.type === 'dropoff' ? t('partner.kh_stop_dropoff', { zone: zoneName(place.zoneKey, 'ar-IQ', t) }) : t('partner.kh_stop_pickup', { zone: zoneName(place.zoneKey, 'ar-IQ', t) });
  const badge = done ? { label: t('partner.kh_stop_done'), tone: 'success' as const } : current ? { label: t('partner.kh_stop_now'), tone: 'accent' as const } : null;
  const icon: IconName = place.type === 'dropoff' ? 'map-pin' : 'home';
  return (
    <View
      testID={`khat-place-${index}`}
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.xl,
        borderWidth: current ? 2 : 1,
        borderColor: current ? theme.colors.accent : theme.colors.border,
        padding: theme.space[4],
        gap: theme.space[3],
        opacity: done ? 0.9 : 1,
        shadowColor: theme.colors.shadow,
        shadowOpacity: current ? 0.12 : 0,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 4 },
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? theme.colors.successTint : current ? theme.colors.accent : theme.colors.surfaceSunken }}>
          {done ? <Icon name="check" size={18} color="successText" strokeWidth={2.6} /> : <Icon name={icon} size={18} color={current ? 'onAccent' : 'textMuted'} strokeWidth={2.2} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="label" weight={700}>
            {title}
          </Text>
          <Text variant="caption" color="textMuted" tabular>
            {[place.windowStart ? t('partner.kh_stop_time', { time: clockLabel(place.windowStart) }) : null, childrenCount(t, place.stops.filter((s) => s.child).length)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {badge ? <StatusPill label={badge.label} tone={badge.tone} size="sm" live={current} /> : null}
      </View>

      {place.stops
        .filter((s) => s.child)
        .map((s) => (
          <ChildRow
            key={s.stopId}
            trip={trip}
            stop={s}
            emphasise={current}
            busy={busyStopId === s.stopId}
            asking={absenceFor === s.child!.childRef}
            onTap={() => onTap(s)}
            onAskAbsence={() => onAskAbsence(s.child!.childRef)}
            onAbsence={(r) => onAbsence(s.child!.childRef, r)}
            onCancelAbsence={onCancelAbsence}
          />
        ))}
    </View>
  );
}

function ChildRow({
  trip,
  stop,
  emphasise,
  busy,
  asking,
  onTap,
  onAskAbsence,
  onAbsence,
  onCancelAbsence,
}: {
  trip: KhatRunTrip;
  stop: KhatStopView;
  emphasise: boolean;
  busy: boolean;
  asking: boolean;
  onTap: () => void;
  onAskAbsence: () => void;
  onAbsence: (r: AbsenceReason) => void;
  onCancelAbsence: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const name = stop.child!.firstName;
  const action = childAction(trip, stop);
  const absentOk = stop.type === 'pickup' && canReportAbsent(trip, stop.child!.childRef);
  const settledLine =
    action === 'tapped_in' && stop.tappedInAt
      ? t('partner.kh_tapped_in', { time: clockLabel(stop.tappedInAt) })
      : action === 'tapped_out' && stop.tappedOutAt
        ? t('partner.kh_tapped_out', { time: clockLabel(stop.tappedOutAt) })
        : null;
  return (
    <View testID={`khat-child-${stop.stopId}`} style={{ gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Avatar name={name} size={44} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" color={action === 'absent' ? 'textMuted' : 'text'}>
            {name}
          </Text>
          {action === 'absent' ? (
            <StatusPill label={t('partner.kh_absent_badge')} tone="neutral" size="sm" icon="x" style={{ alignSelf: 'flex-start' }} />
          ) : settledLine ? (
            <Text variant="caption" weight={600} color="successText" tabular>
              {settledLine}
            </Text>
          ) : absentOk && !asking ? (
            <Pressable testID={`khat-absent-${stop.stopId}`} accessibilityRole="button" onPress={onAskAbsence} hitSlop={8}>
              <Text variant="caption" weight={600} color="textMuted" style={{ textDecorationLine: 'underline' }}>
                {t('partner.kh_report_absent')}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {action === 'tap_in' || action === 'tap_out' ? (
          <TapButton kind={action} emphasise={emphasise} busy={busy} onPress={onTap} testID={`khat-tap-${stop.stopId}`} />
        ) : action === 'not_on_board' ? (
          <Text variant="caption" color="textMuted">
            {t('partner.kh_stop_next')}
          </Text>
        ) : null}
      </View>
      {asking ? (
        <View testID="khat-absence-panel" style={{ gap: theme.space[2], backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
          <Text variant="label" weight={700}>
            {t('partner.kh_absent_title', { name })}
          </Text>
          <Text variant="caption" color="textMuted">
            {t('partner.kh_absent_hint')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {ABSENCE_REASONS.map((r) => (
              <Chip key={r} testID={`khat-reason-${r}`} role="button" label={t(`partner.kh_reason_${r}` as MessageKey)} onPress={() => onAbsence(r)} disabled={busy} />
            ))}
          </View>
          <Button label={t('action.cancel')} variant="ghost" size="sm" onPress={onCancelAbsence} />
        </View>
      ) : null}
    </View>
  );
}

/** The big per-child button: "صعد" at pickups (accent), "نزل" at the school (green: tells the guardian). */
function TapButton({ kind, emphasise, busy, onPress, testID }: { kind: 'tap_in' | 'tap_out'; emphasise: boolean; busy: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  const t = useT();
  const bg = !emphasise ? theme.colors.surface : kind === 'tap_in' ? theme.colors.accent : theme.colors.success;
  const fg = !emphasise ? 'text' : kind === 'tap_in' ? 'onAccent' : 'surface';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={busy}
      onPress={() => {
        theme.haptic('medium');
        onPress();
      }}
      style={({ pressed }) => ({
        minWidth: 104,
        height: 52,
        paddingHorizontal: theme.space[4],
        borderRadius: theme.radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 6,
        backgroundColor: bg,
        borderWidth: emphasise ? 0 : 1.5,
        borderColor: theme.colors.borderStrong,
        opacity: busy ? 0.6 : pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <Icon name={kind === 'tap_in' ? 'arrow-forward' : 'check'} size={18} color={fg} strokeWidth={2.6} />
      <Text variant="button" color={fg}>
        {kind === 'tap_in' ? t('partner.kh_tap_in') : t('partner.kh_tap_out')}
      </Text>
    </Pressable>
  );
}

/** A run that needs a substitute today: where, how many, from when, compensation, the clock, accept. */
export function SubstituteCard({ offer, secondsLeft, busy, onAccept }: { offer: SubstituteOffer; secondsLeft: number; busy: boolean; onAccept: () => void }) {
  const theme = useTheme();
  const t = useT();
  const zones = offer.zones.map((z) => zoneName(z, 'ar-IQ', t)).join('، ');
  return (
    <View testID={`khat-sub-${offer.offerId}`} style={{ backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.accent, padding: theme.space[4], gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name="bell" size={18} color="accentText" />
        <Text variant="label" weight={700} style={{ flex: 1 }} numberOfLines={2}>
          {zones}
        </Text>
        <StatusPill label={t('partner.substitute_window', { minutes: Math.max(1, Math.ceil(secondsLeft / 60)) })} tone="warning" size="sm" icon="clock" />
      </View>
      <Text variant="footnote" color="text" tabular>
        {t('partner.kh_sub_line', { children: childrenCount(t, offer.childrenCount), stops: offer.stopsCount, time: offer.firstWindowStart ? clockLabel(offer.firstWindowStart) : '—' })}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        {offer.compensationIqd > 0 ? (
          <Text variant="label" weight={700} color="accentText" style={{ flex: 1 }} tabular>
            {t('partner.kh_sub_comp', { amount: amountParam(offer.compensationIqd, { sign: true }) })}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Button testID={`khat-sub-accept-${offer.offerId}`} label={t('partner.substitute_accept')} icon="check" onPress={onAccept} loading={busy} />
      </View>
    </View>
  );
}
