import { Linking, Platform, View } from 'react-native';
import { Button, Icon, Screen, Text, useAnnounce, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { STORE_URL } from '@/lib/app-update';
import { Wordmark } from './Wordmark';

/**
 * CORE-05: the server turned this build away (`update_required`). One calm page in place of every
 * screen, with nothing on it that needs the network: the wordmark, why, and the store button. It stays
 * until the app restarts on a new build; no call is retried behind it.
 */
export function UpdateRequired() {
  const theme = useTheme();
  const t = useT();
  useAnnounce(`${t('update.title')}. ${t('error.update_required')}`, { initial: true });
  return (
    <Screen
      scroll={false}
      testID="update-required"
      footer={
        // Play on Android (the web build is never turned away; it shows the same page if it ever were).
        Platform.OS !== 'ios' ? (
          <Button label={t('update.cta')} icon="refresh" fullWidth onPress={() => void Linking.openURL(STORE_URL)} testID="update-required-store" />
        ) : null
      }
    >
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space[4] }}>
        <Wordmark />
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="refresh" size={32} color="accentText" strokeWidth={2.2} />
        </View>
        <Text variant="title" weight={700} style={{ textAlign: 'center' }} accessibilityRole="header">
          {t('update.title')}
        </Text>
        <Text variant="body" color="textMuted" style={{ textAlign: 'center', maxWidth: 320 }}>
          {t('error.update_required')}
        </Text>
        {Platform.OS === 'ios' ? (
          <Text variant="body" weight={600} style={{ textAlign: 'center' }}>
            {t('update.hint_store')}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
