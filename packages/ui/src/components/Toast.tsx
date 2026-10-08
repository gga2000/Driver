import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@driver/i18n';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { enqueueToast, remainingAfterPause, toastDuration, yieldsToNext } from '../logic/toast';
import { withAlpha } from '../theme/color';
import { useAnnounce } from '../a11y/announce';
import { useTheme } from '../theme/ThemeProvider';
import { STATUS_TONES, type StatusTone } from './StatusPill';
import { Text } from './Text';

export interface ToastData {
  message: string;
  /**
   * A second, quieter line under the message, so two sentences never break mid-phrase
   * ("رجعنالك 1,000 دينار رصيد" / "آسفين على التأخير", not «التأخير» alone on a line).
   */
  detail?: string;
  tone?: Exclude<StatusTone, 'accent'>;
  icon?: IconName;
  action?: { label: string; onPress: () => void };
  /**
   * `bottom` (default) floats above the tab bar. `top` sits under the status bar, for screens whose
   * last content is an action the toast must not cover (the boarding pass's cancel, C-38 / R-10).
   */
  placement?: 'bottom' | 'top';
}

const DEFAULT_ICON: Record<NonNullable<ToastData['tone']>, IconName> = {
  neutral: 'bell',
  success: 'check',
  warning: 'clock',
  danger: 'x',
  info: 'shield',
};

/** Never vanish right after a finger lifts or focus leaves: at least this long after a pause. */
const MIN_AFTER_PAUSE_MS = 2000;

export interface ToastProps extends ToastData {
  onDismiss?: () => void;
  /** Play the exit (fade and drop, `accelerate`, `fast`) and call `onExited` when done. */
  leaving?: boolean;
  onExited?: () => void;
  /** Touch, hover or keyboard focus on the toast: the provider holds its timer meanwhile. */
  onHold?: (held: boolean) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Ink-dark toast that springs up from the bottom and drops away when it leaves; tone shows as the
 * icon chip, so the message stays high-contrast whatever the tone. The close button is a full 44 px
 * target, next to the action when there is one.
 */
export function Toast({ message, detail, tone = 'neutral', icon, action, placement = 'bottom', onDismiss, leaving = false, onExited, onHold, style }: ToastProps) {
  const theme = useTheme();
  // Enters and leaves toward its own edge: up from the bottom, down from the top.
  const edge = placement === 'top' ? -1 : 1;
  const y = useSharedValue(theme.reduceMotion ? 0 : 24 * edge);
  const o = useSharedValue(theme.reduceMotion ? 1 : 0);
  useEffect(() => {
    y.value = withSpring(0, theme.motion.spring.gentle);
    o.value = withTiming(1, { duration: theme.motion.duration.fast });
  }, [y, o, theme.motion]);
  useEffect(() => {
    if (!leaving) return;
    const done = () => onExited?.();
    if (theme.reduceMotion) {
      o.value = 0;
      done();
      return;
    }
    const [x1, y1, x2, y2] = theme.motion.bezier.accelerate;
    const timing = { duration: theme.motion.duration.fast, easing: Easing.bezier(x1, y1, x2, y2) };
    y.value = withTiming(16 * edge, timing);
    o.value = withTiming(0, timing, (finished) => {
      if (finished) runOnJS(done)();
    });
  }, [leaving, onExited, o, y, edge, theme.reduceMotion, theme.motion]);
  const enter = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  const c = STATUS_TONES[tone];
  // Inverted surface: the brand ink on light, cream on dark.
  const bg = theme.scheme === 'light' ? theme.colors.text : theme.colors.surfaceRaised;
  const fg = theme.scheme === 'light' ? theme.colors.bg : theme.colors.text;
  const hold = (held: boolean) => () => onHold?.(held);
  useAnnounce(detail ? `${message}. ${detail}` : message, { initial: true });
  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        {
          borderRadius: theme.radius.lg,
          backgroundColor: bg,
          shadowColor: theme.colors.shadow,
          shadowOpacity: theme.elevation[3].shadowOpacity,
          shadowRadius: theme.elevation[3].shadowRadius,
          shadowOffset: theme.elevation[3].shadowOffset,
          elevation: theme.elevation[3].elevation,
        },
        enter,
        style,
      ]}
    >
      <Pressable
        accessible={false}
        focusable={false}
        onPressIn={hold(true)}
        onPressOut={hold(false)}
        onHoverIn={hold(true)}
        onHoverOut={hold(false)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[2],
          minHeight: 56,
          paddingVertical: theme.space[1],
          paddingStart: theme.space[2],
          paddingEnd: theme.space[1],
        }}
      >
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.colors[c.bg], alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon ?? DEFAULT_ICON[tone]} size={20} color={c.fg} strokeWidth={2} />
        </View>
        <View style={{ flex: 1, marginStart: theme.space[1], gap: 2 }}>
          <Text variant="label" color={fg}>
            {message}
          </Text>
          {detail ? (
            <Text variant="footnote" color={withAlpha(fg, 0.78)}>
              {detail}
            </Text>
          ) : null}
        </View>
        {action ? (
          <Pressable
            accessibilityRole="button"
            onPress={action.onPress}
            onFocus={hold(true)}
            onBlur={hold(false)}
            style={{ paddingHorizontal: theme.space[2], minHeight: theme.hitTarget, minWidth: theme.hitTarget, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text variant="label" weight={700} color={theme.scheme === 'light' ? theme.colors.accentTint : theme.colors.accentText}>
              {action.label}
            </Text>
          </Pressable>
        ) : null}
        {onDismiss ? (
          <Pressable
            testID="toast-dismiss"
            accessibilityRole="button"
            accessibilityLabel={t('ui.dismiss')}
            onPress={onDismiss}
            onFocus={hold(true)}
            onBlur={hold(false)}
            style={{ width: theme.hitTarget, height: theme.hitTarget, alignItems: 'center', justifyContent: 'center', borderRadius: theme.hitTarget / 2 }}
          >
            <Icon name="x" size={18} color={fg} />
          </Pressable>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

interface ToastApi {
  /** Queue a toast. `durationMs` overrides the default (4 s, 8 s with an action, ×2 with a screen reader). */
  show: (toast: ToastData, durationMs?: number) => void;
  /** Send the toast on screen away (it plays its exit, then the next waiting one shows). */
  hide: () => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {}, hide: () => {} });

type Live = ToastData & { id: number; durationMs: number };

function useScreenReader(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    // react-native-web always answers true (it can't tell), so only native asks.
    if (Platform.OS === 'web') return;
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled?.()
      .then((v) => alive && setOn(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('screenReaderChanged', (v: boolean) => setOn(!!v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return on;
}

/**
 * Hosts toasts at the bottom of the screen, one at a time with a short waiting line (audit S-21):
 * timers pause while the toast is touched, hovered or focused, and every toast leaves with an exit.
 */
export function ToastProvider({
  children,
  bottomOffset = 24,
  maxWidth,
  placement: defaultPlacement = 'bottom',
}: {
  children: ReactNode;
  bottomOffset?: number;
  /** Centred column on wide screens (tablets). */
  maxWidth?: number;
  /** Where toasts go unless one asks otherwise: `top` in the Partner app, so none covers a slide or a button (h11). */
  placement?: 'bottom' | 'top';
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const screenReader = useScreenReader();
  const [current, setCurrent] = useState<Live | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [held, setHeld] = useState(false);
  const waiting = useRef<Live[]>([]);
  const currentRef = useRef<Live | null>(null);
  currentRef.current = current;
  const remaining = useRef(0);
  const nextId = useRef(1);

  const hide = useCallback(() => {
    if (currentRef.current) setLeaving(true);
  }, []);

  const show = useCallback<ToastApi['show']>(
    (data, durationMs) => {
      const item: Live = { ...data, id: nextId.current++, durationMs: toastDuration(data, { screenReader, override: durationMs }) };
      if (data.tone === 'danger') theme.haptic('error');
      if (!currentRef.current) {
        remaining.current = item.durationMs;
        setCurrent(item);
        return;
      }
      waiting.current = enqueueToast(waiting.current, item);
      if (yieldsToNext(currentRef.current)) setLeaving(true);
    },
    [screenReader, theme],
  );

  const onExited = useCallback(() => {
    const next = waiting.current.shift() ?? null;
    remaining.current = next?.durationMs ?? 0;
    setHeld(false);
    setLeaving(false);
    setCurrent(next);
  }, []);

  // The timer runs only while the toast is on screen, not leaving and not held.
  useEffect(() => {
    if (!current || leaving || held) return;
    const started = Date.now();
    const ms = remaining.current;
    const timer = setTimeout(() => setLeaving(true), ms);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(MIN_AFTER_PAUSE_MS, remainingAfterPause(ms, Date.now() - started));
    };
  }, [current, leaving, held]);

  const api = useMemo(() => ({ show, hide }), [show, hide]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      {current ? (
        <View
          pointerEvents="box-none"
          style={[
            { position: 'absolute', start: theme.space[4], end: theme.space[4], alignItems: 'center' },
            (current.placement ?? defaultPlacement) === 'top' ? { top: insets.top + theme.space[2] } : { bottom: bottomOffset },
          ]}
        >
          <View pointerEvents="box-none" style={{ width: '100%', maxWidth }}>
            <Toast key={current.id} {...current} placement={current.placement ?? defaultPlacement} leaving={leaving} onExited={onExited} onHold={setHeld} onDismiss={hide} />
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
