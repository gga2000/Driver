import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { KHAT_RULES, type AbsenceReason, type KhatRunTrip, type KhatStopView, type SubstituteOffer } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Avatar, Button, Chip, DepartureTime, Icon, IconButton, SlideToConfirm, StatusPill, Text, useTheme, type IconName } from '@driver/ui';
import { childrenCount } from '@/features/intercity/labels';
import { clockLabel } from '@/features/intercity/logic';
import { zoneName } from '@/features/work/logic';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { canReportAbsent, childAction, deliveredShare, lookPauseLeft, runChips, type KhatPlace } from './logic';

export const ABSENCE_REASONS: readonly AbsenceReason[] = ['guardian_notice', 'not_at_stop', 'sick', 'other'];

/** One big header tile: the number on top (tabular, bold), the word under it ("2" / "بالسيارة"). */
function RunChip({ testID, icon, value, word, spoken, bg, fg }: { testID: string; icon: IconName; value: string; word: string; spoken: string; bg: string; fg: 'accentText' | 'successText' | 'textMuted' | 'text' }) {
  const theme = useTheme();
  return (
    <View testID={testID} accessible accessibilityLabel={spoken} style={{ flex: 1, alignItems: 'center', gap: 0, paddingVertical: theme.space[2], paddingHorizontal: theme.space[1], borderRadius: theme.radius.lg, backgroundColor: bg }}>
      <Text variant="heading" weight={700} color={fg} tabular compact numberOfLines={1}>
        {value}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Icon name={icon} size={14} color={fg} strokeWidth={2.2} />
        <Text variant="footnote" weight={600} color={fg} compact numberOfLines={1}>
          {word}
        </Text>
      </View>
    </View>
  );
}

/**
 * Header of the run (partner S-6): the next stop's time on the garage-board tiles, then big tabular
 * chips "بالسيارة 2 · وصلوا 0 من 5 · غايب 1" and the progress bar.
 */
export function RunProgress({ trip, nextAt, now }: { trip: KhatRunTrip; nextAt: Date | null; now: number }) {
  const theme = useTheme();
  const t = useT();
  const share = deliveredShare(trip);
  const c = runChips(trip);
  return (
    <View testID="khat-progress" style={{ gap: theme.space[3] }}>
      {nextAt ? (
        <DepartureTime
          testID="khat-next-time"
          at={nextAt}
          now={now}
          size="card"
          label={t('partner.kh2_next_stop')}
          // At (or past) the stop's window: it is the stop he is at, not a late warning.
          note={nextAt.getTime() <= now ? t('partner.kh_stop_now') : undefined}
          pastWarning={false}
        />
      ) : null}
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        <RunChip testID="khat-chip-onboard" icon="car" value={String(c.onBoard)} word={t('partner.kh2_tile_onboard')} spoken={t('partner.kh2_chip_onboard', { n: c.onBoard })} bg={c.onBoard > 0 ? theme.colors.accentTint : theme.colors.surfaceSunken} fg={c.onBoard > 0 ? 'accentText' : 'textMuted'} />
        <RunChip testID="khat-chip-delivered" icon="check" value={t('partner.kh2_of', { n: c.delivered, total: c.total })} word={t('partner.kh2_tile_delivered')} spoken={t('partner.kh2_chip_delivered', { delivered: c.delivered, total: c.total })} bg={theme.colors.successTint} fg="successText" />
        <RunChip testID="khat-chip-absent" icon="x" value={String(c.absent)} word={t('partner.kh2_tile_absent')} spoken={t('partner.kh2_chip_absent', { n: c.absent })} bg={theme.colors.surfaceSunken} fg="textMuted" />
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }}>
        {share > 0 ? <View style={{ height: 8, borderRadius: 4, width: `${Math.max(share * 100, 3)}%`, backgroundColor: theme.colors.success }} /> : null}
      </View>
    </View>
  );
}

/** The back seats, seen from the front (tokens only): three seat backs, the cushion, the floor under it, and a torch beam. */
function BackSeatsArt() {
  const theme = useTheme();
  const t = useT();
  const c = theme.colors;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={t('partner.kh2_seats_art')} style={{ alignItems: 'center' }}>
      <Svg width={280} height={150} viewBox="0 0 280 150">
        {/* The car's rear: roof line and window. */}
        <Path d="M20 60 Q140 0 260 60" stroke={c.borderStrong} strokeWidth={2} fill="none" strokeLinecap="round" />
        <Path d="M60 50 Q140 18 220 50" stroke={c.border} strokeWidth={2} fill="none" strokeLinecap="round" />
        {/* Three seat backs. */}
        {[0, 1, 2].map((i) => (
          <Rect key={i} x={46 + i * 64} y={56} width={56} height={52} rx={14} fill={c.surfaceSunken} stroke={c.borderStrong} strokeWidth={1.5} />
        ))}
        {/* The cushion and the floor under it, where a sleeping child is missed. */}
        <Rect x={40} y={104} width={200} height={16} rx={8} fill={c.surfaceSunken} stroke={c.borderStrong} strokeWidth={1.5} />
        <Rect x={50} y={124} width={180} height={18} rx={6} fill="none" stroke={c.accentBorder} strokeWidth={1.5} strokeDasharray="5 4" />
        {/* The torch beam sweeping the seats. */}
        <Path d="M140 150 L60 70 L220 70 Z" fill={c.accent} opacity={0.12} />
        <Circle cx={140} cy={146} r={4} fill={c.accent} />
      </Svg>
    </View>
  );
}

/**
 * The end-of-run sweep (partner S-6): two steps before "خلص خط اليوم". First he gets out and looks at
 * the back seats and under them (the illustration); "باوعت، كمّل" waits `KHAT_RULES.sweepLookPauseSec`
 * ("باوع زين… 3", Ali 2026-10-06) so it cannot be tapped without looking. Then he slides "تأكدت،
 * السيارة فاضية". The confirmation is logged on the server for ops with its time; no confirm within
 * `sweepAlertAfterMin` of the last drop alerts ops and reminds him by push.
 */
export function SweepCard({ onConfirm, busy }: { onConfirm: () => void; busy: boolean }) {
  const theme = useTheme();
  const t = useT();
  const [step, setStep] = useState<1 | 2>(1);
  return (
    <View testID="khat-sweep" style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 2, borderColor: theme.colors.accent, padding: theme.space[5], gap: theme.space[4] }}>
      <View style={{ gap: theme.space[1] }}>
        <Text variant="caption" weight={700} color="accentText" tabular>
          {t('partner.kh2_sweep_step', { n: step })}
        </Text>
        <Text variant="heading">{t('partner.kh2_sweep_title')}</Text>
        <Text variant="body" color="textMuted">
          {t('partner.kh2_sweep_body')}
        </Text>
      </View>
      <BackSeatsArt />
      {step === 1 ? (
        <LookedButton onLooked={() => setStep(2)} />
      ) : (
        <View style={{ gap: theme.space[2] }}>
          <SlideToConfirm testID="khat-sweep-slide" label={t('partner.kh2_sweep_slide')} confirmHaptic="success" loading={busy} onConfirm={onConfirm} />
          <Text variant="caption" color="textMuted" align="center">
            {t('partner.kh2_sweep_note')}
          </Text>
        </View>
      )}
    </View>
  );
}

const PAUSE_TICK_MS = 250;

/**
 * "باوعت، كمّل" with the forced pause: disabled and counting down ("باوع زين… 3") for
 * `sweepLookPauseSec` from when step 1 appeared, a thin bar filling under it, then enabled with a
 * light tap. Under reduce-motion it waits just the same; only the bar does not animate (it is not
 * drawn). Screen readers hear that it is waiting and for how long.
 */
function LookedButton({ onLooked }: { onLooked: () => void }) {
  const theme = useTheme();
  const t = useT();
  const pauseSec = KHAT_RULES.sweepLookPauseSec;
  const [shownAt] = useState(() => Date.now());
  const [now, setNow] = useState(shownAt);
  const left = lookPauseLeft(shownAt, now, pauseSec);
  const waiting = left > 0;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), PAUSE_TICK_MS);
    return () => clearInterval(id);
  }, [waiting]);
  useEffect(() => {
    if (!waiting) theme.haptic('light');
    // Only on the flip to ready, not on every theme change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  const fill = useSharedValue(0);
  useEffect(() => {
    if (theme.reduceMotion) return;
    fill.value = withTiming(1, { duration: pauseSec * 1000, easing: Easing.linear });
    return () => cancelAnimation(fill);
  }, [fill, pauseSec, theme.reduceMotion]);
  const bar = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return (
    <View style={{ gap: theme.space[2] }}>
      <Button
        testID="khat-sweep-looked"
        label={waiting ? t('partner.kh2_sweep_wait', { seconds: left }) : t('partner.kh2_sweep_looked')}
        accessibilityLabel={waiting ? t('partner.kh2_sweep_wait_a11y', { seconds: left }) : t('partner.kh2_sweep_looked')}
        size="lg"
        variant="secondary"
        fullWidth
        icon={waiting ? 'clock' : 'check'}
        disabled={waiting}
        onPress={onLooked}
      />
      {theme.reduceMotion ? null : (
        <View testID="khat-sweep-pause-bar" aria-hidden importantForAccessibility="no-hide-descendants" style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden', opacity: waiting ? 1 : 0 }}>
          {/* Fills from the start edge (right in Arabic), like the offer's countdown. */}
          <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, start: 0, borderRadius: 2, backgroundColor: theme.colors.accent }, bar]} />
        </View>
      )}
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
  onCallGuardian,
  callingRef,
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
  /** The guardian call on the child's row (null when the run is over). */
  onCallGuardian: ((stop: KhatStopView) => void) | null;
  callingRef: string | null;
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
            onCall={onCallGuardian && !s.absent ? () => onCallGuardian(s) : null}
            calling={callingRef === s.child!.childRef}
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
  onCall,
  calling,
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
  onCall: (() => void) | null;
  calling: boolean;
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
        {/* The child's photo when the guardian added one (none in the vault yet: the initial). */}
        <Avatar name={name} size={48} />
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
        {onCall ? (
          <IconButton testID={`khat-call-${stop.stopId}`} icon="phone" variant="tonal" size={44} accessibilityLabel={t('partner.kh2_call_guardian', { name })} onPress={onCall} disabled={calling} />
        ) : null}
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
        height: 56,
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
