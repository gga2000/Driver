import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, Icon, ModalSheet, QueryBoundary, Skeleton, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { currentFix, locationDeniedToast, locationWeakToast, type Fix } from '@/features/account/device';
import { distanceText, judgeDistance, judgeHereFix } from '@/features/account/place-fix';
import { useConfirmPlace, useHousehold, useMyPlaces, useRemovePlace, useUpdatePlace } from '@/features/account/queries';
import { PlaceEditor, toSaveInput, type PlaceEditorValue } from '@/features/account/PlaceEditor';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/**
 * Edit a saved place: everything the add form has, plus "موقعي هنا" (the owner at the door
 * confirms the pin with the phone's GPS → "موقعك مؤكد ✓") and remove. Household places shared by
 * someone else open read-only.
 */
export default function EditPlace() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const places = useMyPlaces();
  const household = useHousehold();
  const place = places.data?.find((p) => p.id === id) ?? null;
  const [value, setValue] = useState<PlaceEditorValue | null>(null);
  const update = useUpdatePlace();
  const remove = useRemovePlace();
  const confirm = useConfirmPlace();
  const [locating, setLocating] = useState(false);
  /** A good fix far from the saved pin, waiting for «إي، هنا البيت». */
  const [farFix, setFarFix] = useState<Fix | null>(null);

  useEffect(() => {
    if (place && !value) {
      setValue({ label: place.label, name: place.name, pin: place.pin, zoneId: place.zoneId, note: place.note ?? '', photos: place.photos, shareWithHousehold: place.sharedWithHousehold, entrance: place.entrance, landmarkId: place.landmark?.id ?? null });
    }
  }, [place, value]);

  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });

  // W8: a list that failed to load is not "this place is gone": it says why, with a retry.
  if (places.data === undefined) {
    return (
      <Screen edges={['bottom']}>
        <QueryBoundary query={places} locale={locale} testID="place-edit-state" skeleton={<Skeleton height={300} />}>
          {() => null}
        </QueryBoundary>
      </Screen>
    );
  }
  if (!place || !value) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState icon="map-pin" title={t('place.not_found')} action={{ label: t('action.back'), onPress: () => router.back() }} />
      </Screen>
    );
  }

  const readOnly = place.access === 'household';
  const input = toSaveInput(value, t);

  const save = async () => {
    if (!input) return;
    const moved = value.pin && (value.pin.lat !== place.pin.lat || value.pin.lng !== place.pin.lng);
    try {
      await update.mutateAsync({
        placeId: place.id,
        label: input.label,
        name: input.name,
        note: value.note.trim() || null,
        photoIds: input.photoIds,
        shareWithHousehold: value.shareWithHousehold,
        entrance: value.entrance,
        // Only a changed landmark is sent: an untouched one is the server's, which forgets it by
        // itself when the pin moves far (maps program a2).
        ...(value.landmarkId !== (place.landmark?.id ?? null) ? { landmarkId: value.landmarkId } : {}),
        ...(moved && value.pin ? { pin: value.pin } : {}),
      });
      toast.show({ message: t('place.saved'), tone: 'success' });
      router.back();
    } catch (err) {
      fail(err);
    }
  };

  const sendHere = async (fix: Fix) => {
    try {
      const next = await confirm.mutateAsync({ placeId: place.id, pin: fix.pin, ...(fix.accuracyM !== null ? { accuracyM: fix.accuracyM } : {}) });
      setValue((v) => (v ? { ...v, pin: next.pin, zoneId: next.zoneId } : v));
      toast.show({ message: t('place.confirmed_toast'), tone: 'success' });
    } catch (err) {
      fail(err);
    }
  };

  const confirmHere = async () => {
    setLocating(true);
    const fix = await currentFix();
    setLocating(false);
    if (fix === 'denied') return toast.show({ ...locationDeniedToast(t), placement: 'top' });
    if (!fix) return toast.show({ ...locationWeakToast(t), placement: 'top' });
    // A rough fix never becomes the door; a fix far from home asks first (HUNT-04, FLOW-21).
    const verdict = judgeHereFix(fix, place.pin);
    if (verdict.kind === 'rough') {
      return toast.show({ message: verdict.accuracyM === null ? t('place.fix_unknown') : t('place.fix_rough', { m: Math.round(verdict.accuracyM) }), tone: 'warning' }, 6000);
    }
    if (verdict.kind === 'far') return setFarFix(fix);
    await sendHere(fix);
  };

  const removePlace = async () => {
    try {
      await remove.mutateAsync({ placeId: place.id });
      router.back();
    } catch (err) {
      fail(err);
    }
  };

  return (
    <Screen
      edges={['bottom']}
      testID="place-edit"
      footer={readOnly ? undefined : <Button testID="place-save" label={t('action.save')} size="lg" fullWidth disabled={!input} loading={update.isPending} onPress={() => void save()} />}
    >
      <Stack.Screen options={{ title: place.name }} />
      <Card padding={4} tone={place.confirmed ? 'tint' : 'surface'}>
        <View style={{ gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3] }}>
            <Text variant="title">{place.confirmed ? t('place.confirmed_title') : t('place.unconfirmed_title')}</Text>
            {place.confirmed ? <StatusPill size="sm" tone="success" label={t('place.confirmed_badge')} /> : <StatusPill size="sm" tone="warning" label={t('place.unconfirmed_badge')} />}
          </View>
          <Text variant="footnote" color="textMuted">
            {place.confirmed ? t('place.confirmed_body') : t('place.unconfirmed_body')}
          </Text>
          {/* Maps program a3: couriers' arrivals agree on the door; the next courier goes straight to it. */}
          {place.doorConfirmed ? (
            <View testID="place-door-confirmed" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
              <Icon name="check" size={18} color="successText" />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" weight={600}>
                  {t('place.door_confirmed')}
                </Text>
                <Text variant="footnote" color="textMuted">
                  {t('place.door_confirmed_body')}
                </Text>
              </View>
            </View>
          ) : null}
          {readOnly ? null : (
            <Button testID="place-confirm" variant={place.confirmed ? 'secondary' : 'primary'} icon="location-arrow" label={t('place.im_here')} loading={locating || confirm.isPending} onPress={() => void confirmHere()} />
          )}
        </View>
      </Card>

      {readOnly ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="user" size={18} color="textMuted" />
          <Text variant="footnote" color="textMuted">
            {t('place.shared_by_household')}
          </Text>
        </View>
      ) : (
        <>
          <PlaceEditor value={value} onChange={setValue} canShare={Boolean(household.data)} />
          <Button testID="place-remove" variant="destructive" label={t('account.remove_place')} loading={remove.isPending} onPress={() => void removePlace()} />
        </>
      )}
      <ModalSheet
        visible={farFix !== null}
        onClose={() => setFarFix(null)}
        title={t('place.far_title')}
        testID="place-far"
        footer={
          <View style={{ gap: theme.space[2] }}>
            <Button
              testID="place-far-move"
              label={t('place.far_move')}
              size="lg"
              fullWidth
              loading={confirm.isPending}
              onPress={() => {
                const fix = farFix;
                setFarFix(null);
                if (fix) void sendHere(fix);
              }}
            />
            <Button testID="place-far-keep" variant="secondary" label={t('place.far_keep')} size="lg" fullWidth onPress={() => setFarFix(null)} />
          </View>
        }
      >
        <Text color="textMuted">{farFix ? t('place.far_body', { distance: distanceText(judgeDistance(farFix.pin, place.pin), t), name: place.name }) : ''}</Text>
      </ModalSheet>
    </Screen>
  );
}
