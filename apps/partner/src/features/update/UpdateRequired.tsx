import { useEffect } from 'react';
import { Linking, Platform, View } from 'react-native';
import { Button, Icon, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { Wordmark } from '@/components/Wordmark';
import { syncBackgroundLocation } from '@/lib/background-location';
import { useT } from '@/lib/i18n';

const PLAY_APP = 'market://details?id=iq.driver.partner';
const PLAY_WEB = 'https://play.google.com/store/apps/details?id=iq.driver.partner';

/**
 * CORE-05 «حدّث التطبيق»: the server refuses this build (`update_required`), so the whole app is this
 * page until he restarts on a new one. It needs no network. Offers, the live channel and the job
 * screens are unmounted with the app behind it and the background location service is stopped; the
 * page tells him he can't take offers on this phone until he updates.
 */
export function UpdateRequired() {
  const theme = useTheme();
  const t = useT();

  useEffect(() => {
    void syncBackgroundLocation({ online: false, onJob: false, vehicleClass: null });
  }, []);

  const openStore = async () => {
    // iOS gets its App Store link once the listing exists (docs/before-launch.md, store setup).
    if (Platform.OS === 'android') {
      try {
        await Linking.openURL(PLAY_APP);
        return;
      } catch {
        // No Play Store app on this phone: the web page.
      }
    }
    await Linking.openURL(PLAY_WEB).catch(() => undefined);
  };

  return (
    <Screen
      testID="update-required"
      contentStyle={{ flexGrow: 1, justifyContent: 'center', gap: theme.space[8] }}
      footer={
        <Button
          testID="update-store"
          label={t('partner.update_button')}
          size="lg"
          fullWidth
          onPress={() => void openStore()}
        />
      }
    >
      <Wordmark size="md" />
      <View style={{ alignItems: 'center', gap: theme.space[5] }}>
        <View
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: theme.colors.accentTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="refresh" size={44} color="accentText" strokeWidth={1.8} />
        </View>
        <View style={{ gap: theme.space[2], alignItems: 'center' }}>
          <Text variant="heading" align="center" accessibilityRole="header">
            {t('partner.update_title')}
          </Text>
          <Text variant="body" color="textMuted" align="center" style={{ maxWidth: 320 }}>
            {t('partner.update_body')}
          </Text>
        </View>
        <View
          testID="update-offers"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[2],
            paddingVertical: theme.space[3],
            paddingHorizontal: theme.space[4],
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surfaceSunken,
            maxWidth: 340,
          }}
        >
          <Icon name="bell" size={18} color="textMuted" strokeWidth={2} />
          <Text variant="label" color="textMuted" style={{ flexShrink: 1 }}>
            {t('partner.update_offers')}
          </Text>
        </View>
      </View>
    </Screen>
  );
}
