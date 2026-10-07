import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { t as sharedT, type Locale } from '@driver/i18n';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Text } from './Text';

/** Why the screen has nothing to show: no network, the API can't be reached, slow, or our server. */
export type RetryKind = 'offline' | 'unreachable' | 'slow' | 'server';

const ICON: Record<RetryKind, IconName> = { offline: 'wifi-off', unreachable: 'wifi-off', slow: 'clock', server: 'shield' };

export interface RetryStateProps {
  kind: RetryKind;
  onRetry?: () => void;
  /** Override the title / body (e.g. "النت ضعيف. نحاول نرجع نجيب المنيو"). */
  title?: string;
  /** `null` for no body line (a title that already says it all). */
  body?: string | null;
  retryLabel?: string;
  /** A second, quieter way out ("اتصل بالدعم"). */
  secondary?: { label: string; onPress: () => void; icon?: IconName };
  locale?: Locale;
  /** A sketchbook scene (joy J4, e.g. the offline Tigris) in place of the icon tile. */
  art?: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The standard "couldn't load" state: what went wrong in plain words (never "Failed to fetch"), and a
 * retry. Skeletons turn into this after `useLoadTimeout`; queries that fail show it at once.
 */
export function RetryState({ kind, onRetry, title, body, retryLabel, secondary, locale, art, testID = 'retry-state', style }: RetryStateProps) {
  const theme = useTheme();
  const tr = (key: Parameters<typeof sharedT>[0]) => sharedT(key, undefined, locale);
  const copy: Record<RetryKind, [string, string]> = {
    offline: [tr('net.offline_title'), tr('net.offline_body')],
    unreachable: [tr('net.unreachable_title'), tr('net.unreachable_body')],
    slow: [tr('net.slow_title'), tr('net.slow_body')],
    server: [tr('net.server_title'), tr('net.server_body')],
  };
  const [defTitle, defBody] = copy[kind];
  const danger = kind === 'server';
  return (
    <View testID={`${testID}-${kind}`} accessibilityLiveRegion="polite" style={[{ alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[8], paddingHorizontal: theme.space[6] }, style]}>
      {art ? (
        <View style={{ width: '100%', maxWidth: 280, marginBottom: theme.space[1] }}>{art}</View>
      ) : (
        <View testID={`${testID}-icon`} style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: danger ? theme.colors.dangerTint : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={ICON[kind]} size={32} color={danger ? 'dangerText' : 'textMuted'} strokeWidth={1.8} />
        </View>
      )}
      <Text variant="title" align="center">
        {title ?? defTitle}
      </Text>
      {body === null ? null : (
        <Text variant="body" color="textMuted" align="center" style={{ maxWidth: 320 }}>
          {body ?? defBody}
        </Text>
      )}
      {onRetry ? <Button testID={`${testID}-retry`} label={retryLabel ?? tr('action.retry')} icon="refresh" onPress={onRetry} variant="secondary" style={{ alignSelf: 'center', marginTop: theme.space[2] }} /> : null}
      {secondary ? <Button label={secondary.label} icon={secondary.icon} onPress={secondary.onPress} variant="ghost" style={{ alignSelf: 'center' }} /> : null}
    </View>
  );
}
