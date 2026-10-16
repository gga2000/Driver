import { View } from 'react-native';
import { Text, useTheme } from '@driver/ui';

/**
 * Placeholder wordmark until the brand symbol is chosen (brand spec: mark pending): "درايفر" in Plex
 * Bold with the accent dot, plus the work-app tag "للمحلات" in a dark pill (Driver Merchant).
 */
export function Wordmark({ size = 'lg' }: { size?: 'md' | 'lg' }) {
  const theme = useTheme();
  const fontSize = size === 'lg' ? 40 : 26;
  return (
    <View accessibilityRole="header" accessibilityLabel="درايفر للمحلات" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
        <Text weight={700} color="accentText" style={{ fontSize, lineHeight: Math.round(fontSize * 1.5) }}>
          درايفر
        </Text>
        <View style={{ width: fontSize * 0.22, height: fontSize * 0.22, borderRadius: fontSize, backgroundColor: theme.colors.accent, marginBottom: fontSize * 0.42 }} />
      </View>
      <View style={{ backgroundColor: theme.colors.text, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[3], paddingVertical: 2, marginTop: fontSize * 0.12 }}>
        <Text weight={700} style={{ color: theme.colors.bg, fontSize: fontSize * 0.42, lineHeight: Math.round(fontSize * 0.42 * 1.6) }}>
          للمحلات
        </Text>
      </View>
    </View>
  );
}
