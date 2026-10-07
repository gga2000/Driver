import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { t } from '@driver/i18n';
import { Icon } from '../icons/Icon';
import { SOS_HOLD_MS, SosHoldTimer, sosCancelLeft, sosHold } from '../logic/sos';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Text } from './Text';

export interface SosButtonProps {
  /** The hold completed: send the alert now. */
  onTrigger: () => void;
  /** Let go before 3 s: nothing was sent (the screen may say so). */
  onRelease?: (elapsedMs: number) => void;
  /** An alert is already open: the button turns solid and a tap reopens the sheet (no new hold). */
  active?: boolean;
  onPressActive?: () => void;
  /** `pill` (icon ring + "طوارئ") for headers; `round` (icon ring only, label under it) for tight rows. */
  variant?: 'pill' | 'round';
  holdMs?: number;
  /** Injected clock (tests). */
  clock?: () => number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const RING = 30;
const STROKE = 3;
const FRAME_MS = 40;

/** The ring around the SOS icon: fills clockwise in the danger colour while held. */
function HoldRing({ fraction, size = RING, color, track }: { fraction: number; size?: number; color: string; track: string }) {
  const r = (size - STROKE) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={STROKE} fill="none" />
      {fraction > 0 ? (
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={STROKE} strokeLinecap="round" fill="none" strokeDasharray={`${circ} ${circ}`} strokeDashoffset={circ * (1 - fraction)} />
      ) : null}
    </Svg>
  );
}

/**
 * "طوارئ" (scoring & safety §3; partner audit P-02). Hold for 3 seconds: a ring fills in the danger
 * colour, the label counts down ("ظل ضاغط… 2") and the phone gives a haptic every second. Letting go
 * earlier sends nothing. With reduced motion the ring moves in three steps instead of a sweep. A
 * screen reader's long-press action sends at once (the gesture is already deliberate there).
 */
export function SosButton({ onTrigger, onRelease, active = false, onPressActive, variant = 'pill', holdMs = SOS_HOLD_MS, clock = Date.now, disabled, style, testID = 'sos-button' }: SosButtonProps) {
  const theme = useTheme();
  const [elapsed, setElapsed] = useState(0);
  const [holding, setHolding] = useState(false);
  const frame = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = useCallback(() => {
    if (frame.current) clearInterval(frame.current);
    frame.current = null;
  }, []);
  const timer = useRef<SosHoldTimer | null>(null);
  const handlers = useRef({ onTrigger, onRelease });
  handlers.current = { onTrigger, onRelease };
  if (!timer.current) {
    timer.current = new SosHoldTimer(
      {
        onSecond: () => theme.haptic('heavy'),
        onDone: () => {
          theme.haptic('warning');
          handlers.current.onTrigger();
        },
        onCancel: (ms) => handlers.current.onRelease?.(ms),
      },
      holdMs,
    );
  }
  useEffect(() => stop, [stop]);

  const pressIn = () => {
    if (disabled || active) return;
    theme.haptic('heavy');
    timer.current!.start(clock());
    setHolding(true);
    setElapsed(0);
    stop();
    frame.current = setInterval(
      () => {
        const ms = timer.current!.tick(clock());
        if (!timer.current!.holding) {
          stop();
          setHolding(false);
          setElapsed(0);
          return;
        }
        setElapsed(ms);
      },
      theme.reduceMotion ? 250 : FRAME_MS,
    );
  };
  const pressOut = () => {
    if (!timer.current!.holding) return;
    timer.current!.release(clock());
    stop();
    setHolding(false);
    setElapsed(0);
  };

  const s = sosHold(elapsed, holdMs, theme.reduceMotion);
  const solid = active;
  const fg = solid ? theme.colors.onDanger : theme.colors.dangerText;
  // The label stays "طوارئ" (no width jump in a header); the count runs inside the ring.
  const label = t('sos.label');
  const round = variant === 'round';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={active ? t('sos.sheet_title') : holding ? `${t('sos.holding')} ${s.secondsLeft}` : t('sos.a11y')}
      accessibilityHint={active ? undefined : t('sos.a11y_hint')}
      accessibilityState={{ disabled: !!disabled, busy: holding }}
      accessibilityValue={holding ? { min: 0, max: 100, now: Math.round(s.fraction * 100) } : undefined}
      accessibilityActions={active ? undefined : [{ name: 'longpress', label: t('sos.label') }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'longpress' && !active && !disabled) onTrigger();
      }}
      disabled={disabled}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onPress={active ? onPressActive : undefined}
      // The hold must not scroll the page or open a context menu on the web.
      {...({ onContextMenu: (e: { preventDefault?: () => void }) => e.preventDefault?.() } as object)}
      style={[
        {
          minHeight: 44,
          minWidth: 44,
          flexDirection: round ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: round ? 2 : theme.space[2],
          paddingStart: round ? 0 : theme.space[2],
          paddingEnd: round ? 0 : theme.space[4],
          paddingVertical: round ? 0 : 6,
          borderRadius: theme.radius.pill,
          backgroundColor: round ? 'transparent' : solid ? theme.colors.danger : holding ? theme.colors.dangerTint : theme.colors.surface,
          borderWidth: round ? 0 : 1.5,
          borderColor: theme.colors.danger,
          opacity: disabled ? theme.state.disabledOpacity : 1,
          userSelect: 'none',
        } as ViewStyle,
        style,
      ]}
    >
      <View
        testID={`${testID}-ring`}
        style={{
          width: round ? 52 : RING,
          height: round ? 52 : RING,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 26,
          backgroundColor: round ? (solid ? theme.colors.danger : theme.colors.dangerTint) : 'transparent',
          transform: [{ scale: holding && !theme.reduceMotion ? 1 + 0.06 * s.fraction : 1 }],
        }}
      >
        <HoldRing size={round ? 52 : RING} fraction={active ? 1 : s.fraction} color={solid ? theme.colors.onDanger : theme.colors.danger} track={solid ? theme.colors.danger : theme.colors.dangerTint} />
        {holding ? (
          <Text variant={round ? 'title' : 'label'} weight={700} tabular style={{ color: theme.colors.dangerText, lineHeight: round ? 28 : 20 }} testID={`${testID}-count`}>
            {s.secondsLeft}
          </Text>
        ) : (
          <Icon name="sos" size={round ? 24 : 16} color={solid ? 'onDanger' : 'dangerText'} strokeWidth={2.1} />
        )}
      </View>
      <Text variant={round ? 'caption' : 'label'} weight={700} tabular style={{ color: round ? theme.colors.dangerText : fg }} testID={`${testID}-label`}>
        {label}
      </Text>
    </Pressable>
  );
}

/** `refused`: the server answered no (an older server's hourly limit, a trip that is over) — no retry, the emergency number first. */
export type SosSheetPhase = 'sending' | 'open' | 'acknowledged' | 'resolved' | 'cancelled' | 'failed' | 'offline' | 'refused';

export interface SosSheetProps {
  phase: SosSheetPhase;
  /** Epoch ms: "كنسل — تنبيه بالغلط" shows until then. */
  cancelUntil?: number | null;
  /** Dispatcher's first name once someone took it. */
  acknowledgedBy?: string | null;
  /** The emergency contact's first name; null = none set. */
  contactName?: string | null;
  /** The contact was messaged (after the cancel window). */
  contactNotified?: boolean;
  /** Positions are still being shared. */
  sharing?: boolean;
  cancelling?: boolean;
  /** The emergency number (one constant: `SAFETY_RULES.policeNumber`, passed by each app). */
  policeNumber: string;
  /**
   * `rider` (customer rides, L-17): the police call first and filled, the car to read out, who is
   * looking ("فريق درايفر"), then the false-alarm cancel as a quiet text button. `standard` (the
   * Partner app) keeps its order.
   */
  layout?: 'standard' | 'rider';
  /** Rider layout: the car to read out to the police ("عباس · تويوتا كورولا أبيض · واسط 31207"). */
  car?: string | null;
  /** Rider layout with no emergency contact: send my location to someone I trust (system share sheet). */
  onShareLocation?: () => void;
  onCancel?: () => void;
  onClose: () => void;
  onRetry?: () => void;
  onCallPolice?: () => void;
  clock?: () => number;
  testID?: string;
}

/**
 * What the person sees once the alert is sent (voice spec #26, "calm in danger"): it states the fact
 * and the next step — "وصلنا تنبيهك. فريق درايفر يشوف موقعك هسة ويتصل بيك" — with "كنسل — تنبيه بالغلط"
 * for 10 seconds, then who took it, whether the emergency contact was told, and that the location
 * keeps going to dispatch. If the alert could not be sent it says so and offers the police number.
 */
export function SosSheet({
  phase,
  cancelUntil,
  acknowledgedBy,
  contactName,
  contactNotified = false,
  sharing = true,
  cancelling = false,
  policeNumber,
  layout = 'standard',
  car = null,
  onShareLocation,
  onCancel,
  onClose,
  onRetry,
  onCallPolice,
  clock = Date.now,
  testID = 'sos-sheet',
}: SosSheetProps) {
  const theme = useTheme();
  const [now, setNow] = useState(clock);
  const left = cancelUntil ? sosCancelLeft(cancelUntil, now) : 0;
  useEffect(() => {
    if (!left) return;
    const id = setInterval(() => setNow(clock()), 250);
    return () => clearInterval(id);
  }, [left, clock]);

  const live = phase === 'open' || phase === 'acknowledged';
  const refused = phase === 'refused';
  const failed = phase === 'failed' || phase === 'offline' || refused;
  const rider = layout === 'rider';
  const title =
    phase === 'sending'
      ? t('sos.sending')
      : phase === 'acknowledged'
        ? acknowledgedBy
          ? t('sos.acknowledged_by', { name: acknowledgedBy })
          : t('sos.acknowledged')
        : phase === 'cancelled'
          ? t('sos.cancelled')
          : phase === 'resolved'
            ? t('sos.resolved')
            : phase === 'failed'
              ? t('sos.failed', { number: policeNumber })
              : phase === 'offline'
                ? t('sos.offline', { number: policeNumber })
                : refused
                  ? t('sos.refused', { number: policeNumber })
                : rider
                  ? t('sos.rider_sent')
                  : t('safety.sos_sent');

  return (
    <View testID={testID} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, justifyContent: 'flex-end', zIndex: 50 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('sos.back')} onPress={live || phase === 'resolved' || phase === 'cancelled' ? onClose : undefined} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.scrim }} />
      <View
        accessibilityViewIsModal
        accessibilityLiveRegion="assertive"
        aria-live="assertive"
        role="alertdialog"
        aria-label={t('sos.sheet_title')}
        style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius['2xl'], borderTopRightRadius: theme.radius['2xl'], paddingHorizontal: theme.space[5], paddingTop: theme.space[6], paddingBottom: theme.space[8], gap: theme.space[4], width: '100%', maxWidth: 560, alignSelf: 'center' }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: phase === 'cancelled' || phase === 'resolved' ? theme.colors.surfaceSunken : theme.colors.dangerTint }}>
            <Icon name={phase === 'cancelled' || phase === 'resolved' ? 'check' : 'sos'} size={24} color={phase === 'cancelled' || phase === 'resolved' ? 'text' : 'dangerText'} strokeWidth={2} />
          </View>
          <Text variant="caption" color="textMuted" weight={600} style={{ flex: 1 }}>
            {t('sos.sheet_title')}
          </Text>
        </View>
        <Text variant="title" testID={`${testID}-title`} style={{ lineHeight: 32 }}>
          {title}
        </Text>

        {rider && live ? (
          <View style={{ gap: theme.space[3] }}>
            {onCallPolice ? <Button label={t('sos.call_police', { number: policeNumber })} variant="destructive" size="lg" icon="phone" fullWidth onPress={onCallPolice} haptic="heavy" testID="sos-police" /> : null}
            {car ? (
              <View testID="sos-car" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
                <Icon name="car" size={22} color="text" strokeWidth={2} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="caption" color="textMuted">
                    {t('sos.car_label')}
                  </Text>
                  <Text variant="bodyStrong">{car}</Text>
                </View>
              </View>
            ) : null}
            <Line icon="location-arrow" text={t('sos.rider_team')} tone="text" live={sharing} testID="sos-team" />
            {contactName === null ? (
              onShareLocation ? (
                <Button label={t('sos.share_location')} variant="secondary" icon="share" fullWidth onPress={onShareLocation} testID="sos-share-location" />
              ) : null
            ) : contactName && contactNotified ? (
              <Line icon="check" text={t('sos.contact_notified', { name: contactName })} tone="successText" />
            ) : null}
          </View>
        ) : null}

        {!rider && live ? (
          <View style={{ gap: theme.space[2] }}>
            {sharing ? <Line icon="location-arrow" text={t('sos.sharing')} tone="text" live /> : null}
            {contactName === null ? <Line icon="user" text={t('sos.contact_none')} tone="textMuted" /> : contactName && contactNotified ? <Line icon="check" text={t('sos.contact_notified', { name: contactName })} tone="successText" /> : null}
          </View>
        ) : null}

        {rider && live && left > 0 && onCancel ? (
          <Button label={t('sos.rider_cancel', { seconds: left })} variant="ghost" fullWidth loading={cancelling} onPress={onCancel} testID="sos-cancel" />
        ) : null}

        {!rider && live && left > 0 && onCancel ? (
          <View style={{ gap: theme.space[1] }}>
            <Button label={`${t('sos.cancel')} (${left})`} variant="secondary" size="lg" fullWidth loading={cancelling} onPress={onCancel} haptic="medium" testID="sos-cancel" />
            <Text variant="caption" color="textMuted" align="center" tabular>
              {t('sos.cancel_left', { seconds: left })}
            </Text>
          </View>
        ) : null}

        {refused && onCallPolice ? (
          <Button label={t('sos.call_police', { number: policeNumber })} variant="destructive" size="lg" icon="phone" fullWidth onPress={onCallPolice} haptic="heavy" testID="sos-police" />
        ) : null}
        {failed && !refused && onRetry ? <Button label={t('action.retry')} variant="destructive" size="lg" fullWidth onPress={onRetry} testID="sos-retry" /> : null}
        {((failed && !refused) || (live && !rider)) && onCallPolice ? (
          <Button label={t('sos.call_police', { number: policeNumber })} variant={failed ? 'secondary' : 'ghost'} icon="phone" fullWidth onPress={onCallPolice} testID="sos-police" />
        ) : null}
        {phase !== 'sending' && !(live && left > 0) ? <Button label={t('sos.back')} variant={failed ? 'ghost' : 'primary'} size="lg" fullWidth onPress={onClose} testID="sos-close" /> : null}
      </View>
    </View>
  );
}

function Line({ icon, text, tone, live = false, testID }: { icon: 'location-arrow' | 'user' | 'check'; text: string; tone: 'text' | 'textMuted' | 'successText'; live?: boolean; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      <View style={{ width: 28, alignItems: 'center' }}>
        {live ? <View style={{ position: 'absolute', width: 8, height: 8, borderRadius: 4, top: -2, end: 2, backgroundColor: theme.colors.danger }} /> : null}
        <Icon name={icon} size={18} color={tone} strokeWidth={2} />
      </View>
      <Text variant="label" color={tone} style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
