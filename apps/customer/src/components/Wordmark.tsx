import { View } from 'react-native';
import { Text, useTheme } from '@driver/ui';

/**
 * Placeholder wordmark until the brand symbol is chosen (brand spec: mark pending). Plex Bold in
 * the accent with an accent dot — swap this one component when the symbol lands.
 */
export function Wordmark({
  size = 'lg',
  onDark = false,
  onSaffron = false,
}: {
  size?: 'md' | 'lg';
  /** Cream letters for a dark photo (the welcome screen). */
  onDark?: boolean;
  /** Ink letters and a cream dot on the saffron fill (the update page). */
  onSaffron?: boolean;
}) {
  const theme = useTheme();
  const fontSize = size === 'lg' ? 40 : 26;
  return (
    <View accessibilityRole="header" accessibilityLabel="درايفر" style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
      <Text weight={700} color={onDark ? 'onInverse' : onSaffron ? 'text' : 'accentText'} style={{ fontSize, lineHeight: Math.round(fontSize * 1.5) }}>
        درايفر
      </Text>
      <View
        style={{
          width: fontSize * 0.22,
          height: fontSize * 0.22,
          borderRadius: fontSize,
          backgroundColor: onSaffron ? theme.colors.bg : theme.colors.accent,
          marginBottom: fontSize * 0.42,
        }}
      />
    </View>
  );
}
