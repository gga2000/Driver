import { View, type StyleProp, type ViewStyle } from 'react-native';
import { t as sharedT, type Locale } from '@driver/i18n';
import { secondsSince } from '@driver/contracts/net-client';
import { Icon } from '../icons/Icon';
import { agoText } from '../network/ago';
import { useNetwork, useNow } from '../network/network';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface StaleNoteProps {
  /** When the data on screen was fetched (React Query's `dataUpdatedAt`). */
  updatedAt: number | null | undefined;
  /** Show even while online (e.g. the live channel is down); default: only while offline / unreachable. */
  force?: boolean;
  locale?: Locale;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * "معروض من آخر مرة · قبل 3 دقايق" — marks cached data as old while the app can't refresh it, so a
 * menu or a list never passes for live. Renders nothing while online (unless `force`).
 */
export function StaleNote({ updatedAt, force, locale, testID = 'stale-note', style }: StaleNoteProps) {
  const theme = useTheme();
  const net = useNetwork();
  const show = Boolean(updatedAt) && (force || !net.online);
  const now = useNow(show, 15_000);
  if (!show || !updatedAt) return null;
  const tr = (key: Parameters<typeof sharedT>[0], params?: Record<string, string | number>) => sharedT(key, params, locale);
  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[
        { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: theme.space[2], paddingVertical: theme.space[1], paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, backgroundColor: theme.colors.warningTint },
        style,
      ]}
    >
      <Icon name="clock" size={16} color="warningText" strokeWidth={2} />
      <Text variant="caption" weight={600} color="warningText">
        {tr('net.cached', { ago: agoText(secondsSince(updatedAt, now), tr) })}
      </Text>
    </View>
  );
}
