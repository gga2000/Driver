import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LatLng } from '@driver/contracts';
import { Text, useTheme, withAlpha } from '@driver/ui';
import { nearestZone } from '@/features/account/geo';
import { PinPicker } from '@/features/places/PinPicker';
import { useLocale, useT } from '@/lib/i18n';
import { zoneName } from '@/lib/profile';
import { ParcelButton } from './ParcelButton';
import { RoundButton } from './Parts';

/**
 * «أثبّته آني»: the sender marks the receiver's door himself. The map moves under the fixed pin (the day map,
 * a saffron head in a cream ring, as every pin-setting map); the area under the pin shows as it moves (a
 * preview: the server decides the zone and the fare when it is sent).
 */
export function DoorPinPanel({ initial, onSet, onClose }: { initial: LatLng; onSet: (pin: LatLng, zoneKey: string) => void; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState<LatLng>(initial);
  const [moving, setMoving] = useState(false);
  const zone = nearestZone(pin);
  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(180)} style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.bg }]} testID="parcel-pin-panel">
      <View style={{ flex: 1 }}>
        <PinPicker initial={initial} onCentre={setPin} onMoving={setMoving} recentre={null} testID="parcel-pin-map" />
        <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + theme.space[3], start: theme.space[16], end: theme.space[16], alignItems: 'center' }}>
          <View style={{ paddingHorizontal: theme.space[3], paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: withAlpha(theme.colors.inverse, 0.86) }}>
            <Text variant="caption" weight={600} color="onInverse" align="center">
              {t('place.map_hint_custom')}
            </Text>
          </View>
        </View>
        <View style={{ position: 'absolute', top: insets.top + theme.space[2], start: theme.space[3] }}>
          <RoundButton icon="arrow-back" label={t('action.back')} onPress={onClose} testID="parcel-pin-back" />
        </View>
      </View>
      <View style={{ backgroundColor: theme.colors.surfaceRaised, borderTopLeftRadius: theme.radius['2xl'], borderTopRightRadius: theme.radius['2xl'], marginTop: -24, padding: theme.space[5], paddingBottom: Math.max(insets.bottom, theme.space[5]), gap: theme.space[4] }}>
        <View style={{ gap: theme.space[1] }}>
          <Text variant="heading">{t('parcel.c_pin_title')}</Text>
          <Text variant="label" color="textMuted" testID="parcel-pin-zone">
            {zoneName(zone, locale)}
          </Text>
        </View>
        <ParcelButton label={t('parcel.c_pin_set')} icon="check" disabled={moving} onPress={() => onSet(pin, zone)} testID="parcel-pin-set" />
      </View>
    </Animated.View>
  );
}
