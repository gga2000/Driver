import { Platform, Switch } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface ToggleProps {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * The on/off switch (REL-18): the off track is the strong border colour (3.6:1 on cream), so a switched-off
 * toggle is still plainly a toggle; on is the brand orange with a white thumb.
 */
export function Toggle({ value, onValueChange, disabled, accessibilityLabel, testID }: ToggleProps) {
  const theme = useTheme();
  const off = theme.colors.borderStrong;
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      trackColor={{ true: theme.colors.accent, false: off }}
      thumbColor={Platform.OS === 'android' ? theme.colors.surface : undefined}
      ios_backgroundColor={off}
      {...(Platform.OS === 'web' ? { activeThumbColor: theme.colors.surface } : null)}
    />
  );
}
