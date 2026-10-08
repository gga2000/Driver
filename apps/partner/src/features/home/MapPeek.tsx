import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PartnerDemandMap, VehicleClass } from '@driver/contracts';
import { Button, Text, useTheme } from '@driver/ui';
import { DriverMap } from '@/features/map/DriverMap';
import { VEHICLE_ICON, zoneName } from '@/features/work/logic';
import { useT } from '@/lib/i18n';
import { MAP_PEEK_MS } from './logic';

/**
 * h5 «وريني الخريطة»: the city with the busy streets glowing, the three busiest named with their
 * count, then the dashboard comes back by itself after 20 seconds (a map left open in a holder heats
 * the phone and drains the battery).
 */
export function MapPeek({ visible, onClose, self, vehicle, online, zones }: { visible: boolean; onClose: () => void; self: { lat: number; lng: number } | null; vehicle: VehicleClass; online: boolean; zones: PartnerDemandMap['zones'] }) {
  const theme = useTheme();
  const t = useT();
  const [left, setLeft] = useState(MAP_PEEK_MS / 1000);
  useEffect(() => {
    if (!visible) return;
    const end = Date.now() + MAP_PEEK_MS;
    setLeft(MAP_PEEK_MS / 1000);
    const id = setInterval(() => {
      const s = Math.ceil((end - Date.now()) / 1000);
      if (s <= 0) {
        clearInterval(id);
        onClose();
      } else setLeft(s);
    }, 500);
    return () => clearInterval(id);
  }, [visible, onClose]);
  if (!visible) return null;
  const busiest = [...zones].filter((z) => z.waiting > 0).sort((a, b) => b.waiting - a.waiting).slice(0, 3);
  return (
    <Animated.View testID="map-peek" entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.bg, zIndex: 20 }}>
      <DriverMap self={self} vehicleIcon={VEHICLE_ICON[vehicle]} online={online} heat={zones} topInset={120} bottomInset={150} soloZoom={13.6} />
      <SafeAreaView edges={['top']} pointerEvents="box-none" style={{ position: 'absolute', top: 0, start: 0, end: 0 }}>
        <View pointerEvents="none" style={{ margin: theme.space[4], padding: theme.space[3], borderRadius: 18, backgroundColor: theme.colors.surface, borderWidth: 1.5, borderColor: theme.colors.border, gap: 6 }}>
          <Text variant="label" weight={700}>
            {t('partner.peek_title')}
          </Text>
          {busiest.length === 0 ? (
            <Text variant="caption" color="textMuted">
              {t('partner.hint_quiet')}
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {busiest.map((z) => (
                <View key={z.zoneId} style={{ backgroundColor: theme.colors.inverse, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text variant="caption" weight={700} color="onInverse" tabular>
                    {t('partner.peek_zone', { zone: zoneName(z.zoneId, 'ar-IQ', t), n: z.waiting })}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={{ position: 'absolute', bottom: 0, start: 0, end: 0 }}>
        <View style={{ margin: theme.space[4], padding: theme.space[3], borderRadius: 22, backgroundColor: theme.colors.surface, gap: theme.space[2], borderWidth: 1.5, borderColor: theme.colors.border }}>
          <Button testID="map-peek-back" label={t('partner.peek_back')} variant="secondary" size="lg" fullWidth onPress={onClose} />
          <Text variant="caption" color="textMuted" align="center" tabular accessibilityLiveRegion="none">
            {t('partner.peek_auto', { n: left })}
          </Text>
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}
