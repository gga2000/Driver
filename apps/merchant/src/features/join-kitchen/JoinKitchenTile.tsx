import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { LatLng } from '@driver/contracts';
import { Button, ModalSheet, Text, TextField, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { CITY_CENTRE } from './door';
import { DoorMap } from './DoorMap';
import { useApplyKitchen, useMyKitchenApplication } from './queries';

const CITY_ID = 'aziziyah';
const MAP_HEIGHT = 220;

/**
 * أكل بيت: «سجّل مطبخك» on the gate (no store yet). A cook asks to open a home kitchen here: its
 * name, her own name (staff only) and her door. The form is a sheet, not a route, because every route
 * leads back to the gate until she works at a store. Once staff approve, her kitchen opens in «أكلاتي».
 */
export function JoinKitchenTile({ hidden }: { hidden?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const mine = useMyKitchenApplication();
  const [open, setOpen] = useState(false);
  if (hidden || !mine.data) return null;
  const pom = theme.services.home;
  const app = mine.data;
  const waiting = app.state === 'submitted';
  const rejected = app.state === 'rejected';
  // Approved: her stores are about to load and the gate gives way to her kitchen.
  if (app.state === 'active') return null;

  const title = waiting ? t('merchant.join_kitchen.waiting_title', { name: app.kitchenName ?? '' }) : rejected ? t('merchant.join_kitchen.rejected_title') : t('merchant.join_kitchen.tile_title');
  const body = waiting ? t('merchant.join_kitchen.waiting_body') : rejected ? (app.rejectReason ?? t('merchant.join_kitchen.rejected_body')) : t('merchant.join_kitchen.tile_body');
  return (
    <View style={{ width: '100%', maxWidth: 460 }}>
      <Pressable
        testID="join-kitchen-tile"
        accessibilityRole={waiting ? undefined : 'button'}
        disabled={waiting}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[4],
          padding: theme.space[4],
          borderRadius: theme.radius.xl,
          backgroundColor: pom.card.bg,
          borderWidth: 1,
          borderColor: pom.card.dot + '33',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: pom.fill, alignItems: 'center', justifyContent: 'center' }}>
          <MIcon name={waiting ? 'clock' : 'utensils'} size={26} color={pom.on} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title" style={{ color: pom.card.on }}>
            {title}
          </Text>
          <Text variant="body" style={{ color: pom.card.sub }}>
            {body}
          </Text>
        </View>
        {waiting ? null : <MIcon name="chevron-forward" size={22} color={pom.card.dot} />}
      </Pressable>
      {open ? <JoinKitchenSheet onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

function JoinKitchenSheet({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const apply = useApplyKitchen();
  const [kitchenName, setKitchenName] = useState('');
  const [cookName, setCookName] = useState('');
  const [door, setDoor] = useState<LatLng | null>(null);
  const [noMap, setNoMap] = useState(false);
  const [landmark, setLandmark] = useState('');
  const [tried, setTried] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const pom = theme.services.home;

  const nameOk = kitchenName.trim().length >= 2;
  const cookOk = cookName.trim().length >= 1;
  const doorOk = noMap ? landmark.trim().length >= 2 : door !== null;
  const send = async () => {
    setTried(true);
    setFailed(null);
    if (!nameOk || !cookOk || !doorOk) return;
    try {
      await apply.mutateAsync({
        cityId: CITY_ID,
        kitchenName: kitchenName.trim(),
        cookName: cookName.trim(),
        door: door ?? CITY_CENTRE,
        ...(landmark.trim() ? { landmark: landmark.trim() } : {}),
      });
      onClose();
    } catch (err) {
      setFailed(apiErrorMessage(err, t('merchant.common.error'), locale));
    }
  };

  return (
    <ModalSheet
      visible
      onClose={onClose}
      locked={apply.isPending}
      size="md"
      testID="join-kitchen-sheet"
      title={t('merchant.join_kitchen.title')}
      subtitle={t('merchant.join_kitchen.subtitle')}
      footer={
        <View style={{ gap: theme.space[2] }}>
          {failed ? (
            <Text variant="body" color="danger" align="center" testID="join-kitchen-error">
              {failed}
            </Text>
          ) : null}
          <Button testID="join-kitchen-send" label={t('merchant.join_kitchen.send')} icon="arrow-forward" size="lg" fullWidth loading={apply.isPending} onPress={() => void send()} />
        </View>
      }
    >
      <View style={{ gap: theme.space[5] }}>
        <View style={{ gap: theme.space[3] }}>
          <TextField
            testID="join-kitchen-name"
            label={t('merchant.join_kitchen.kitchen_name')}
            placeholder={t('merchant.join_kitchen.kitchen_name_placeholder')}
            hint={t('merchant.join_kitchen.kitchen_name_hint')}
            value={kitchenName}
            onChangeText={setKitchenName}
            maxLength={40}
            error={tried && !nameOk ? t('merchant.join_kitchen.kitchen_name_missing') : undefined}
          />
          <TextField
            testID="join-kitchen-cook"
            label={t('merchant.join_kitchen.cook_name')}
            hint={t('merchant.join_kitchen.cook_name_hint')}
            value={cookName}
            onChangeText={setCookName}
            maxLength={40}
            error={tried && !cookOk ? t('merchant.join_kitchen.cook_name_missing') : undefined}
          />
        </View>

        <View style={{ gap: theme.space[2] }}>
          <Text variant="label">{t('merchant.join_kitchen.door')}</Text>
          {noMap ? null : (
            <>
              <Text variant="caption" color="textMuted">
                {t('merchant.join_kitchen.door_hint')}
              </Text>
              <DoorMap value={door} onChange={setDoor} onUnavailable={() => setNoMap(true)} height={MAP_HEIGHT} />
              {tried && !doorOk ? (
                <Text variant="caption" color="danger">
                  {t('merchant.join_kitchen.door_missing')}
                </Text>
              ) : null}
            </>
          )}
          <TextField
            testID="join-kitchen-landmark"
            label={noMap ? undefined : t('merchant.join_kitchen.landmark')}
            placeholder={t('merchant.join_kitchen.landmark_placeholder')}
            value={landmark}
            onChangeText={setLandmark}
            maxLength={80}
            error={tried && noMap && !doorOk ? t('merchant.join_kitchen.landmark_missing') : undefined}
          />
        </View>

        <View style={{ flexDirection: 'row', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }} testID="join-kitchen-privacy">
          <MIcon name="lock" size={20} color="textMuted" />
          <Text variant="body" color="textMuted" style={{ flex: 1 }}>
            {t('merchant.join_kitchen.privacy')}
          </Text>
        </View>

        <View style={{ gap: theme.space[3] }}>
          <Text variant="label">{t('merchant.join_kitchen.next_title')}</Text>
          {(['next_1', 'next_2', 'next_3'] as const).map((k, i) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: pom.card.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="label" style={{ color: pom.card.dot }}>
                  {String(i + 1)}
                </Text>
              </View>
              <Text variant="body" style={{ flex: 1 }}>
                {t(`merchant.join_kitchen.${k}`)}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </ModalSheet>
  );
}
