import { useState } from 'react';
import { ActivityIndicator, Image, Platform, View } from 'react-native';
import { PICKUP_SPOT_RULES, pickupDraft, type PickupDraft } from '@driver/contracts';
import { Button, EmptyState, Skeleton, Text, TextField, useTheme } from '@driver/ui';
import { useCounterToast } from '@/lib/toast';
import { Page } from '@/components/Page';
import { Glyph } from '@/features/menu/Glyph';
import { GlyphButton, Panel, PanelTitle } from '@/features/menu/parts';
import { absoluteUrl, pickPhotos, type PhotoSource } from '@/features/menu/photo';
import { usePhotoUpload } from '@/features/menu/queries';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { usePickupSpot, useSavePickupSpot } from './queries';

/** Note box height: about three lines, enough for «الاستلام من الشباك اليسار، جنب باب المطبخ». */
const NOTE_HEIGHT = 96;

/**
 * مكان الاستلام (maps program r7): where couriers collect this store's orders — up to 2 photos (the
 * window, the side door) and a short note. The courier sees them on the pickup stop of his job until
 * he has the food, so he doesn't walk into the dining room asking. Owners edit; staff see the same,
 * read-only. A picked photo uploads straight away (signed ticket + PUT); nothing reaches couriers
 * until «احفظ».
 */
export function PickupSpotScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const { store } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const spot = usePickupSpot(storeId);
  const save = useSavePickupSpot();
  const upload = usePhotoUpload();
  const [draft, setDraft] = useState<PickupDraft | null>(null);
  const [uploading, setUploading] = useState(false);

  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });

  if (!spot.data) {
    return (
      <Page title={t('merchant.pickup.title')} back testID="pickup-spot" maxWidth={720}>
        {spot.isError ? (
          <EmptyState icon="x" title={t('merchant.pickup.load_failed')} action={{ label: t('merchant.menu.retry'), onPress: () => void spot.refetch() }} />
        ) : (
          <View style={{ gap: theme.space[4] }}>
            <Skeleton height={220} radius={theme.radius.xl} />
            <Skeleton height={140} radius={theme.radius.xl} />
          </View>
        )}
      </Page>
    );
  }

  const view = spot.data;
  const base = pickupDraft.from(view);
  const current = draft ?? base;
  const editable = view.canEdit;
  const dirty = !pickupDraft.same(current, base);
  const change = (next: PickupDraft) => setDraft(next);

  const choose = async (source: PhotoSource) => {
    const picked = await pickPhotos(source);
    if (picked === 'denied') {
      toast.show({ message: t('merchant.item.photo_denied'), tone: 'warning' });
      return;
    }
    const photo = picked?.[0];
    if (!photo) return;
    setUploading(true);
    try {
      const id = await upload(photo);
      // The local file shows until the save returns the signed link.
      setDraft((d) => pickupDraft.addPhoto(d ?? base, { id, url: photo.uri }));
    } catch (err) {
      fail(err);
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!storeId) return;
    try {
      await save.mutateAsync(pickupDraft.toInput(storeId, current));
      setDraft(null);
      toast.show({ message: t('merchant.pickup.saved'), tone: 'success' });
    } catch (err) {
      fail(err);
    }
  };

  const photoTiles = current.photos.map((p, i) => (
    <View key={p.id} testID={`pickup-photo-${i}`} style={{ flexBasis: '45%', flexGrow: 1, aspectRatio: 4 / 3, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
      <Image source={{ uri: absoluteUrl(p.url) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityLabel={t('merchant.pickup.photo_alt', { n: i + 1 })} accessibilityIgnoresInvertColors />
      {editable ? (
        <View style={{ position: 'absolute', top: theme.space[2], end: theme.space[2] }}>
          <GlyphButton glyph="trash" variant="outline" color="dangerText" label={t('merchant.pickup.photo_remove', { n: i + 1 })} testID={`pickup-photo-remove-${i}`} onPress={() => change(pickupDraft.removePhoto(current, p.id))} />
        </View>
      ) : null}
    </View>
  ));

  return (
    <Page title={t('merchant.pickup.title')} back testID="pickup-spot" maxWidth={720}>
      <Text variant="body" color="textMuted">
        {t('merchant.pickup.intro')}
      </Text>
      {!editable ? (
        <View testID="pickup-read-only" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], backgroundColor: theme.colors.infoTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
          <Glyph name="info" size={20} color="textMuted" strokeWidth={2} />
          <Text variant="label" color="textMuted" style={{ flex: 1 }}>
            {t('merchant.pickup.read_only')}
          </Text>
        </View>
      ) : null}

      <Panel testID="pickup-photos">
        <PanelTitle glyph="photo" title={t('merchant.pickup.photos')} hint={t('merchant.pickup.photos_hint')} />
        {current.photos.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3] }}>{photoTiles}</View>
        ) : (
          <View testID="pickup-photos-empty" style={{ alignItems: 'center', gap: theme.space[2], padding: theme.space[5], borderRadius: theme.radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.borderStrong }}>
            <Glyph name="camera" size={28} color="textMuted" strokeWidth={1.75} />
            <Text variant="label" color="textMuted" align="center" style={{ maxWidth: 360 }}>
              {editable ? t('merchant.pickup.photos_empty') : t('merchant.pickup.photos_empty_staff')}
            </Text>
          </View>
        )}
        {uploading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <ActivityIndicator color={theme.colors.textMuted} />
            <Text variant="caption" color="textMuted">
              {t('merchant.pickup.uploading')}
            </Text>
          </View>
        ) : null}
        {editable && pickupDraft.canAddPhoto(current) ? (
          <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
            <Button testID="pickup-photo-library" variant="secondary" label={t('merchant.pickup.photo_add')} trailing={<Glyph name="photo" size={18} strokeWidth={2} />} disabled={uploading} onPress={() => void choose('library')} style={{ flex: 1 }} />
            {Platform.OS !== 'web' ? <Button testID="pickup-photo-camera" variant="secondary" label={t('merchant.pickup.photo_camera')} trailing={<Glyph name="camera" size={18} strokeWidth={2} />} disabled={uploading} onPress={() => void choose('camera')} style={{ flex: 1 }} /> : null}
          </View>
        ) : editable ? (
          <Text variant="caption" color="textMuted" testID="pickup-photos-full">
            {t('merchant.pickup.photos_full')}
          </Text>
        ) : null}
      </Panel>

      <Panel testID="pickup-note">
        <PanelTitle glyph="pencil" title={t('merchant.pickup.note')} />
        {editable ? (
          <TextField
            testID="pickup-note-input"
            value={current.note}
            onChangeText={(v) => change(pickupDraft.withNote(current, v))}
            placeholder={t('merchant.pickup.note_placeholder')}
            multiline
            maxLength={PICKUP_SPOT_RULES.noteMaxChars}
            hint={t('merchant.pickup.note_left', { count: pickupDraft.noteLeft(current) })}
            style={{ minHeight: NOTE_HEIGHT }}
          />
        ) : (
          <Text variant="body" color={current.note ? 'text' : 'textMuted'}>
            {current.note || t('merchant.pickup.note_none')}
          </Text>
        )}
      </Panel>

      {editable ? (
        <Button testID="pickup-save" size="lg" fullWidth label={t('merchant.pickup.save')} disabled={!dirty || uploading} loading={save.isPending} onPress={() => void submit()} />
      ) : null}
    </Page>
  );
}
