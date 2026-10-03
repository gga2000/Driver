import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { MIcon } from './MIcon';
import { Page } from './Page';

/**
 * Spec: "roles gate money views". Staff never see the Money tab or the staff tile, but a deep link
 * still lands somewhere friendly instead of a FORBIDDEN error.
 */
export function OwnerOnly({ title, back, testID }: { title: string; back?: boolean; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Page title={title} back={back} testID={testID}>
      <View style={{ alignItems: 'center', gap: theme.space[4], paddingTop: theme.space[10] }}>
        <View style={{ width: 88, height: 88, borderRadius: 28, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <MIcon name="shield" size={40} color="textMuted" strokeWidth={1.6} />
        </View>
        <View style={{ alignItems: 'center', gap: theme.space[1], maxWidth: 420 }}>
          <Text variant="title" align="center">
            {t('merchant.owner_only.title')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {t('merchant.owner_only.body')}
          </Text>
        </View>
        <Button label={t('merchant.placeholder.back')} variant="secondary" icon="receipt" onPress={() => router.navigate('/')} style={{ alignSelf: 'center' }} />
      </View>
    </Page>
  );
}
