import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, View } from 'react-native';
import type { MenuPhotoDish, MenuPhotoRequestView } from '@driver/contracts';
import { Button, Card, Chip, EmptyState, Icon, Skeleton, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/features/fleet/FleetParts';
import { canHandOver, shootProgress, VISIT_KEY, visitChoices } from '@/features/ops/logic';
import { RequestCard, useVisitLabel } from '@/features/ops/MenuPhotoParts';
import { absoluteUrl, pickPhotos, uploadPhoto, type PhotoSource } from '@/features/ops/photos';
import { useMenuPhotoActions, useMenuPhotoRequest } from '@/features/ops/queries';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/** Photo tiles on a dish row: today's photo and the one just taken. */
const TILE = 72;

/**
 * One restaurant's menu shoot (maps program k3): set or move the visit with one tap, then per dish
 * take the photo (camera on a phone, the file picker on the web) or pick one from the album; a second
 * photo of a dish replaces the first. «سلّم الصور» hands them to the owner, who accepts or rejects
 * each in the Merchant app. Someone else's visit is read only.
 */
export default function OpsMenuShoot() {
  const theme = useTheme();
  const t = useT();
  const { requestId } = useLocalSearchParams<{ requestId?: string }>();
  const req = useMenuPhotoRequest(requestId ?? null);

  if (!req.data) {
    return (
      <Screen edges={['bottom']} testID="ops-menu-shoot">
        <Stack.Screen options={{ title: t('partner.ops_mp_title') }} />
        {req.isError ? <EmptyState icon="x" title={t('partner.ops_mp_load_failed')} action={{ label: t('partner.ops_mp_retry'), onPress: () => void req.refetch() }} /> : <Skeleton lines={6} />}
      </Screen>
    );
  }
  const view = req.data;
  const handedOver = view.state === 'shot' || view.state === 'done';

  return (
    <Screen edges={['bottom']} testID="ops-menu-shoot" footer={view.canAct ? <HandOver view={view} /> : undefined}>
      <Stack.Screen options={{ title: view.storeName }} />
      <RequestCard view={view} />
      {handedOver ? (
        <Card elevation={0} tone="tint" testID="ops-mp-handed-over">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <Icon name="check" size={22} color="successText" strokeWidth={2.4} />
            <Text variant="body" style={{ flex: 1 }}>
              {t('partner.ops_mp_handed_over_body')}
            </Text>
          </View>
        </Card>
      ) : null}
      {view.state === 'cancelled' ? (
        <Card elevation={0} tone="sunken">
          <Text variant="body">{t('partner.ops_mp_cancelled')}</Text>
        </Card>
      ) : null}
      {view.canAct ? <VisitPicker view={view} /> : null}
      <View style={{ gap: theme.space[2] }}>
        <SectionHeader title={t('partner.ops_mp_dishes_title', { shot: shootProgress(view).shot, total: shootProgress(view).total })} />
        {view.dishes.length === 0 ? (
          <Text variant="footnote" color="textMuted">
            {t('partner.ops_mp_no_dishes')}
          </Text>
        ) : (
          <Card elevation={1} padding={0}>
            {view.dishes.map((d, i) => (
              <DishRow key={d.itemId} view={view} dish={d} divider={i < view.dishes.length - 1} />
            ))}
          </Card>
        )}
      </View>
      {!view.canAct && !handedOver && view.state !== 'cancelled' ? (
        <Text variant="footnote" color="textMuted" align="center">
          {t('partner.ops_mp_read_only')}
        </Text>
      ) : null}
    </Screen>
  );
}

function VisitPicker({ view }: { view: MenuPhotoRequestView }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const visitLabel = useVisitLabel();
  const { schedule } = useMenuPhotoActions();
  const choices = visitChoices(new Date());

  const set = async (at: Date) => {
    try {
      await schedule.mutateAsync({ requestId: view.requestId, scheduledFor: at });
      toast.show({ tone: 'success', message: t('partner.ops_mp_visit_set', { when: visitLabel(at) }) });
    } catch (err) {
      toast.show({ tone: 'danger', message: apiErrorMessage(err, t('error.network'), locale) });
    }
  };

  return (
    <View style={{ gap: theme.space[2] }} testID="ops-mp-visit">
      <SectionHeader title={view.scheduledFor ? t('partner.ops_mp_move_visit') : t('partner.ops_mp_set_visit')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        {choices.map((c) => (
          <Chip key={c.key} testID={`ops-mp-visit-${c.key}`} role="button" label={t(VISIT_KEY[c.key], { time: visitLabel(c.at) })} disabled={schedule.isPending} onPress={() => void set(c.at)} />
        ))}
      </View>
    </View>
  );
}

function DishRow({ view, dish, divider }: { view: MenuPhotoRequestView; dish: MenuPhotoDish; divider: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const client = useApiClient();
  const { addShot } = useMenuPhotoActions();
  const [busy, setBusy] = useState(false);
  const editable = view.canAct && (view.state === 'requested' || view.state === 'scheduled');

  const shoot = async (source: PhotoSource) => {
    const picked = await pickPhotos(source);
    if (picked === 'denied') return toast.show({ tone: 'warning', message: t('error.camera_denied') });
    const photo = picked[0];
    if (!photo) return;
    setBusy(true);
    try {
      const uploadId = await uploadPhoto(photo, (input) => client.places.photoUpload.mutate(input));
      await addShot.mutateAsync({ requestId: view.requestId, itemId: dish.itemId, uploadId });
    } catch (err) {
      toast.show({ tone: 'danger', message: err instanceof Error && err.message.startsWith('upload') ? t('partner.ops_photo_failed') : apiErrorMessage(err, t('partner.ops_photo_failed'), locale) });
    } finally {
      setBusy(false);
    }
  };

  const tile = (url: string | null, label: string) => (
    <View style={{ alignItems: 'center', gap: 2 }}>
      {url ? (
        <Image source={{ uri: absoluteUrl(url) }} style={{ width: TILE, height: TILE, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSunken }} resizeMode="cover" accessibilityLabel={label} />
      ) : (
        <View style={{ width: TILE, height: TILE, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="caption" color="textMuted">
            {t('partner.ops_mp_no_photo')}
          </Text>
        </View>
      )}
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
    </View>
  );

  return (
    <View testID={`ops-mp-dish-${dish.itemId}`} style={{ gap: theme.space[2], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], borderBottomWidth: divider ? 1 : 0, borderBottomColor: theme.colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Text variant="label" weight={600} numberOfLines={2} style={{ flex: 1 }}>
          {dish.nameAr}
        </Text>
        {dish.shot?.state === 'accepted' ? <StatusPill size="sm" tone="success" label={t('partner.ops_mp_accepted')} /> : null}
        {dish.shot?.state === 'rejected' ? <StatusPill size="sm" tone="neutral" label={t('partner.ops_mp_rejected')} /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space[3] }}>
        {tile(dish.currentPhotoUrl, t('partner.ops_mp_current'))}
        {dish.shot ? tile(dish.shot.photoUrl, t('partner.ops_mp_new')) : null}
        {editable ? (
          <View style={{ flex: 1, gap: theme.space[2], alignItems: 'stretch' }}>
            <Button testID={`ops-mp-shoot-${dish.itemId}`} size="sm" label={dish.shot ? t('partner.photo_retake') : t('partner.ops_take_photo')} loading={busy} disabled={busy} onPress={() => void shoot('camera')} />
            <Button testID={`ops-mp-library-${dish.itemId}`} size="sm" variant="ghost" label={t('partner.ops_from_library')} disabled={busy} onPress={() => void shoot('library')} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function HandOver({ view }: { view: MenuPhotoRequestView }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { markShot } = useMenuPhotoActions();
  const { shot } = shootProgress(view);

  const send = async () => {
    try {
      await markShot.mutateAsync({ requestId: view.requestId });
      toast.show({ tone: 'success', message: t('partner.ops_mp_sent') });
      router.back();
    } catch (err) {
      toast.show({ tone: 'danger', message: apiErrorMessage(err, t('error.network'), locale) });
    }
  };

  return (
    <Button
      testID="ops-mp-hand-over"
      size="lg"
      fullWidth
      label={t('partner.ops_mp_hand_over', { n: shot })}
      disabled={!canHandOver(view)}
      loading={markShot.isPending}
      onPress={() => void send()}
    />
  );
}
