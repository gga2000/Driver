import { router } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { useT } from '@/lib/i18n';

/**
 * A link to a page that doesn't exist (day-one d10): say so plainly, «ماكو هيچ صفحة», and one way
 * back to the orders, centred. (It used to say the page was being built, which it isn't.)
 */
export default function NotFound() {
  const theme = useTheme();
  const t = useT();
  return (
    <SafeAreaView testID="not-found" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space[4], padding: theme.space[6] }}>
        <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <MIcon name="receipt" size={32} color="textMuted" />
        </View>
        <View style={{ gap: theme.space[2], maxWidth: 420, alignItems: 'center' }}>
          <Text variant="heading" align="center" accessibilityRole="header">
            {t('merchant.notfound.title')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {t('merchant.notfound.body')}
          </Text>
        </View>
        <Button testID="not-found-back" label={t('merchant.notfound.back')} icon="receipt" size="lg" onPress={() => router.replace('/')} style={{ alignSelf: 'center', minWidth: 220 }} />
      </View>
    </SafeAreaView>
  );
}
