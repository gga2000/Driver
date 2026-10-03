import { router, Stack } from 'expo-router';
import { View } from 'react-native';
import { EmptyState, StatusPill, useTheme, type IconName } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { Screen } from './Screen';

/**
 * Route stub for wave 2 (earnings, scorecard, documents, check-in, intercity, khat, fleet, ops).
 * Each placeholder route file renders only this; the agent building the flow replaces the file's
 * contents with the real screen — nothing else links to this component.
 */
export function PlaceholderScreen({ title, icon, detail, tab = false }: { title: string; icon: IconName; detail?: string; tab?: boolean }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Screen edges={tab ? ['top'] : ['bottom']}>
      {tab ? null : <Stack.Screen options={{ title }} />}
      <View style={{ gap: theme.space[3], alignItems: 'center', paddingTop: theme.space[10] }}>
        {detail ? <StatusPill label={detail} tone="neutral" size="sm" style={{ alignSelf: 'center' }} /> : null}
        <EmptyState
          icon={icon}
          title={tab ? title : t('partner.stub_title')}
          body={tab ? t('partner.earnings_soon') : t('partner.stub_body')}
          action={tab ? undefined : { label: t('partner.stub_back'), onPress: () => (router.canGoBack() ? router.back() : router.replace('/')) }}
        />
      </View>
    </Screen>
  );
}
