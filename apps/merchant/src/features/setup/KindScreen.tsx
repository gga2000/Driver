import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { FOOD_DOORS, prepDefaultsFor, type FoodDoor } from '@driver/contracts';
import { Button, Skeleton, Text, useTheme } from '@driver/ui';
import { Loadable } from '@/components/Loadable';
import { MIcon } from '@/components/MIcon';
import { Page } from '@/components/Page';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { COUNTER } from '@/lib/counter';
import { useLocale, useT, type TKey } from '@/lib/i18n';
import { useCounterToast } from '@/lib/toast';
import { DoorTile } from './DoorChip';
import { doorsOf, toggleDoor } from './logic';
import { useSetup, useSetupActions } from './queries';

/**
 * «شنو تبيع؟» (k1, k2): the customer app's four doors; field ops picked, he confirms with «صح» and may
 * pick more than one. His pick places the shop behind the right door, sets the app's words («محلك»,
 * «مشروب» for a café) and a drinks-only shop starts with quicker prep.
 */
export function KindScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const { store } = useCurrentStore();
  const setup = useSetup(store?.orgId ?? null);
  const { confirmKinds } = useSetupActions();
  const [picked, setPicked] = useState<FoodDoor[] | null>(null);

  const save = async (merchantOrgId: string, kinds: FoodDoor[]) => {
    try {
      await confirmKinds.mutateAsync({ merchantOrgId, kinds });
      theme.haptic('success');
      toast.show({ message: t('merchant.setup.kind_saved'), tone: 'success', icon: 'check' });
      if (router.canGoBack()) router.back();
      else router.replace('/setup');
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };

  return (
    <Page title={t('merchant.setup.kind_title')} back testID="setup-kind" maxWidth={640}>
      <Loadable query={setup} stale={false} skeleton={<Skeleton height={360} radius={theme.radius.xl} />} failed={t('merchant.setup.load_failed')} testID="setup-kind">
        {(view) => {
          const current = picked ?? doorsOf(view);
          const suggested = view.kinds.suggested.map((d) => t(`merchant.setup.door_${d}` as TKey)).join(' · ');
          const quick = prepDefaultsFor(current);
          return (
            <View style={{ gap: theme.space[4] }}>
              <Text variant="body" color="textMuted">
                {view.kinds.confirmed ? t('merchant.setup.kind_body_again') : t('merchant.setup.kind_body', { kinds: suggested })}
              </Text>
              <View style={{ gap: theme.space[3] }}>
                {FOOD_DOORS.map((d) => (
                  <DoorTile key={d} door={d} selected={current.includes(d)} onPress={() => setPicked(toggleDoor(current, d))} />
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: COUNTER.sand }}>
                <MIcon name="bulb" size={18} color={COUNTER.date} />
                <Text variant="footnote" weight={600} style={{ flex: 1, color: COUNTER.date }}>
                  {quick ? t('merchant.setup.kind_note_drinks', { minutes: quick.storeMinutes }) : t('merchant.setup.kind_note')}
                </Text>
              </View>
              <Button testID="setup-kind-ok" label={t('merchant.setup.yes')} icon="check" size="lg" fullWidth disabled={current.length === 0} loading={confirmKinds.isPending} onPress={() => void save(view.merchantOrgId, current)} />
              {current.length === 0 ? (
                <Text variant="footnote" color="textMuted" align="center">
                  {t('merchant.setup.kind_pick_one')}
                </Text>
              ) : null}
            </View>
          );
        }}
      </Loadable>
    </Page>
  );
}
