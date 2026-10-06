import { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PartnerDoor } from '@driver/contracts';
import { Button, Icon, StatusPill, Text, useTheme } from '@driver/ui';
import { absoluteUrl } from '@/features/account/photo';
import { useT } from '@/lib/i18n';

const THUMB = 72;

/**
 * The customer's door on a drop-off at a saved place (maps program f6, a5, a3, a2): "first time here,
 * call before you get there", «قرب الجامع الكبير» (the landmark the customer chose — how people here
 * give directions), the place's standing note, its door photos, and "الباب مأكّد" once earlier
 * couriers' arrivals agree (the stop's pin is then that door). The photo opens full screen
 * by itself once when he arrives (the moment he is looking for the door), and on a tap any time.
 */
export function DoorCard({ door, arrived, onCall, stopId }: { door: PartnerDoor; arrived: boolean; onCall: () => void; stopId: string }) {
  const theme = useTheme();
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  const shownOnArrival = useRef<string | null>(null);

  useEffect(() => {
    if (!arrived || door.photos.length === 0 || shownOnArrival.current === stopId) return;
    shownOnArrival.current = stopId;
    setOpen(0);
  }, [arrived, door.photos.length, stopId]);

  return (
    <View style={{ gap: theme.space[3] }} testID="job-door">
      {door.firstVisit && !arrived ? (
        <View testID="job-first-visit" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], backgroundColor: theme.colors.warningTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
          <Icon name="phone" size={20} color="warningText" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" weight={700} color="warningText">
              {t('partner.door_first_visit')}
            </Text>
            <Text variant="caption" color="textMuted">
              {t('partner.door_first_visit_hint')}
            </Text>
          </View>
          <Button label={t('partner.call')} size="sm" variant="secondary" onPress={onCall} testID="job-first-visit-call" />
        </View>
      ) : null}

      {door.placeNote || door.photos.length > 0 || door.doorConfirmed || door.entranceSet || door.landmark ? (
        <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3], gap: theme.space[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="caption" weight={600} color="textMuted" style={{ flex: 1 }}>
              {t('partner.door_title')}
            </Text>
            {door.entranceSet ? (
              <StatusPill size="sm" tone="info" icon="map-pin" label={t('partner.door_entrance_set')} />
            ) : door.doorConfirmed ? (
              <StatusPill size="sm" tone="success" icon="check" label={t('partner.door_confirmed')} />
            ) : null}
          </View>
          {door.landmark ? (
            <View testID="job-door-landmark" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Icon name="map-pin" size={18} color="accentText" />
              <Text variant="label" weight={600} style={{ flex: 1 }}>
                {t('partner.door_landmark', { name: door.landmark })}
              </Text>
            </View>
          ) : null}
          {door.placeNote ? (
            <Text variant="label" testID="job-door-note">
              {door.placeNote}
            </Text>
          ) : null}
          {door.photos.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
              {door.photos.map((p, i) => (
                <Pressable
                  key={p.id}
                  onPress={() => setOpen(i)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={t('partner.door_photo_open', { n: i + 1 })}
                  testID={`job-door-photo-${i}`}
                  style={{ width: THUMB, height: THUMB, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors.surface }}
                >
                  <Image source={{ uri: absoluteUrl(p.url) }} style={{ width: THUMB, height: THUMB }} resizeMode="cover" />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <PhotoViewer photos={door.photos} index={open} onIndex={setOpen} />
    </View>
  );
}

function PhotoViewer({ photos, index, onIndex }: { photos: PartnerDoor['photos']; index: number | null; onIndex: (i: number | null) => void }) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const photo = index === null ? null : photos[index];
  const close = () => onIndex(null);
  return (
    <Modal visible={Boolean(photo)} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View testID="job-door-viewer" style={{ flex: 1, backgroundColor: theme.colors.scrim, paddingTop: insets.top + theme.space[3], paddingBottom: insets.bottom + theme.space[4], paddingHorizontal: theme.space[4], gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ flex: 1, alignSelf: 'flex-start', paddingHorizontal: theme.space[3], paddingVertical: theme.space[1], borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface }}>
            <Text variant="label" weight={600}>
              {t('partner.door_title')}
              {photos.length > 1 && index !== null ? ` · ${index + 1}/${photos.length}` : ''}
            </Text>
          </View>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t('action.close')} testID="job-door-close" style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface }}>
            <Icon name="x" size={22} color="text" />
          </Pressable>
        </View>
        {photo ? (
          <Pressable style={{ flex: 1 }} onPress={() => (index !== null && photos.length > 1 ? onIndex((index + 1) % photos.length) : close())} accessibilityRole="imagebutton" accessibilityLabel={t('partner.door_photo_next')}>
            <Image source={{ uri: absoluteUrl(photo.url) }} style={{ flex: 1, borderRadius: theme.radius.lg }} resizeMode="contain" />
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}
