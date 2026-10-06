import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LatLng } from '@driver/contracts';
import { Button, Icon, IconButton, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { currentFix } from '@/features/account/device';
import { nearestZone } from '@/features/account/geo';
import { tooClose, zoneTitle, type Spot } from '@/features/ride/logic';
import { useZoneFor } from '@/features/ride/queries';
import { PinPicker } from '@/features/places/PinPicker';
import { rideStore, useRideStore } from '@/features/ride/store';
import { useRideSpots } from '@/features/ride/useSpots';
import { useLocale, useT } from '@/lib/i18n';
import { color as palette } from '@driver/design-tokens';

const CENTRE: LatLng = { lat: 32.905, lng: 45.06 };

/**
 * Pin adjust (customer spec §5): the map moves under a fixed pin; the zone under the tip comes from
 * the server (`places.zoneFor`) — the zone prices the ride, so the rider sees it before confirming.
 */
export default function RidePin() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { field: rawField } = useLocalSearchParams<{ field?: string }>();
  const field = rawField === 'pickup' ? 'pickup' : 'dropoff';
  const ride = useRideStore();
  const { defaultPickup } = useRideSpots();
  const pickup = ride.draft.pickup ?? defaultPickup;
  const start = (field === 'pickup' ? pickup?.pin : (ride.draft.dropoff?.pin ?? pickup?.pin)) ?? CENTRE;
  const [pin, setPin] = useState<LatLng>(start);
  const [moving, setMoving] = useState(false);
  const [recentre, setRecentre] = useState<{ pin: LatLng; seq: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const zone = useZoneFor(pin);
  const z = zone.data;
  const zoneId = z?.zoneId ?? null;
  const outside = z ? !z.inService : false;
  const fresh = !zone.isPlaceholderData && !zone.isFetching;

  const locate = async () => {
    setLocating(true);
    const fix = await currentFix();
    setLocating(false);
    if (fix === 'denied') toast.show({ message: t('error.location_denied'), tone: 'danger' });
    else if (!fix) toast.show({ message: t('error.location_weak'), tone: 'danger' });
    else setRecentre({ pin: fix.pin, seq: Date.now() });
  };

  const confirm = () => {
    if (!zoneId) return;
    const spot: Spot = {
      id: `pin:${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}`,
      kind: 'pin',
      title: zoneTitle(zoneId, locale === 'en' ? 'en' : 'ar-IQ'),
      subtitle: t('ride.pin_spot'),
      zoneId,
      pin,
    };
    if (field === 'pickup') {
      rideStore.update({ pickup: spot });
      router.back();
      return;
    }
    if (pickup && tooClose(pickup, spot)) {
      toast.show({ message: t('ride.same_place'), tone: 'warning', icon: 'map-pin' });
      return;
    }
    rideStore.update({ dropoff: spot });
    if (pickup) router.replace('/ride/choose');
    else router.back();
  };

  // While the server answers, the nearest seed zone is a fair preview (it decides the same way).
  const shownZone = zoneId ?? (z ? null : nearestZone(pin));

  return (
    <View testID="ride-pin" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1 }}>
        <PinPicker initial={start} onCentre={setPin} onMoving={setMoving} recentre={recentre} tone={field === 'pickup' ? 'pickup' : 'dropoff'} testID="ride-pin-map" />
        <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + theme.space[3], left: theme.space[4], right: theme.space[4], flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <IconButton icon="chevron-back" variant="outline" accessibilityLabel={t('action.back')} onPress={() => router.back()} style={{ backgroundColor: theme.colors.surface }} testID="ride-pin-back" />
          <View
            style={{
              flexShrink: 1,
              paddingHorizontal: theme.space[4],
              height: 44,
              borderRadius: 22,
              justifyContent: 'center',
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text variant="bodyStrong" numberOfLines={1}>
              {t(field === 'pickup' ? 'ride.pin_title_pickup' : 'ride.pin_title_dropoff')}
            </Text>
          </View>
        </View>
        <View pointerEvents="box-none" style={{ position: 'absolute', bottom: theme.space[4], left: theme.space[4] }}>
          <IconButton icon="location-arrow" variant="outline" accessibilityLabel={t('place.use_my_location')} onPress={() => void locate()} disabled={locating} style={{ backgroundColor: theme.colors.surface }} testID="ride-pin-locate" />
        </View>
      </View>

      <View
        style={{
          marginTop: -theme.space[5],
          paddingTop: theme.space[5],
          paddingHorizontal: theme.space[5],
          paddingBottom: Math.max(insets.bottom, theme.space[4]),
          gap: theme.space[4],
          backgroundColor: theme.colors.surfaceRaised,
          borderTopLeftRadius: theme.radius['2xl'],
          borderTopRightRadius: theme.radius['2xl'],
          shadowColor: palette.neutral[1000],
          shadowOpacity: 0.12,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
          elevation: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }} accessibilityLiveRegion="polite" testID="ride-pin-zone">
          <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: outside ? theme.colors.warningTint : theme.colors.accentTint }}>
            <Icon name="map-pin" size={22} color={outside ? 'warningText' : 'accentText'} strokeWidth={2} />
          </View>
          {/* Fixed line heights: a card that grows while the map is dragged would resize the map and drop the drag. */}
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ height: 30, justifyContent: 'center' }}>
              {moving ? (
                <Text color="textMuted" numberOfLines={1}>
                  {t('ride.pin_moving')}
                </Text>
              ) : outside && fresh ? (
                <Text variant="bodyStrong" color="warningText" numberOfLines={1}>
                  {t('ride.pin_out_of_service')}
                </Text>
              ) : shownZone ? (
                <Text variant="title" numberOfLines={1}>
                  {t('place.zone_is', { zone: zoneTitle(shownZone, locale === 'en' ? 'en' : 'ar-IQ') })}
                </Text>
              ) : (
                <Skeleton width={160} height={22} />
              )}
            </View>
            <Text variant="caption" color="textMuted" numberOfLines={1} style={{ height: 20 }}>
              {t('ride.pin_hint')}
            </Text>
          </View>
        </View>
        <Button
          testID="ride-pin-confirm"
          size="lg"
          fullWidth
          label={t(field === 'pickup' ? 'ride.pin_confirm_pickup' : 'ride.pin_confirm_dropoff')}
          disabled={moving || !zoneId || outside || !fresh}
          haptic="success"
          onPress={confirm}
        />
      </View>
    </View>
  );
}
