import { View, type StyleProp, type ViewStyle } from 'react-native';
import { t as sharedT, type Locale } from '@driver/i18n';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Text } from './Text';

/**
 * The call button while calls are not live (G0-10, Ali 2026-10-07: chat first; in-app calls come after
 * launch). It stays where the call will be, greyed, with «قريباً» on it, and still answers a tap (the
 * screen says to send a message or a voice note instead), so nobody wonders why a button is dead.
 */

function SoonTag({ locale }: { locale?: Locale }) {
  const theme = useTheme();
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceSunken, borderWidth: 1, borderColor: theme.colors.border }}>
      <Text variant="caption" weight={600} color="textMuted" compact numberOfLines={1}>
        {sharedT('call.soon', undefined, locale)}
      </Text>
    </View>
  );
}

export interface CallSoonIconProps {
  onPress: () => void;
  size?: 36 | 44 | 52;
  locale?: Locale;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** A round phone button, greyed, with «قريباً» hanging under it. */
export function CallSoonIcon({ onPress, size = 44, locale, testID = 'call-soon', style }: CallSoonIconProps) {
  const theme = useTheme();
  return (
    <View style={[{ alignItems: 'center' }, style]}>
      <IconButton
        icon="phone"
        variant="outline"
        size={size}
        haptic={false}
        accessibilityLabel={sharedT('call.soon_label', undefined, locale)}
        onPress={onPress}
        testID={testID}
        style={{ opacity: theme.state.disabledOpacity }}
      />
      <View pointerEvents="none" style={{ position: 'absolute', bottom: -10 }}>
        <SoonTag locale={locale} />
      </View>
    </View>
  );
}

export interface CallSoonButtonProps {
  onPress: () => void;
  fullWidth?: boolean;
  locale?: Locale;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** A full call button («اتصل» · قريباً), greyed. */
export function CallSoonButton({ onPress, fullWidth, locale, testID = 'call-soon', style }: CallSoonButtonProps) {
  const theme = useTheme();
  return (
    <Button
      label={sharedT('call.soon_button', undefined, locale)}
      icon="phone"
      variant="secondary"
      fullWidth={fullWidth}
      haptic={false}
      accessibilityLabel={sharedT('call.soon_label', undefined, locale)}
      trailing={<SoonTag locale={locale} />}
      onPress={onPress}
      testID={testID}
      style={[{ opacity: theme.state.disabledOpacity }, style]}
    />
  );
}
