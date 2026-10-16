import { router, Stack } from 'expo-router';
import { View } from 'react-native';
import { EmptyState, SketchScene, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useT } from '@/lib/i18n';

/**
 * A link that leads nowhere (an old share link, a typo, a removed page): says so plainly and takes the
 * person home, instead of a "coming soon" stub (audit CORE-18).
 */
export default function NotFound() {
  const theme = useTheme();
  const t = useT();
  return (
    <Screen edges={['bottom']} testID="not-found">
      <Stack.Screen options={{ title: '' }} />
      <View style={{ paddingTop: theme.space[8] }}>
        <EmptyState
          icon="map-pin"
          art={<SketchScene name="door" />}
          title={t('not_found.title')}
          body={t('not_found.body')}
          action={{ label: t('shell.back_home'), onPress: () => (router.canDismiss() ? router.dismissAll() : router.replace('/')) }}
        />
      </View>
    </Screen>
  );
}
