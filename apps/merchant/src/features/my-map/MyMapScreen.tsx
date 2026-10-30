import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import type { LatLng } from '@driver/contracts';
import { Button, EmptyState, Icon, SegmentedControl, Skeleton, Text, TextField, useNetwork, useTheme } from '@driver/ui';
import { Page } from '@/components/Page';
import { useDeliveryArea } from '@/features/area/queries';
import { DoorMap } from '@/features/join-kitchen/DoorMap';
import { Panel } from '@/features/menu/parts';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useLocale, useT, type TKey } from '@/lib/i18n';
import { useCounterToast } from '@/lib/toast';
import { blockerOf, NAME_MAX, NOTE_MAX, toReportInput, type MyMapBlocker, type MyMapKind } from './logic';
import { useReportMyMap } from './queries';

const MAP_HEIGHT = 260;
const NOTE_HEIGHT = 88;

const BLOCKER_TEXT: Partial<Record<MyMapBlocker, TKey>> = {
  move_more: 'merchant.my_map.move_more',
  no_map: 'merchant.my_map.no_map',
  name_same: 'merchant.my_map.name_same',
};

/**
 * «مكاني على الخريطة»: the shop sees its pin, the door couriers are sent to, and tells our team when
 * it moved (she drags the map under the fixed pin to the new door) or when its name on the map is
 * wrong. It goes to the Console's map inbox; the map changes once the team checks it. Owners and
 * staff both may send.
 */
export function MyMapScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const net = useNetwork();
  const online = useRef(net.online);
  online.current = net.online;
  const { store } = useCurrentStore();
  const orgId = store?.orgId ?? null;
  const area = useDeliveryArea(orgId);
  const report = useReportMyMap();
  const [kind, setKind] = useState<MyMapKind>('moved');
  const [pin, setPin] = useState<LatLng | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [noMap, setNoMap] = useState(false);
  const mapGone = useCallback(() => setNoMap(true), []);

  if (!store || !area.data) {
    return (
      <Page title={t('merchant.my_map.title')} back testID="my-map" maxWidth={720}>
        {area.isError ? (
          <EmptyState icon="x" title={t('merchant.my_map.load_failed')} action={{ label: t('merchant.menu.retry'), onPress: () => void area.refetch() }} />
        ) : (
          <View style={{ gap: theme.space[4] }}>
            <Skeleton height={44} radius={theme.radius.lg} />
            <Skeleton height={MAP_HEIGHT} radius={theme.radius.xl} />
          </View>
        )}
      </Page>
    );
  }

  const current = area.data.kitchen?.pin ?? null;
  const draft = { kind, pin, name, note };
  const blocker = blockerOf(draft, { current, storeName: store.name, mapOk: !noMap });
  const blockerKey = blocker ? BLOCKER_TEXT[blocker] : undefined;

  const send = async () => {
    try {
      await report.mutateAsync(toReportInput(store.orgId, draft));
      toast.show({ message: t('merchant.my_map.sent'), tone: 'success' });
      if (router.canGoBack()) router.back();
      else router.replace('/more');
    } catch (err) {
      const code = apiErrorCode(err);
      const message = code === 'map_reports_limit' ? t('merchant.my_map.limit') : !code && !online.current ? t('merchant.my_map.offline') : apiErrorMessage(err, t('merchant.common.error'), locale);
      toast.show({ message, tone: code === 'map_reports_limit' ? 'warning' : 'danger' });
    }
  };

  return (
    <Page title={t('merchant.my_map.title')} back testID="my-map" maxWidth={720}>
      <Text variant="body" color="textMuted">
        {t('merchant.my_map.intro')}
      </Text>
      <SegmentedControl
        testIDPrefix="my-map-kind"
        accessibilityLabel={t('merchant.my_map.kind_label')}
        options={[
          { value: 'moved', label: t('merchant.my_map.moved') },
          { value: 'wrong_name', label: t('merchant.my_map.wrong_name') },
        ]}
        value={kind}
        onChange={setKind}
      />

      <Panel testID="my-map-panel">
        {kind === 'moved' ? (
          noMap ? (
            <View testID="my-map-no-map" style={{ flexDirection: 'row', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
              <Icon name="map-pin" size={20} color="textMuted" />
              <Text variant="body" color="textMuted" style={{ flex: 1 }}>
                {t('merchant.my_map.no_map')}
              </Text>
            </View>
          ) : (
            <>
              <Text variant="label" color="textMuted">
                {t(current ? 'merchant.my_map.move_hint' : 'merchant.my_map.no_pin')}
              </Text>
              <DoorMap value={pin ?? current} onChange={setPin} onUnavailable={mapGone} height={MAP_HEIGHT} />
            </>
          )
        ) : (
          <TextField testID="my-map-name" label={t('merchant.my_map.name_label')} placeholder={store.name} value={name} onChangeText={setName} maxLength={NAME_MAX} />
        )}
        <TextField
          testID="my-map-note"
          label={t('merchant.my_map.note_label')}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={NOTE_MAX}
          hint={t('merchant.my_map.note_hint')}
          style={{ minHeight: NOTE_HEIGHT }}
        />
      </Panel>

      {!net.online ? (
        <View testID="my-map-offline" style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center' }}>
          <Icon name="wifi-off" size={18} color="textMuted" />
          <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {t('merchant.my_map.offline')}
          </Text>
        </View>
      ) : blockerKey && blocker !== 'no_map' ? (
        <Text variant="footnote" color="textMuted" align="center" testID="my-map-blocker">
          {t(blockerKey)}
        </Text>
      ) : null}
      <Button testID="my-map-send" size="lg" fullWidth label={t('merchant.my_map.send')} icon="send" disabled={blocker !== null || !net.online} loading={report.isPending} onPress={() => void send()} />
    </Page>
  );
}
