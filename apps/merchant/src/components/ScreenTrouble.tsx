import { router, type ErrorBoundaryProps } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import { Button, getNetwork, Icon, Text, useNetwork, useTheme } from '@driver/ui';
import { crashReporter } from '@/lib/crash';
import { useT } from '@/lib/i18n';
import { isChunkLoadError, troubleStep } from '@/lib/screen-trouble';

/**
 * Day-one d02: one screen failing never takes the app down with it. In place of that screen only — the
 * tabs or the rail and the orders board stay — a small card says what happened. With no net it says
 * «النت مقطوع، نرجع نحاول وحدنا» and tries again by itself the moment the net is back; any other
 * failure offers «جرّب مرة ثانية» and the way back to the orders.
 */
export function ScreenTrouble({ error, retry }: ErrorBoundaryProps) {
  const theme = useTheme();
  const t = useT();
  const net = useNetwork();
  const chunk = isChunkLoadError(error);
  const web = Platform.OS === 'web';
  const offline = !net.online;
  // Only a failure the net caused fixes itself (no reload loop when the server, not the net, is down).
  const sawOffline = useRef(offline);
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current || chunk) return;
    reported.current = true;
    crashReporter.capture(error);
  }, [error, chunk]);

  const recover = () => {
    const step = troubleStep({ chunk, online: true, web });
    if (step === 'reload' && typeof window !== 'undefined') window.location.reload();
    else void retry();
  };
  // Back online after a failure that the net caused: fix it without a tap.
  useEffect(() => {
    if (offline) {
      sawOffline.current = true;
      return;
    }
    if (!sawOffline.current) return;
    sawOffline.current = false;
    const id = setTimeout(recover, 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the net comes back
  }, [offline]);

  const showOffline = offline || chunk;
  return (
    <View testID="screen-trouble" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space[5], backgroundColor: theme.colors.bg }}>
      <View accessibilityLiveRegion="polite" style={{ width: '100%', maxWidth: 420, gap: theme.space[3], padding: theme.space[5], borderRadius: theme.radius['2xl'], backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: showOffline ? theme.colors.warningTint : theme.colors.dangerTint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={showOffline ? 'wifi-off' : 'refresh'} size={22} color={showOffline ? 'warningText' : 'dangerText'} strokeWidth={2} />
          </View>
          <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">
            {showOffline ? t('merchant.screen.offline_title') : t('merchant.screen.error_title')}
          </Text>
        </View>
        <Text variant="body" color="textMuted">
          {showOffline ? t('merchant.screen.offline_body') : t('merchant.screen.error_body')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {offline ? null : <Button testID="screen-trouble-retry" label={t('merchant.menu.retry')} icon="refresh" size="md" onPress={recover} />}
          {offline ? <Button testID="screen-trouble-check" label={t('merchant.menu.retry')} icon="refresh" variant="secondary" size="md" onPress={() => getNetwork().retryNow()} /> : null}
          <Button testID="screen-trouble-orders" label={t('merchant.screen.back')} icon="receipt" variant="secondary" size="md" onPress={() => router.navigate('/')} />
        </View>
      </View>
    </View>
  );
}
