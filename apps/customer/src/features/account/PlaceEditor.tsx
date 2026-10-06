import { useMemo, useState } from 'react';
import { Image, Platform, Pressable, View } from 'react-native';
import { AZIZIYAH_ZONES, PLACE_MAX_PHOTOS, type LatLng, type PlacePhotoRef, type SavedPlaceLabel, type SavePlaceInput } from '@driver/contracts';
import { Button, Chip, ChipGroup, Icon, Text, TextField, useTheme, useToast } from '@driver/ui';
import { useApiClient } from '@/lib/api';
import { useLocale, useT, type TFn } from '@/lib/i18n';
import { zoneName } from '@/lib/profile';
import { currentFix, photoUri, pickGatePhoto, uploadPhoto, type PhotoSource } from './device';
import { nearestZone, zoneCentre } from './geo';
import { placeIcon } from '@/features/places/place-icon';
import { PinPicker } from '@/features/places/PinPicker';

export interface PlaceEditorValue {
  label: SavedPlaceLabel;
  name: string;
  pin: LatLng | null;
  /** Preview only (nearest zone); the server resolves the real zone from the pin. */
  zoneId: string | null;
  note: string;
  photos: PlacePhotoRef[];
  shareWithHousehold: boolean;
}

export const EMPTY_PLACE_EDITOR: PlaceEditorValue = { label: 'home', name: '', pin: null, zoneId: null, note: '', photos: [], shareWithHousehold: false };

const LABEL_KEY = { home: 'onboarding.place_label_home', work: 'onboarding.place_label_work', custom: 'onboarding.place_label_other' } as const;

export function defaultPlaceName(label: SavedPlaceLabel, t: TFn): string {
  return t(LABEL_KEY[label]);
}

/** The editor's value as a `places.save` input (null until it has a pin and a name). */
export function toSaveInput(v: PlaceEditorValue, t: TFn): SavePlaceInput | null {
  if (!v.pin) return null;
  return {
    cityId: 'aziziyah',
    label: v.label,
    name: (v.name.trim() || defaultPlaceName(v.label, t)).slice(0, 60),
    pin: v.pin,
    ...(v.note.trim() ? { note: v.note.trim() } : {}),
    photoIds: v.photos.map((p) => p.id),
    shareWithHousehold: v.shareWithHousehold,
  };
}

/** Centre and near zones first (most orders); "كل المناطق" shows all 34. */
const COMMON_ZONES = AZIZIYAH_ZONES.filter((z) => z.tier === 'centre' || z.tier === 'near');
/** Where the map opens for a new place with no zone yet: the middle of the town. */
const AZIZIYAH_CENTRE: LatLng = { lat: 32.9085, lng: 45.0655 };

/**
 * Saved-place editor (domain §7, customer spec §10): what the place is, where exactly (move the map
 * under the pin as on the ride screen — maps program a1 — use the phone's GPS with its accuracy shown,
 * or pick a zone when the map is hard), a note for the courier, a gate photo, and household sharing.
 * Controlled; the screen owns saving.
 */
export function PlaceEditor({ value, onChange, canShare = false }: { value: PlaceEditorValue; onChange: (next: PlaceEditorValue) => void; canShare?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const client = useApiClient();
  const [allZones, setAllZones] = useState(false);
  const [locating, setLocating] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Where the map opens (the saved pin, else the zone, else the town), and camera moves asked for.
  const [start] = useState<LatLng>(() => value.pin ?? (value.zoneId ? zoneCentre(value.zoneId) : null) ?? AZIZIYAH_CENTRE);
  const [recentre, setRecentre] = useState<{ pin: LatLng; seq: number; accuracyM?: number } | null>(null);
  const moveTo = (pin: LatLng, accuracyM?: number | null) => setRecentre((r) => ({ pin, seq: (r?.seq ?? 0) + 1, ...(accuracyM ? { accuracyM } : {}) }));

  const zones = useMemo(() => {
    const list = allZones ? AZIZIYAH_ZONES : COMMON_ZONES;
    const chosen = AZIZIYAH_ZONES.find((z) => z.id === value.zoneId);
    return chosen && !list.includes(chosen) ? [...list, chosen] : list;
  }, [allZones, value.zoneId]);

  const setPin = (pin: LatLng) => onChange({ ...value, pin, zoneId: nearestZone(pin) });

  const setLabel = (label: SavedPlaceLabel) => {
    const keepName = value.name.trim() && value.name !== defaultPlaceName(value.label, t);
    onChange({ ...value, label, name: keepName ? value.name : defaultPlaceName(label, t) });
  };

  const locateMe = async () => {
    setLocating(true);
    const fix = await currentFix();
    setLocating(false);
    if (fix === 'denied') toast.show({ message: t('error.location_denied'), tone: 'danger' });
    else if (!fix) toast.show({ message: t('error.location_weak'), tone: 'danger' });
    else moveTo(fix.pin, fix.accuracyM);
  };

  const addPhoto = async (source: PhotoSource) => {
    const picked = await pickGatePhoto(source);
    if (picked === 'denied') {
      toast.show({ message: t('error.camera_denied'), tone: 'danger' });
      return;
    }
    if (!picked) return;
    setUploading(true);
    try {
      const id = await uploadPhoto(picked, (input) => client.places.photoUpload.mutate(input));
      onChange({ ...value, photos: [...value.photos, { id, url: picked.uri }].slice(-PLACE_MAX_PHOTOS) });
    } catch {
      toast.show({ message: t('error.upload_failed'), tone: 'danger' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={{ gap: theme.space[6] }}>
      <View style={{ gap: theme.space[3] }}>
        <Text variant="title">{t('onboarding.place_label')}</Text>
        <ChipGroup
          accessibilityLabel={t('onboarding.place_label')}
          mode="single"
          required
          value={[value.label]}
          onChange={(next) => setLabel((next[0] as SavedPlaceLabel | undefined) ?? value.label)}
          items={(['home', 'work', 'custom'] as const).map((l) => ({ id: l, label: t(LABEL_KEY[l]), icon: placeIcon(l) }))}
        />
        <TextField testID="place-name" label={t('place.name_label')} value={value.name} onChangeText={(name) => onChange({ ...value, name })} placeholder={defaultPlaceName(value.label, t)} maxLength={60} />
      </View>

      <View style={{ gap: theme.space[3] }}>
        <Text variant="title">{t('place.where_title')}</Text>
        <Text variant="footnote" color="textMuted">
          {t('place.map_hint')}
        </Text>
        <View testID="place-map" accessibilityLabel={t('place.map_hint')} style={{ height: 280, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
          <PinPicker initial={start} onCentre={setPin} onMoving={() => undefined} recentre={recentre} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexShrink: 1 }}>
            <Icon name="map-pin" size={18} color={value.zoneId ? 'accentText' : 'textMuted'} />
            <Text testID="place-zone" variant="label" color={value.zoneId ? 'text' : 'textMuted'} numberOfLines={1}>
              {value.zoneId ? t('place.zone_is', { zone: zoneName(value.zoneId, locale) }) : t('place.no_pin')}
            </Text>
          </View>
          <Button size="sm" variant="secondary" icon="location-arrow" label={t('place.use_my_location')} loading={locating} onPress={() => void locateMe()} />
        </View>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <Text variant="label" color="textMuted">
          {t('place.zone_fallback')}
        </Text>
        <ChipGroup
          accessibilityLabel={t('onboarding.place_zone')}
          mode="single"
          value={value.zoneId ? [value.zoneId] : []}
          onChange={(next) => {
            const c = next[0] ? zoneCentre(next[0]) : null;
            if (c) moveTo(c);
          }}
          items={zones.map((z) => ({ id: z.id, label: zoneName(z.id, locale) }))}
        />
        <Button variant="ghost" size="sm" icon={allZones ? 'minus' : 'plus'} label={allZones ? t('onboarding.place_fewer_zones') : t('onboarding.place_more_zones')} onPress={() => setAllZones((v) => !v)} />
      </View>

      <TextField
        testID="place-note"
        label={t('cart.note_courier')}
        value={value.note}
        onChangeText={(note) => onChange({ ...value, note })}
        placeholder={t('onboarding.place_note_placeholder')}
        hint={t('place.note_privacy')}
        multiline
        maxLength={300}
      />

      <View style={{ gap: theme.space[3] }}>
        <Text variant="title">{t('onboarding.place_photo')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3] }}>
          {value.photos.map((p) => (
            <View key={p.id} style={{ width: 96, height: 96, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
              <Image source={{ uri: photoUri(p.url) }} style={{ width: 96, height: 96 }} resizeMode="cover" accessibilityIgnoresInvertColors />
              <Pressable hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('place.photo_remove')}
                onPress={() => onChange({ ...value, photos: value.photos.filter((x) => x.id !== p.id) })}
                style={{ position: 'absolute', top: 4, end: 4, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface }}
              >
                <Icon name="x" size={16} color="text" />
              </Pressable>
            </View>
          ))}
          {value.photos.length < PLACE_MAX_PHOTOS ? (
            <Pressable
              testID="place-photo-add"
              accessibilityRole="button"
              accessibilityLabel={t('place.photo_add')}
              disabled={uploading}
              onPress={() => void addPhoto(Platform.OS === 'web' ? 'library' : 'camera')}
              style={{ width: 96, height: 96, borderRadius: theme.radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.borderStrong, alignItems: 'center', justifyContent: 'center', gap: 4 }}
            >
              <Icon name={uploading ? 'clock' : 'plus'} size={22} color="textMuted" />
              <Text variant="caption" color="textMuted">
                {uploading ? t('place.photo_uploading') : t('place.photo_add')}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Text variant="footnote" color="textMuted">
          {t('place.photo_hint')}
        </Text>
        {Platform.OS !== 'web' && value.photos.length < PLACE_MAX_PHOTOS ? <Button variant="ghost" size="sm" icon="plus" label={t('place.photo_from_library')} onPress={() => void addPhoto('library')} /> : null}
      </View>

      {canShare ? (
        <View style={{ gap: theme.space[2] }}>
          <Chip
            testID="place-share"
            role="checkbox"
            icon="user"
            selected={value.shareWithHousehold}
            label={t('place.share_household')}
            onPress={() => onChange({ ...value, shareWithHousehold: !value.shareWithHousehold })}
          />
          <Text variant="footnote" color="textMuted">
            {t('place.share_household_hint')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
