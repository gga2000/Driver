import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Icon, Text, useMotionPresets, useTheme } from '@driver/ui';
import { useWalletBalance } from '@/features/account/queries';
import { placeLabelKey } from '@/features/places/PlaceForm';
import { useLocale, useT } from '@/lib/i18n';
import { selectedPlace, useProfile, zoneName } from '@/lib/profile';
import { useSignedIn } from '@/lib/session';
import { greetingKey, type Daypart } from './daypart';
import { pointsChip } from './points-chip';

/**
 * The top of home (discovery D-18, §6): the hour's greeting as the warmest, largest line («وقت الغدا،
 * أم علي», joy h1; plain on quiet days), then where we deliver («البيت · شارع 30 ▾», opens /places).
 * The empty bell is gone (D-07): until a real inbox exists its slot shows the points chip (h9).
 */
export function HomeHeader({ daypart, quiet }: { daypart: Pick<Daypart, 'key' | 'friday'>; quiet: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const presets = useMotionPresets();
  const prof = useProfile();
  const signedIn = useSignedIn();
  const balance = useWalletBalance();
  const chip = pointsChip(signedIn, balance.data);
  const place = selectedPlace(prof);
  const placeText = place ? `${place.title ?? t(placeLabelKey(place.label))} · ${zoneName(place.zoneId, locale)}` : t('home.deliver_to_none');
  const key = greetingKey(daypart, { quiet, named: Boolean(prof.name) });
  const hello = t(key, { name: prof.name ?? '' });

  return (
    <View style={{ gap: theme.space[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 44 }}>
        {/* Keyed by the line, so a new hour (or a quiet day switched on) fades the new words in. */}
        <Animated.View key={key} entering={presets.fadeIn()} style={{ flex: 1 }}>
          <Text variant="voice" face="voice" numberOfLines={2} accessibilityRole="header" testID="home-greeting">
            {hello}
          </Text>
        </Animated.View>
        {chip ? <PointsChip text={chip.text} /> : null}
      </View>
      <Pressable
        testID="home-place-picker"
        accessibilityRole="button"
        accessibilityLabel={`${t('checkout.deliver_to')} ${placeText}`}
        onPress={() => router.push('/places')}
        style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', maxWidth: '100%', opacity: pressed ? 0.7 : 1 })}
      >
        <Icon name="map-pin" size={16} color="accentText" strokeWidth={2.2} />
        <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
          {placeText}
        </Text>
        <Icon name="chevron-down" size={16} color="text" strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

/** «1,250 نقطة» in saffron (the deals-and-points colour), opens the wallet. 44 px tall to tap. */
function PointsChip({ text }: { text: string }) {
  const theme = useTheme();
  const t = useT();
  const presets = useMotionPresets();
  return (
    <Animated.View entering={presets.pop()}>
      <Pressable
        testID="home-points"
        accessibilityRole="button"
        accessibilityLabel={t('home.points_chip_a11y', { n: text })}
        onPress={() => {
          theme.haptic('selection');
          router.push('/wallet');
        }}
        style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[1],
            paddingHorizontal: theme.space[3],
            minHeight: 34,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.deal,
          }}
        >
          <Icon name="star" size={14} color="onDeal" strokeWidth={2.4} />
          <Text variant="label" weight={700} tabular color="onDeal">
            {t('home.points_chip', { n: text })}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
