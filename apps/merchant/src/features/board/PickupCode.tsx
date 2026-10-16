import { View } from 'react-native';
import { Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

/** The 4-digit code the courier shows at the counter (maps program r4). */
export function PickupCode({ code, small = false, testID }: { code: string; small?: boolean; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID={testID}
      accessibilityLabel={`${t('merchant.radar.code')} ${code.split('').join(' ')}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: small ? 6 : theme.space[2], height: small ? 22 : 28, borderRadius: theme.radius.sm, borderWidth: 1.5, borderColor: theme.colors.text }}
    >
      {small ? null : (
        <Text variant="caption" color="textMuted" style={{ lineHeight: 16 }}>
          {t('merchant.radar.code')}
        </Text>
      )}
      <Text variant={small ? 'caption' : 'label'} weight={700} tabular style={{ letterSpacing: 2, lineHeight: small ? 16 : 20 }}>
        {code}
      </Text>
    </View>
  );
}
