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
 * The top of home (Date & Saffron, Ali 2026-10-06): where we deliver first («التوصيل إلى / البيت ·
 * شارع 30 ▾», opens /places) with the points chip on the other side (D-07: no bell until a real inbox,
 * h9), then the hour's greeting as the one hand-lettered line («علي، سهرانين؟ هذني فاتحين», joy h1;
 * plain on quiet days). The hour's sky behind it is the screen's backdrop.
 */
export function HomeHeader({ daypart, quiet, closed }: { daypart: Pick<Daypart, 'key' | 'friday'>; quiet: boolean; closed: boolean }) {
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
  const key = greetingKey(daypart, { quiet, named: Boolean(prof.name), closed });
  const hello = t(key, { name: prof.name ?? '' });

  return (
    <View style={{ gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 44 }}>
        <Pressable
          testID="home-place-picker"
          accessibilityRole="button"
          accessibilityLabel={`${t('checkout.deliver_to')} ${placeText}`}
          onPress={() => router.push('/places')}
          style={({ pressed }) => ({ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space[2], opacity: pressed ? 0.7 : 1 })}
        >
          <Icon name="map-pin" size={20} color="accentText" strokeWidth={2.2} />
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text variant="caption" color="textMuted" numberOfLines={1}>
              {t('home.deliver_to_label')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text variant="bodyStrong" weight={700} numberOfLines={1} style={{ flexShrink: 1, lineHeight: 22 }}>
                {placeText}
              </Text>
              <Icon name="chevron-down" size={16} color="text" strokeWidth={2.4} />
            </View>
          </View>
        </Pressable>
        {chip ? <PointsChip text={chip.text} /> : null}
      </View>
      {/* Keyed by the line, so a new hour (or a quiet day switched on) fades the new words in. */}
      <Animated.View key={key} entering={presets.fadeIn()}>
        <Text variant="voice" face="voice" numberOfLines={2} accessibilityRole="header" testID="home-greeting">
          {hello}
        </Text>
      </Animated.View>
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
