import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { Wordmark } from '@/components/Wordmark';
import { useApi } from '@/lib/api';
import { SUPPORT_PHONE } from '@/lib/env';
import { useT } from '@/lib/i18n';
import { session } from '@/lib/session';

/**
 * Signed in, but this number holds no merchant role on any store: a friendly gate (not an error),
 * with the two ways forward — the owner adds them under Staff, or Driver activates the store.
 */
export default function NotActivated() {
  const theme = useTheme();
  const t = useT();
  const api = useApi();
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  return (
    <SafeAreaView testID="not-activated" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space[6], gap: theme.space[6] }}>
        <Wordmark size="md" />
        <View style={{ width: 120, height: 120, borderRadius: 40, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-6deg' }] }}>
          <View style={{ transform: [{ rotate: '6deg' }] }}>
            <MIcon name="store" size={56} color="accentText" strokeWidth={1.5} />
          </View>
        </View>
        <View style={{ gap: theme.space[2], maxWidth: 460 }}>
          <Text variant="heading" align="center">
            {t('merchant.gate.title')}
          </Text>
          <Text variant="body" color="textMuted" align="center" style={{ fontSize: 16, lineHeight: 28 }}>
            {t('merchant.gate.body')}
          </Text>
        </View>
        <View style={{ gap: theme.space[2], width: '100%', maxWidth: 400 }}>
          <Button testID="gate-call" label={t('merchant.gate.call')} icon="phone" size="lg" fullWidth onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
          <Button
            testID="gate-retry"
            label={t('merchant.gate.retry')}
            variant="secondary"
            size="lg"
            fullWidth
            loading={checking}
            onPress={() => {
              setChecking(true);
              void qc.invalidateQueries(api.merchant.myStores.pathFilter()).finally(() => setChecking(false));
            }}
          />
          <Button label={t('merchant.gate.other_number')} variant="ghost" onPress={() => void session.signOut()} style={{ alignSelf: 'center' }} />
        </View>
      </View>
    </SafeAreaView>
  );
}
