import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ConnectionBannerKind } from '@driver/contracts/net-client';
import { t as sharedT, type Locale } from '@driver/i18n';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { agoText } from '../network/ago';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

const ICON: Record<ConnectionBannerKind, IconName> = { offline: 'wifi-off', unreachable: 'wifi-off', stale: 'clock', back: 'wifi' };

export interface OfflineBannerLabels {
  offline: string;
  unreachable: string;
  back: string;
  /** With `{ago}` ("قبل 40 ثانية"). */
  stale: string;
  retry: string;
}

export interface OfflineBannerProps {
  /** Nothing renders for null. */
  kind: ConnectionBannerKind | null;
  /** Age of the data on screen, for "التحديث متأخر · آخر تحديث قبل 40 ثانية". */
  ageSeconds?: number | null;
  /** "جرّب هسة" while the API can't be reached (probes now instead of waiting 5 s). */
  onRetry?: () => void;
  /** Copy in the app's locale; defaults to the shared `net.*` strings. */
  locale?: Locale;
  labels?: Partial<OfflineBannerLabels>;
  /** Extra top padding (the status-bar inset when it is the first strip on screen). */
  topInset?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The one connection strip every app shows under the status banner: "النت مقطوع — نحاول نرجع…"
 * (offline), "ما نگدر نوصل لدرايفر — نحاول كل 5 ثواني" (API unreachable), "رجع النت" for a moment
 * after, and "التحديث متأخر" for a screen whose live data is old. Announced politely. Like every structural
 * warning it is the inverse ink banner (VIS-10), never a pale tint; the icon carries the colour.
 */
export function OfflineBanner({ kind, ageSeconds, onRetry, locale, labels, topInset = 0, testID = 'offline-banner', style }: OfflineBannerProps) {
  const theme = useTheme();
  if (!kind) return null;
  const fg = theme.colors.onInverse;
  const mark = kind === 'back' ? theme.colors.onInverseSuccess : theme.colors.onInverseCaution;
  const tr = (key: Parameters<typeof sharedT>[0], params?: Record<string, string | number>) => sharedT(key, params, locale);
  const ago = agoText(ageSeconds ?? 0, tr);
  const message =
    kind === 'stale'
      ? (labels?.stale ?? tr('net.stale', { ago: '{ago}' })).replace('{ago}', ago)
      : kind === 'back'
        ? (labels?.back ?? tr('net.back'))
        : kind === 'offline'
          ? (labels?.offline ?? tr('net.offline'))
          : (labels?.unreachable ?? tr('net.unreachable'));
  const retry = kind === 'unreachable' && onRetry;
  return (
    <View
      testID={`${testID}-${kind}`}
      accessibilityRole={kind === 'back' ? undefined : 'alert'}
      accessibilityLiveRegion="polite"
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          minHeight: 44,
          paddingTop: topInset + theme.space[2],
          paddingBottom: theme.space[2],
          paddingStart: theme.space[4],
          paddingEnd: retry ? theme.space[2] : theme.space[4],
          backgroundColor: theme.colors.inverse,
        },
        style,
      ]}
    >
      <Icon name={ICON[kind]} size={20} color={mark} strokeWidth={2} />
      <Text variant="label" weight={600} color={fg} style={{ flex: 1 }}>
        {message}
      </Text>
      {retry ? (
        <Pressable
          testID={`${testID}-retry`}
          accessibilityRole="button"
          onPress={onRetry}
          hitSlop={4}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[1],
            minHeight: 44,
            paddingHorizontal: theme.space[3],
            borderRadius: theme.radius.pill,
            borderWidth: 1,
            borderColor: theme.colors.onInverseMuted,
            backgroundColor: pressed ? theme.colors.onInverseMuted : 'transparent',
          })}
        >
          <Icon name="refresh" size={16} color={fg} strokeWidth={2.2} />
          <Text variant="label" weight={700} color={fg}>
            {labels?.retry ?? tr('net.retry_now')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
