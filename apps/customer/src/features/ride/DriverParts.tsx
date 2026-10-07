import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { LOUD_FEATURES, sortFeatures, VEHICLE_COLOUR_HEX, vehicleColourKey, type CourierCard, type VehicleColour, type VehicleFeature } from '@driver/contracts';
import { pluralKey } from '@driver/i18n';
import type { IconName } from '@driver/ui';
import { Avatar, Icon, PlateChip, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';

const FEATURE_ICON: Record<VehicleFeature, IconName | null> = {
  ac: 'snow',
  heating: 'flame',
  family: 'family',
  no_smoking: null,
  big_boot: 'bag',
  child_seat: 'seat',
};

/** The car's paint as a dot beside its model (ride idea d1): the real colour, ringed so white shows on cream. */
export function ColourDot({ colour, size = 12 }: { colour: VehicleColour; size?: number }) {
  const theme = useTheme();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: VEHICLE_COLOUR_HEX[colour], borderWidth: 1, borderColor: theme.colors.borderStrong }} />;
}

/** "كورولا ● أبيض": the model, then the colour as a dot and a word (ride ideas d1, n3). */
export function CarLine({ model, colour, fallback, testID }: { model: string | null; colour: VehicleColour | null; fallback?: string | null; testID?: string }) {
  const t = useT();
  if (!model && !colour) {
    return fallback ? (
      <Text variant="footnote" color="textMuted" numberOfLines={1} testID={testID}>
        {fallback}
      </Text>
    ) : null;
  }
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
      {model ? (
        <Text variant="footnote" weight={600} numberOfLines={1} style={{ flexShrink: 1 }}>
          {model}
        </Text>
      ) : null}
      {colour ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <ColourDot colour={colour} />
          <Text variant="footnote" color="textMuted">
            {t(vehicleColourKey(colour))}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Ride ideas n1/n2: what the car offers, as small tags. AC («مكيّفة», cool) and heating («تدفئة», warm)
 * are coloured and come first; the quiet ones («عوائل», «ممنوع التدخين», «صندوق كبير», «مقعد طفل») are
 * plain. Only features ops confirmed at the car check ever reach the app.
 */
export function FeatureTags({ features, max, testID }: { features: readonly VehicleFeature[]; max?: number; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const shown = sortFeatures(features).slice(0, max ?? features.length);
  if (shown.length === 0) return null;
  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {shown.map((f) => {
        const loud = LOUD_FEATURES.includes(f);
        const bg = f === 'ac' ? theme.colors.infoTint : f === 'heating' ? theme.colors.accentTint : theme.colors.surfaceSunken;
        const ink = f === 'ac' ? 'infoText' : f === 'heating' ? 'accentText' : 'textMuted';
        const icon = FEATURE_ICON[f];
        return (
          <View key={f} testID={testID ? `${testID}-${f}` : undefined} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 24, paddingHorizontal: 8, borderRadius: 12, backgroundColor: bg }}>
            {icon ? <Icon name={icon} size={13} color={ink} strokeWidth={loud ? 2.2 : 1.9} /> : null}
            <Text variant="caption" weight={loud ? 700 : 500} color={ink}>
              {t(`vehicle.feature.${f}`)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** "★ 4.9 · 1,240 مشوار" (ride ideas d1, n3); "جديد" until he has enough ratings. */
export function RatingLine({ rating, tripCount }: { rating: number | null; tripCount: number }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon name="star" size={14} color="star" fillColor="star" filled />
      <Text variant="footnote" weight={700} tabular>
        {rating !== null ? rating.toFixed(1) : t('track.rating_new')}
      </Text>
      {tripCount > 0 ? (
        <>
          <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.colors.textMuted }} />
          <Text variant="footnote" color="textMuted" tabular>
            {t(pluralKey('ride.trip_count', tripCount), { n: tripCount.toLocaleString('en-US') })}
          </Text>
        </>
      ) : null}
    </View>
  );
}

/**
 * Ride idea d1: the driver as the rider meets him — a big photo, his name, ★ rating and trips, the
 * car model with its real colour, the plate drawn like an Iraqi plate, and the car's tags. Tapping it
 * opens his profile (n5). The buttons (chat, call, share) sit at its end.
 */
export function DriverHero({ courier, onOpen, trailing }: { courier: CourierCard; onOpen?: () => void; trailing?: ReactNode }) {
  const theme = useTheme();
  const t = useT();
  const name = courier.firstName ?? t('track.driver_fallback');
  return (
    <View testID="driver-hero" style={{ gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Pressable
          testID="driver-hero-open"
          accessibilityRole="button"
          accessibilityLabel={t('ride.profile_open', { name })}
          disabled={!onOpen}
          onPress={onOpen}
          style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], opacity: pressed ? 0.7 : 1 })}
        >
          <Avatar name={name} uri={apiPhoto(courier.photoUrl) ?? undefined} size={72} ring={Boolean(courier.verifiedTodayAt)} />
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Text variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>
                {name}
              </Text>
              {courier.verifiedTodayAt ? <Icon name="shield" size={16} color="successText" strokeWidth={2.2} accessibilityLabel={t('trip.verified_today')} /> : null}
            </View>
            <RatingLine rating={courier.rating} tripCount={courier.tripCount} />
            <CarLine model={courier.vehicleModel} colour={courier.vehicleColour} fallback={courier.vehicleLabel} />
          </View>
        </Pressable>
        {trailing ? <View style={{ flexDirection: 'row', gap: theme.space[2] }}>{trailing}</View> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space[3] }}>
        {courier.plate ? <PlateChip plate={courier.plate} accessibilityLabel={t('driver.plate')} size="lg" testID="driver-hero-plate" /> : null}
        <FeatureTags features={courier.features} testID="driver-hero-tags" />
      </View>
    </View>
  );
}
