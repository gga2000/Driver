import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Linking, Platform, View } from 'react-native';
import { Button, Icon, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { consoleAlertUrl } from '@/features/notify/prompt';
import { CONSOLE_URL } from '@/lib/env';
import { useT } from '@/lib/i18n';

/**
 * A staff safety alert (SOS, the خطوط sweep, the Console watching itself) tapped on this phone. Staff
 * answer it in the Console, so on a phone the tap goes straight there (the incident when the push
 * names one); this screen stays behind with the same button, in case the browser did not open. A build
 * without a Console address (`EXPO_PUBLIC_CONSOLE_URL`) shows no link: it says to open the Console on a
 * computer, with the alert number.
 */
export default function StaffAlert() {
  const theme = useTheme();
  const t = useT();
  const { incident } = useLocalSearchParams<{ incident?: string }>();
  const url = consoleAlertUrl(CONSOLE_URL, incident ?? null);
  const open = () => {
    if (url) void Linking.openURL(url).catch(() => undefined);
  };
  useEffect(() => {
    if (url && Platform.OS !== 'web') void Linking.openURL(url).catch(() => undefined);
  }, [url]);
  return (
    <Screen
      testID="staff-alert"
      edges={['top', 'bottom']}
      contentStyle={{ gap: theme.space[5], flexGrow: 1, justifyContent: 'center' }}
      footer={
        <View style={{ gap: theme.space[2] }}>
          {url ? <Button testID="staff-alert-open" label={t('partner.staff_alert_open')} size="lg" fullWidth haptic="medium" onPress={open} /> : null}
          <Button testID="staff-alert-back" label={t('partner.staff_alert_back')} variant="ghost" fullWidth onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </View>
      }
    >
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: theme.colors.dangerTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sos" size={40} color="danger" strokeWidth={2} />
        </View>
      </View>
      <View style={{ gap: theme.space[2] }}>
        <Text variant="heading" accessibilityRole="header" align="center">
          {t('partner.staff_alert_title')}
        </Text>
        <Text variant="body" color="textMuted" align="center">
          {url ? t('partner.staff_alert_body') : t('partner.staff_alert_no_link')}
        </Text>
        {incident ? (
          <Text testID="staff-alert-ref" variant="label" align="center" selectable>
            {t('partner.staff_alert_ref', { id: incident })}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
