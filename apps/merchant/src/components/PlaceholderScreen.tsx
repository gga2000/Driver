import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Text, useTheme } from '@driver/ui';
import { useT, type TKey } from '@/lib/i18n';
import { MIcon, type MIconName } from './MIcon';
import { Page } from './Page';

/**
 * Route stub so navigation works end to end before a section is built. Wave 2 replaces the route
 * file's contents (app/menu/index.tsx, app/money/index.tsx, app/insights.tsx, app/deals/index.tsx,
 * app/staff/index.tsx) with the real screen; nothing else links here.
 */
export function PlaceholderScreen({ title, icon, back = false, testID }: { title: TKey; icon: MIconName; back?: boolean; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Page title={t(title)} back={back} testID={testID}>
      <View style={{ alignItems: 'center', gap: theme.space[4], paddingTop: theme.space[10] }}>
        <View
          style={{
            width: 88,
            height: 88,
            borderRadius: 28,
            backgroundColor: theme.colors.accentTint,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ rotate: '-6deg' }],
          }}
        >
          <View style={{ transform: [{ rotate: '6deg' }] }}>
            <MIcon name={icon} size={40} color="accentText" strokeWidth={1.6} />
          </View>
        </View>
        <View style={{ alignItems: 'center', gap: theme.space[1], maxWidth: 420 }}>
          <Text variant="title" align="center">
            {t('merchant.placeholder.title')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {t('merchant.placeholder.body')}
          </Text>
        </View>
        <Button label={t('merchant.placeholder.back')} variant="secondary" icon="receipt" onPress={() => router.navigate('/')} style={{ alignSelf: 'center' }} />
      </View>
    </Page>
  );
}
