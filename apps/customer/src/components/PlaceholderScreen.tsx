import { router, Stack } from 'expo-router';
import { View } from 'react-native';
import { EmptyState, StatusPill, Text, useTheme, type IconName } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { Screen } from './Screen';

/**
 * Route stub so navigation works end to end before a flow is built. Later milestones replace
 * the route file (e.g. app/restaurant/[id].tsx) with the real screen; nothing else links here.
 */
export function PlaceholderScreen({ title, icon, detail }: { title: string; icon: IconName; detail?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title }} />
      <View style={{ gap: theme.space[2], alignItems: 'center', paddingTop: theme.space[8] }}>
        {detail ? <StatusPill label={detail} tone="neutral" size="sm" style={{ alignSelf: 'center' }} /> : null}
        <EmptyState
          icon={icon}
          title={t('shell.stub_title')}
          body={t('shell.stub_body')}
          action={{ label: t('shell.back_home'), onPress: () => (router.canDismiss() ? router.dismissAll() : router.replace('/')) }}
        />
        <Text variant="caption" color="textMuted" align="center">
          {title}
        </Text>
      </View>
    </Screen>
  );
}
