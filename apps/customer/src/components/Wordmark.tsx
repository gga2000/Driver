import { View } from 'react-native';
import { Text, useTheme } from '@driver/ui';

/**
 * Placeholder wordmark until the brand symbol is chosen (brand spec: mark pending). Plex Bold in
 * the accent with an accent dot — swap this one component when the symbol lands.
 */
export function Wordmark({ size = 'lg', onDark = false }: { size?: 'md' | 'lg'; /** Cream letters for a dark photo (the welcome screen). */ onDark?: boolean }) {
  const theme = useTheme();
  const fontSize = size === 'lg' ? 40 : 26;
  return (
    <View accessibilityRole="header" accessibilityLabel="درايفر" style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
      <Text weight={700} color={onDark ? 'onInverse' : 'accentText'} style={{ fontSize, lineHeight: Math.round(fontSize * 1.5) }}>
        درايفر
      </Text>
      <View
        style={{
          width: fontSize * 0.22,
          height: fontSize * 0.22,
          borderRadius: fontSize,
          backgroundColor: theme.colors.accent,
          marginBottom: fontSize * 0.42,
        }}
      />
    </View>
  );
}
