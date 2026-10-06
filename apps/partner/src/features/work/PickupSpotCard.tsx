import { useState } from 'react';
import { View } from 'react-native';
import type { PartnerPickupSpot } from '@driver/contracts';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { PhotoStrip, PhotoViewer } from './PlacePhotos';

/**
 * Where the kitchen hands orders over (maps program r7): the restaurant's own note («الاستلام من
 * الشباك اليسار») and photos of the window or side door, on the pickup stop until he has the food —
 * the kitchen's version of the customer's door card. Unlike the door, the photo doesn't open by
 * itself on arrival: at the counter he needs the pickup code on screen, not a photo over it.
 */
export function PickupSpotCard({ spot }: { spot: PartnerPickupSpot }) {
  const theme = useTheme();
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  if (!spot.note && spot.photos.length === 0) return null;
  return (
    <View testID="job-pickup-spot" style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3], gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name="bag" size={18} color="accentText" />
        <Text variant="caption" weight={600} color="textMuted" style={{ flex: 1 }}>
          {t('partner.pickup_spot_title')}
        </Text>
      </View>
      {spot.note ? (
        <Text variant="label" weight={600} testID="job-pickup-spot-note">
          {spot.note}
        </Text>
      ) : null}
      <PhotoStrip photos={spot.photos} onOpen={setOpen} photoLabel={(n) => t('partner.pickup_spot_photo_open', { n })} testIDPrefix="job-pickup-spot" />
      <PhotoViewer photos={spot.photos} index={open} onIndex={setOpen} title={t('partner.pickup_spot_title')} testIDPrefix="job-pickup-spot" />
    </View>
  );
}
