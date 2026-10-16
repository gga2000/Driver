import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { PartnerDoor } from '@driver/contracts';
import { Button, Icon, StatusPill, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { PhotoStrip, PhotoViewer } from './PlacePhotos';

/**
 * The customer's door on a drop-off at a saved place (maps program f6, a5, a3, a2): "first time here,
 * call before you get there", «قرب الجامع الكبير» (the landmark the customer chose — how people here
 * give directions), the place's standing note, its door photos, and "الباب مأكّد" once earlier
 * couriers' arrivals agree (the stop's pin is then that door). The photo opens full screen
 * by itself once when he arrives (the moment he is looking for the door), and on a tap any time.
 */
export function DoorCard({
  door,
  arrived,
  onCall,
  callsLive = true,
  stopId,
  omitNote = false,
  omitLandmark = false,
}: {
  door: PartnerDoor;
  arrived: boolean;
  onCall: () => void;
  /** G0-10: with calls off, the first-visit line asks for a message instead. */
  callsLive?: boolean;
  stopId: string;
  /** Partner redesign j2: the job's headline already reads the place's note / the landmark. */
  omitNote?: boolean;
  omitLandmark?: boolean;
}) {
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
          <Icon name={callsLive ? 'phone' : 'chat'} size={20} color="warningText" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" weight={700} color="warningText">
              {t('partner.door_first_visit')}
            </Text>
            <Text variant="caption" color="textMuted">
              {t(callsLive ? 'partner.door_first_visit_hint' : 'partner.door_first_visit_hint_chat')}
            </Text>
          </View>
          <Button label={t(callsLive ? 'partner.call' : 'partner.message_short')} icon={callsLive ? undefined : 'chat'} size="sm" variant="secondary" onPress={onCall} testID="job-first-visit-call" />
        </View>
      ) : null}

      {(door.placeNote && !omitNote) || door.photos.length > 0 || door.doorConfirmed || door.entranceSet || (door.landmark && !omitLandmark) ? (
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
          {door.landmark && !omitLandmark ? (
            <View testID="job-door-landmark" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Icon name="map-pin" size={18} color="accentText" />
              <Text variant="label" weight={600} style={{ flex: 1 }}>
                {t('partner.door_landmark', { name: door.landmark })}
              </Text>
            </View>
          ) : null}
          {door.placeNote && !omitNote ? (
            <Text variant="label" testID="job-door-note">
              {door.placeNote}
            </Text>
          ) : null}
          <PhotoStrip photos={door.photos} onOpen={setOpen} photoLabel={(n) => t('partner.door_photo_open', { n })} testIDPrefix="job-door" />
        </View>
      ) : null}

      <PhotoViewer photos={door.photos} index={open} onIndex={setOpen} title={t('partner.door_title')} testIDPrefix="job-door" />
    </View>
  );
}
