import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { t } from '@driver/i18n';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { useTheme } from '../theme/ThemeProvider';
import { STATUS_TONES, type StatusTone } from './StatusPill';
import { Text } from './Text';

export interface ToastData {
  message: string;
  tone?: Exclude<StatusTone, 'accent'>;
  icon?: IconName;
  action?: { label: string; onPress: () => void };
}

const DEFAULT_ICON: Record<NonNullable<ToastData['tone']>, IconName> = {
  neutral: 'bell',
  success: 'check',
  warning: 'clock',
  danger: 'x',
  info: 'shield',
};

export interface ToastProps extends ToastData {
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Ink-dark toast that springs up from the bottom; tone shows as the icon chip, so the message
 * stays high-contrast whatever the tone.
 */
export function Toast({ message, tone = 'neutral', icon, action, onDismiss, style }: ToastProps) {
  const theme = useTheme();
  const y = useSharedValue(theme.reduceMotion ? 0 : 24);
  const o = useSharedValue(theme.reduceMotion ? 1 : 0);
  useEffect(() => {
    y.value = withSpring(0, theme.motion.spring.gentle);
    o.value = withTiming(1, { duration: theme.motion.duration.fast });
  }, [y, o, theme.motion]);
  const enter = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  const c = STATUS_TONES[tone];
  // Inverted surface: the brand ink on light, cream on dark.
  const bg = theme.name === 'light' ? theme.colors.text : theme.colors.surfaceRaised;
  const fg = theme.name === 'light' ? theme.colors.bg : theme.colors.text;
  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          minHeight: 56,
          paddingVertical: theme.space[2],
          paddingStart: theme.space[2],
          paddingEnd: theme.space[3],
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
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.colors[c.bg], alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon ?? DEFAULT_ICON[tone]} size={20} color={c.fg} strokeWidth={2} />
      </View>
      <Text variant="label" color={fg} style={{ flex: 1 }}>
        {message}
      </Text>
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={8} style={{ paddingHorizontal: theme.space[2], minHeight: 44, justifyContent: 'center' }}>
          <Text variant="label" weight={700} color={theme.name === 'light' ? theme.colors.accentTint : theme.colors.accentText}>
            {action.label}
          </Text>
        </Pressable>
      ) : onDismiss ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('ui.dismiss')} onPress={onDismiss} hitSlop={8} style={{ padding: theme.space[1] }}>
          <Icon name="x" size={18} color={fg} />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

interface ToastApi {
  show: (toast: ToastData, durationMs?: number) => void;
  hide: () => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {}, hide: () => {} });

/** Hosts one toast at a time at the bottom of the screen. */
export function ToastProvider({ children, bottomOffset = 24, maxWidth }: { children: ReactNode; bottomOffset?: number; /** Centred column on wide screens (tablets). */ maxWidth?: number }) {
  const theme = useTheme();
  const [toast, setToast] = useState<(ToastData & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hide = useCallback(() => setToast(null), []);
  const show = useCallback<ToastApi['show']>(
    (data, durationMs = 3500) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ ...data, id: Date.now() });
      if (data.tone === 'danger') theme.haptic('error');
      timer.current = setTimeout(hide, durationMs);
    },
    [hide, theme],
  );
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const api = useMemo(() => ({ show, hide }), [show, hide]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', start: theme.space[4], end: theme.space[4], bottom: bottomOffset, alignItems: 'center' }}>
          <View pointerEvents="box-none" style={{ width: '100%', maxWidth }}>
            <Toast key={toast.id} {...toast} onDismiss={hide} />
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
