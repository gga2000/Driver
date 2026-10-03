import { View } from 'react-native';
import { Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

/**
 * Placeholder wordmark until the brand symbol is chosen (brand spec: mark pending), with the
 * Partner tag ("شريك") so a driver never confuses this app with the customer one.
 */
export function Wordmark({ size = 'lg', partner = true }: { size?: 'md' | 'lg'; partner?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const fontSize = size === 'lg' ? 40 : 26;
  return (
    <View accessibilityRole="header" accessibilityLabel={t('partner.app_name')} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
        <Text weight={700} color="accentText" style={{ fontSize, lineHeight: Math.round(fontSize * 1.5) }}>
          درايفر
        </Text>
        <View style={{ width: fontSize * 0.22, height: fontSize * 0.22, borderRadius: fontSize, backgroundColor: theme.colors.accent, marginBottom: fontSize * 0.42 }} />
      </View>
      {partner ? (
        <View style={{ backgroundColor: theme.colors.text, borderRadius: theme.radius.pill, paddingHorizontal: size === 'lg' ? 14 : 10, paddingVertical: size === 'lg' ? 4 : 2 }}>
          <Text variant={size === 'lg' ? 'title' : 'label'} weight={700} color="surface">
            {t('partner.badge')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
