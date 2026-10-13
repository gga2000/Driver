import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AZIZIYAH_CENTRE, type LatLng } from '@driver/contracts';
import { Button, IconButton, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { PinPicker } from '@/features/places/PinPicker';
import { shopPin } from '@/features/shopping/errand';

/**
 * Marking a shop that is not in the app (دوّرلي «محل أعرفه»): the day map with the saffron pin, move
 * the map until the pin sits on the shop, then «هنا المحل». The pin goes back to the item it came from.
 */
export default function ShopPin() {
  const params = useLocalSearchParams<{ lat?: string; lng?: string }>();
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const start: LatLng =
    params.lat && params.lng
      ? { lat: Number(params.lat), lng: Number(params.lng) }
      : { lat: AZIZIYAH_CENTRE.lat, lng: AZIZIYAH_CENTRE.lng };
  const [pin, setPin] = useState<LatLng>(start);
  const [moving, setMoving] = useState(false);

  return (
    <View testID="shopping-shop-pin" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ flex: 1 }}>
        <PinPicker initial={start} onCentre={setPin} onMoving={setMoving} recentre={null} />
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: insets.top + theme.space[3],
            start: theme.space[4],
            end: theme.space[4],
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[2],
          }}
        >
          <IconButton
            icon="arrow-back"
            variant="outline"
            accessibilityLabel={t('action.back')}
            onPress={() => router.back()}
            style={{ backgroundColor: theme.colors.surface }}
          />
          <View
            style={{
              flexShrink: 1,
              minHeight: 44,
              justifyContent: 'center',
              paddingHorizontal: theme.space[4],
              borderRadius: 22,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text variant="bodyStrong" numberOfLines={1}>
              {t('shopping.pin_title')}
            </Text>
          </View>
        </View>
      </View>
      <View
        style={{
          paddingHorizontal: theme.space[5],
          paddingTop: theme.space[4],
          paddingBottom: Math.max(insets.bottom, theme.space[4]),
          gap: theme.space[3],
          backgroundColor: theme.colors.surfaceRaised,
        }}
      >
        <Text variant="footnote" color="textMuted">
          {t('shopping.pin_hint')}
        </Text>
        <Button
          label={t('shopping.pin_confirm')}
          size="lg"
          fullWidth
          disabled={moving}
          onPress={() => {
            shopPin.put(pin);
            router.back();
          }}
        />
      </View>
    </View>
  );
}
