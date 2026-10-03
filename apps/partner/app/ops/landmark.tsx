import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { Button, Card, Chip, Icon, Skeleton, Text, TextField, useTheme, useToast } from '@driver/ui';
import { ChoiceCard } from '@/components/ChoiceCard';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/features/fleet/FleetParts';
import { addLocalName, photosKey, zoneOptions } from '@/features/ops/logic';
import { CameraGlyph } from '@/features/ops/OpsParts';
import { pickPhotos, uploadPhoto, type PickedPhoto } from '@/features/ops/photos';
import { useAddLandmarkPhoto, useLandmarks } from '@/features/ops/queries';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

const NEW = '__new__';

/**
 * صورة معلم — pick the area and the landmark (or name a new one), take the photo, add the names
 * drivers use, upload. The photo goes to the Console as a proposal (`landmark.proposed`).
 */
export default function OpsLandmark() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const client = useApiClient();
  const add = useAddLandmarkPhoto();
  const zones = zoneOptions(locale);
  const [zoneKey, setZone] = useState<string>('centre');
  const landmarks = useLandmarks(zoneKey);
  const [target, setTarget] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const list = landmarks.data ?? [];
  const isNew = target === NEW || (landmarks.data !== undefined && list.length === 0);
  const ready = !!photo && (isNew ? newName.trim().length >= 2 : !!target);

  const reset = () => {
    setSent(false);
    setTarget(null);
    setNewName('');
    setPhoto(null);
    setNames([]);
    setCaption('');
  };

  const pick = async (source: 'camera' | 'library') => {
    const res = await pickPhotos(source);
    if (res === 'denied') return toast.show({ tone: 'warning', message: t('error.camera_denied') });
    if (res[0]) setPhoto(res[0]);
  };

  const submit = async () => {
    if (!ready || !photo) return;
    setBusy(true);
    try {
      const uploadId = await uploadPhoto(photo, (input) => client.places.photoUpload.mutate(input));
      const localNames = isNew ? names.reduce(addLocalName, addLocalName([], newName)) : names;
      await add.mutateAsync({
        target: isNew ? { kind: 'landmark', id: `new:${zoneKey}` } : { kind: 'landmark', id: target! },
        uploadId,
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        localNames,
      });
      setSent(true);
    } catch (err) {
      toast.show({ tone: 'danger', message: err instanceof Error && err.message.startsWith('upload') ? t('partner.ops_photo_failed') : apiErrorMessage(err, t('partner.ops_photo_failed'), locale) });
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Screen
        edges={['bottom']}
        testID="ops-landmark-sent"
        footer={
          <View style={{ gap: theme.space[2] }}>
            <Button testID="ops-landmark-another" label={t('partner.ops_lm_another')} fullWidth size="lg" onPress={reset} />
            <Button label={t('partner.ops_back_home')} variant="ghost" fullWidth onPress={() => router.back()} />
          </View>
        }
      >
        <Stack.Screen options={{ title: t('partner.ops_lm_title') }} />
        <View style={{ alignItems: 'center', gap: theme.space[4], paddingTop: theme.space[8] }}>
          {photo ? <Image source={{ uri: photo.uri }} style={{ width: 220, height: 160, borderRadius: theme.radius.xl }} resizeMode="cover" /> : null}
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.successTint, alignItems: 'center', justifyContent: 'center', marginTop: -44, borderWidth: 4, borderColor: theme.colors.bg }}>
            <Icon name="check" size={28} color="successText" strokeWidth={2.6} />
          </View>
          <Text variant="heading" align="center">
            {t('partner.ops_lm_sent_title')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {t('partner.ops_lm_sent_body')}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      edges={['bottom']}
      testID="ops-landmark"
      footer={<Button testID="ops-landmark-submit" label={busy ? t('partner.ops_lm_uploading') : t('partner.ops_lm_submit')} fullWidth size="lg" disabled={!ready} loading={busy} onPress={() => void submit()} />}
    >
      <Stack.Screen options={{ title: t('partner.ops_lm_title') }} />

      <View style={{ gap: theme.space[2] }}>
        <SectionHeader title={t('partner.ops_lm_zone')} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2], paddingHorizontal: 2 }} style={{ marginHorizontal: -2 }}>
          {zones.map((z) => (
            <Chip
              key={z.id}
              testID={`ops-zone-${z.id}`}
              role="radio"
              selected={zoneKey === z.id}
              label={z.name}
              onPress={() => {
                setZone(z.id);
                setTarget(null);
              }}
            />
          ))}
        </ScrollView>
      </View>

      <View style={{ gap: theme.space[2] }}>
        <SectionHeader title={t('partner.ops_lm_pick')} />
        {!landmarks.data ? (
          <Skeleton lines={3} />
        ) : (
          <View style={{ gap: theme.space[2] }}>
            {list.length === 0 ? (
              <Text variant="footnote" color="textMuted">
                {t('partner.ops_lm_none')}
              </Text>
            ) : null}
            {list.map((l) => (
              <ChoiceCard
                key={l.placeId}
                testID={`ops-landmark-${l.placeId}`}
                icon="map-pin"
                title={l.name}
                subtitle={t(photosKey(l.photos), { n: l.photos })}
                selected={target === l.placeId}
                onPress={() => setTarget(l.placeId)}
              />
            ))}
            <ChoiceCard testID="ops-landmark-new" icon="plus" title={t('partner.ops_lm_new')} selected={isNew} onPress={() => setTarget(NEW)} />
            {isNew ? (
              <TextField testID="ops-landmark-new-name" label={t('partner.ops_lm_new_name')} placeholder={t('partner.ops_lm_new_hint')} value={newName} onChangeText={setNewName} />
            ) : null}
          </View>
        )}
      </View>

      <View style={{ gap: theme.space[2] }}>
        <SectionHeader title={t('partner.ops_lm_photo')} />
        {photo ? (
          <View style={{ borderRadius: theme.radius.xl, overflow: 'hidden' }}>
            <Image testID="ops-landmark-preview" source={{ uri: photo.uri }} style={{ width: '100%', aspectRatio: 4 / 3 }} resizeMode="cover" />
            <Pressable
              accessibilityRole="button"
              onPress={() => void pick('camera')}
              style={{ position: 'absolute', bottom: theme.space[3], start: theme.space[3], flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.surface, borderRadius: theme.radius.pill, paddingHorizontal: 14, height: 36 }}
            >
              <CameraGlyph size={18} />
              <Text variant="label" weight={600}>
                {t('partner.photo_retake')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <Card elevation={0} padding={0}>
            <Pressable testID="ops-landmark-camera" accessibilityRole="button" onPress={() => void pick('camera')} style={{ alignItems: 'center', justifyContent: 'center', gap: theme.space[2], paddingVertical: theme.space[8], borderWidth: 2, borderStyle: 'dashed', borderColor: theme.colors.borderStrong, borderRadius: theme.radius.lg, margin: -1 }}>
              <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                <CameraGlyph size={30} color="onAccent" />
              </View>
              <Text variant="bodyStrong">{t('partner.ops_take_photo')}</Text>
              <Text variant="footnote" color="textMuted" align="center" style={{ paddingHorizontal: theme.space[6] }}>
                {t('partner.ops_lm_photo_hint')}
              </Text>
            </Pressable>
          </Card>
        )}
        {photo ? null : <Button testID="ops-landmark-library" label={t('partner.ops_from_library')} variant="ghost" size="sm" onPress={() => void pick('library')} />}
      </View>

      <View style={{ gap: theme.space[2] }}>
        <Text variant="label">{t('partner.ops_lm_names')}</Text>
        {names.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {names.map((n) => (
              <Chip key={n} label={n} selected icon="x" role="button" onPress={() => setNames(names.filter((x) => x !== n))} />
            ))}
          </View>
        ) : null}
        <TextField
          testID="ops-landmark-name-input"
          placeholder={t('partner.ops_lm_names_hint')}
          value={nameDraft}
          onChangeText={setNameDraft}
          onSubmitEditing={() => {
            setNames(addLocalName(names, nameDraft));
            setNameDraft('');
          }}
          trailing={
            <Button
              label={t('partner.ops_lm_add_name')}
              size="sm"
              variant="ghost"
              disabled={!nameDraft.trim() || names.length >= 5}
              onPress={() => {
                setNames(addLocalName(names, nameDraft));
                setNameDraft('');
              }}
            />
          }
        />
      </View>

      <TextField label={t('partner.ops_lm_caption')} value={caption} onChangeText={setCaption} maxLength={120} />
    </Screen>
  );
}
