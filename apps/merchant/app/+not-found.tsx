import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

export default function NotFound() {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space[4], backgroundColor: theme.colors.bg, padding: theme.space[6] }}>
      <Text variant="title" align="center">
        {t('merchant.placeholder.title')}
      </Text>
      <Button label={t('merchant.placeholder.back')} onPress={() => router.replace('/')} />
    </View>
  );
}
