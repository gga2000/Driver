import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Linking, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { consoleAlertUrl } from '@/features/notify/prompt';
import { CONSOLE_URL } from '@/lib/env';
import { useT } from '@/lib/i18n';

/**
 * A staff safety alert (SOS, the خطوط sweep, the Console watching itself) tapped on this device. Staff
 * answer it in the Console, so on a phone or tablet the tap goes straight there (the incident when the
 * push names one); this screen stays behind with the same button, in case the browser did not open.
 */
export default function StaffAlert() {
  const theme = useTheme();
  const t = useT();
  const { incident } = useLocalSearchParams<{ incident?: string }>();
  const url = consoleAlertUrl(CONSOLE_URL, incident ?? null);
  useEffect(() => {
    if (Platform.OS !== 'web') void Linking.openURL(url).catch(() => undefined);
  }, [url]);
  return (
    <SafeAreaView testID="staff-alert" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space[5], padding: theme.space[6] }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: theme.colors.dangerTint, alignItems: 'center', justifyContent: 'center' }}>
          <MIcon name="shield" size={40} color="danger" strokeWidth={2} />
        </View>
        <View style={{ gap: theme.space[2], maxWidth: 460 }}>
          <Text variant="heading" align="center" accessibilityRole="header">
            {t('merchant.staff_alert.title')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {t('merchant.staff_alert.body')}
          </Text>
        </View>
        <View style={{ gap: theme.space[2], width: '100%', maxWidth: 400 }}>
          <Button testID="staff-alert-open" label={t('merchant.staff_alert.open')} size="lg" fullWidth onPress={() => void Linking.openURL(url).catch(() => undefined)} />
          <Button testID="staff-alert-back" label={t('merchant.staff_alert.back')} variant="ghost" onPress={() => router.replace('/')} style={{ alignSelf: 'center' }} />
        </View>
      </View>
    </SafeAreaView>
  );
}
