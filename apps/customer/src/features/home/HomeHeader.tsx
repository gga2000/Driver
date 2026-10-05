import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Icon, IconButton, Text, useTheme, useToast } from '@driver/ui';
import { placeLabelKey } from '@/features/places/PlaceForm';
import { useLocale, useT } from '@/lib/i18n';
import { selectedPlace, useProfile, zoneName } from '@/lib/profile';

/**
 * The calm top of home (audit C-09): one line of greeting and where we deliver ("هلا علي · التوصيل لـ"
 * over "البيت · شارع 30 ▾", opens /places) and the notifications bell. No big heading: the space goes
 * to the services and the food.
 */
export function HomeHeader() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const prof = useProfile();
  const place = selectedPlace(prof);
  const placeText = place ? `${place.title ?? t(placeLabelKey(place.label))} · ${zoneName(place.zoneId, locale)}` : t('home.deliver_to_none');
  const hello = prof.name ? t('home.greeting', { name: prof.name }) : t('home.greeting_anon');

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      <Pressable
        testID="home-place-picker"
        accessibilityRole="button"
        accessibilityLabel={`${t('checkout.deliver_to')} ${placeText}`}
        onPress={() => router.push('/places')}
        style={({ pressed }) => ({ flex: 1, minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
      >
        <Text variant="caption" color="textMuted" numberOfLines={1} testID="home-greeting">
          {`${hello} · ${t('checkout.deliver_to')}`}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="map-pin" size={16} color="accentText" strokeWidth={2.2} />
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {placeText}
          </Text>
          <Icon name="chevron-down" size={16} color="text" strokeWidth={2.2} />
        </View>
      </Pressable>
      <IconButton icon="bell" variant="outline" accessibilityLabel={t('empty.notifications')} onPress={() => toast.show({ message: t('empty.notifications'), icon: 'bell' })} />
    </View>
  );
}
