import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@driver/i18n';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { useTheme } from '../theme/ThemeProvider';
import { STATUS_TONES, type StatusTone } from './StatusPill';
import { Text } from './Text';

/** The Console's status banner severities (`system.banner`). */
export type BannerSeverity = 'info' | 'warning' | 'critical';

const TONE: Record<BannerSeverity, Exclude<StatusTone, 'neutral' | 'accent' | 'success'>> = { info: 'info', warning: 'warning', critical: 'danger' };
const ICON: Record<BannerSeverity, IconName> = { info: 'bell', warning: 'clock', critical: 'shield' };

/** A critical notice ("الطلبات متوقفة") stays until the Console clears it; the others can be dismissed. */
export function bannerDismissible(severity: BannerSeverity): boolean {
  return severity !== 'critical';
}

export interface StatusBannerProps {
  severity: BannerSeverity;
  message: string;
  /** Shown as a close button for info / warning banners only. */
  onDismiss?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The launch status banner every open app shows under its header (launch playbook §3): a tinted,
 * full-width strip with the tone's icon chip and the Console's message. Announced politely to screen
 * readers (assertively when critical); RTL-first, the close button on the end side.
 */
export function StatusBanner({ severity, message, onDismiss, testID = 'status-banner', style }: StatusBannerProps) {
  const theme = useTheme();
  const c = STATUS_TONES[TONE[severity]];
  const fg = theme.colors[c.fg];
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion={severity === 'critical' ? 'assertive' : 'polite'}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          paddingVertical: theme.space[2],
          paddingStart: theme.space[3],
          paddingEnd: onDismiss && bannerDismissible(severity) ? theme.space[1] : theme.space[3],
          backgroundColor: theme.colors[c.bg],
          borderBottomWidth: 1,
          borderBottomColor: theme.colors[c.dot],
        },
        style,
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors[c.dot] }}
      >
        <Icon name={ICON[severity]} size={16} color={theme.colors.surface} />
      </View>
      <Text variant="body" weight={severity === 'critical' ? 700 : 600} color={fg} style={{ flex: 1 }}>
        {message}
      </Text>
      {onDismiss && bannerDismissible(severity) ? (
        <Pressable
          testID={`${testID}-dismiss`}
          accessibilityRole="button"
          accessibilityLabel={t('action.close')}
          onPress={onDismiss}
          hitSlop={8}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="x" size={18} color={fg} />
        </Pressable>
      ) : null}
    </View>
  );
}
