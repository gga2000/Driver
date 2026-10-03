import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Icon, IconButton, Text, useTheme, useToast } from '@driver/ui';
import { placeLabelKey } from '@/features/places/PlaceForm';
import { useLocale, useT } from '@/lib/i18n';
import { selectedPlace, useProfile, zoneName } from '@/lib/profile';

/** "التوصيل لـ" place picker (opens /places) and the notifications bell. */
export function HomeHeader() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const prof = useProfile();
  const place = selectedPlace(prof);
  const placeText = place ? `${place.title ?? t(placeLabelKey(place.label))} · ${zoneName(place.zoneId, locale)}` : t('home.deliver_to_none');

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      <Pressable
        testID="home-place-picker"
        accessibilityRole="button"
        accessibilityLabel={`${t('checkout.deliver_to')} ${placeText}`}
        onPress={() => router.push('/places')}
        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], opacity: pressed ? 0.7 : 1 })}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: theme.colors.accentTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="map-pin" size={22} color="accentText" strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="caption" color="textMuted">
            {t('checkout.deliver_to')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
              {placeText}
            </Text>
            <Icon name="chevron-down" size={16} color="text" strokeWidth={2.2} />
          </View>
        </View>
      </Pressable>
      <IconButton
        icon="bell"
        variant="outline"
        accessibilityLabel={t('empty.notifications')}
        onPress={() => toast.show({ message: t('empty.notifications'), icon: 'bell' })}
      />
    </View>
  );
}
