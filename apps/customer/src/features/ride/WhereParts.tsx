import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Icon, Skeleton, Text, useTheme, type IconName } from '@driver/ui';
import type { ThemeColorKey as ColorToken } from '@driver/design-tokens';
import { currentFix, photoUri } from '@/features/account/device';
import { useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { CITY_ID, rideEstimate, zoneTitle, type Spot } from './logic';
import { usePickQuote } from './queries';

// ───────────────────────── icons by kind (ride idea w8) ─────────────────────────

export function savedIcon(s: Pick<Spot, 'savedLabel'>): IconName {
  return s.savedLabel === 'home' ? 'home' : s.savedLabel === 'work' ? 'briefcase' : 'map-pin';
}

/** Each kind of place gets its own icon and tint, so a long list reads at a glance. */
export function spotLook(s: Spot): { icon: IconName; tint: ColorToken; ink: ColorToken } {
  if (s.kind === 'saved') return { icon: savedIcon(s), tint: 'accentTint', ink: 'accentText' };
  if (s.kind === 'recent') return { icon: 'clock', tint: 'surfaceSunken', ink: 'text' };
  if (s.kind === 'shop') return { icon: 'food', tint: 'warningTint', ink: 'warningText' };
  if (s.kind === 'landmark') {
    if (s.landmarkKind === 'garage') return { icon: 'garage', tint: 'infoTint', ink: 'infoText' };
    if (s.landmarkKind === 'meeting_point') return { icon: 'user', tint: 'accentTint', ink: 'accentText' };
    return { icon: 'flag', tint: 'successTint', ink: 'successText' };
  }
  return { icon: 'map-pin', tint: 'surfaceSunken', ink: 'text' };
}

/** A place in a list: its tinted icon (or the meeting point's photo, ride idea p3), name and zone. */
export function SpotRow({ spot, onPress }: { spot: Spot; onPress: () => void }) {
  const theme = useTheme();
  const look = spotLook(spot);
  const [photoOk, setPhotoOk] = useState(true);
  const photo = spot.photoUrl && photoOk ? photoUri(spot.photoUrl) : null;
  return (
    <Pressable
      testID={`ride-spot-${spot.id}`}
      accessibilityRole="button"
      accessibilityLabel={[spot.title, spot.subtitle].filter(Boolean).join('، ')}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[2], opacity: pressed ? 0.6 : 1 })}
    >
      {photo ? (
        <Image source={{ uri: photo }} onError={() => setPhotoOk(false)} accessibilityIgnoresInvertColors style={{ width: 52, height: 40, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSunken }} testID={`ride-spot-photo-${spot.id}`} />
      ) : (
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors[look.tint], alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={look.icon} size={19} color={look.ink} strokeWidth={2} />
        </View>
      )}
      <View style={{ flex: 1, borderBottomWidth: 1, borderBottomColor: theme.colors.border, paddingBottom: theme.space[2], minHeight: 44, justifyContent: 'center' }}>
        <Text variant="body" weight={500} numberOfLines={1}>
          {spot.title}
        </Text>
        {spot.subtitle ? (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {spot.subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="label" weight={600} color="textMuted" accessibilityRole="header">
          {title}
        </Text>
        {aside}
      </View>
      <View>{children}</View>
    </View>
  );
}

// ───────────────────────── smart picks with price (ride idea w2) ─────────────────────────

/** Three likely destinations as cards, each with the taxi price and the minutes from here. */
export function SmartPicks({ picks, pickup, onPick }: { picks: readonly Spot[]; pickup: Spot | null; onPick: (s: Spot) => void }) {
  const theme = useTheme();
  const t = useT();
  if (picks.length === 0) return null;
  return (
    <Section title={t('ride.picks_title')}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2], paddingVertical: 2 }} testID="ride-picks">
        {picks.map((s, i) => (
          <PickCard key={s.id} spot={s} pickup={pickup} index={i} onPress={() => onPick(s)} />
        ))}
      </ScrollView>
    </Section>
  );
}

function PickCard({ spot, pickup, index, onPress }: { spot: Spot; pickup: Spot | null; index: number; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  const quote = usePickQuote(pickup, spot);
  const minutes = pickup ? rideEstimate(pickup.pin, spot.pin, 'taxi', new Date()).minutes : null;
  const look = spotLook(spot);
  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeInDown.delay(60 * index).springify().damping(18)}>
      <Pressable
        testID={`ride-pick-${index}`}
        accessibilityRole="button"
        accessibilityLabel={[spot.title, quote.data ? `${amountParam(quote.data.total)} ${t('quote.currency')}` : null].filter(Boolean).join('، ')}
        onPress={() => {
          theme.haptic('selection');
          onPress();
        }}
        style={({ pressed }) => ({
          width: 148,
          minHeight: 104,
          padding: theme.space[3],
          gap: theme.space[1],
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: pressed ? theme.colors.accentTint : theme.colors.surface,
        })}
      >
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors[look.tint], alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={look.icon} size={17} color={look.ink} strokeWidth={2.1} />
        </View>
        <Text variant="label" weight={700} numberOfLines={1}>
          {spot.title}
        </Text>
        {quote.data ? (
          <Text variant="caption" color="textMuted" tabular numberOfLines={1} testID={`ride-pick-price-${index}`}>
            {minutes ? t('ride.pick_price', { amount: amountParam(quote.data.total), minutes }) : `${amountParam(quote.data.total)} ${t('quote.currency')}`}
          </Text>
        ) : quote.isPending && pickup ? (
          <Skeleton width={90} height={14} />
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

// ───────────────────────── home and work slots (ride idea w4) ─────────────────────────

/** البيت and الشغل always show; an empty one says «أضف الشغل» and opens the place editor. */
export function HomeWorkSlots({ saved, onPick }: { saved: readonly Spot[]; onPick: (s: Spot) => void }) {
  const theme = useTheme();
  const t = useT();
  const home = saved.find((s) => s.savedLabel === 'home');
  const work = saved.find((s) => s.savedLabel === 'work');
  const others = saved.filter((s) => s !== home && s !== work);
  const slot = (label: 'home' | 'work', s: Spot | undefined) =>
    s ? (
      <SlotChip key={label} icon={savedIcon(s)} title={s.title} sub={s.subtitle ?? null} onPress={() => onPick(s)} testID={`ride-saved-${s.id}`} />
    ) : (
      <SlotChip
        key={label}
        icon={label === 'home' ? 'home' : 'briefcase'}
        title={t(label === 'home' ? 'ride.add_home' : 'ride.add_work')}
        sub={null}
        empty
        onPress={() => router.push({ pathname: '/places/new', params: { label } })}
        testID={`ride-add-${label}`}
      />
    );
  return (
    <Section title={t('ride.saved_title')}>
      <View style={{ gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {slot('home', home)}
          {slot('work', work)}
        </View>
        {others.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {others.map((s) => (
              <SlotChip key={s.id} icon={savedIcon(s)} title={s.title} sub={s.subtitle ?? null} compact onPress={() => onPick(s)} testID={`ride-saved-${s.id}`} />
            ))}
          </View>
        ) : null}
      </View>
    </Section>
  );
}

function SlotChip({ icon, title, sub, empty = false, compact = false, onPress, testID }: { icon: IconName; title: string; sub: string | null; empty?: boolean; compact?: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, sub].filter(Boolean).join('، ')}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        flex: compact ? undefined : 1,
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        paddingHorizontal: theme.space[3],
        paddingVertical: theme.space[2],
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderStyle: empty ? 'dashed' : 'solid',
        borderColor: empty ? theme.colors.borderStrong : theme.colors.border,
        backgroundColor: pressed ? theme.colors.accentTint : empty ? 'transparent' : theme.colors.surface,
      })}
    >
      <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: empty ? theme.colors.surfaceSunken : theme.colors.accentTint }}>
        <Icon name={empty ? 'plus' : icon} size={16} color={empty ? 'textMuted' : 'accentText'} strokeWidth={2.2} />
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text variant="label" weight={600} color={empty ? 'textMuted' : 'text'} numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// ───────────────────────── «موقعي هسة» (ride idea w5) ─────────────────────────

/** Worse than this, the fix is too rough to send a driver to: the rider checks it on the map. */
export const WEAK_FIX_M = 120;

/**
 * The phone's position as the pickup: a GPS fix, the zone under it from the server. A weak fix
 * (> 120 m) still comes back, marked, so the screen can send the rider to the map to check it.
 */
export function useMyLocationSpot() {
  const t = useT();
  const locale = useLocale();
  const client = useApiClient();
  const [busy, setBusy] = useState(false);
  const locate = async (): Promise<{ spot: Spot; weak: boolean } | 'denied' | 'none' | 'outside'> => {
    setBusy(true);
    try {
      const fix = await currentFix();
      if (fix === 'denied') return 'denied';
      if (!fix) return 'none';
      const z = await client.places.zoneFor.query({ cityId: CITY_ID, pin: fix.pin }).catch(() => null);
      if (!z?.zoneId || !z.inService) return 'outside';
      const spot: Spot = {
        id: `here:${fix.pin.lat.toFixed(5)},${fix.pin.lng.toFixed(5)}`,
        kind: 'pin',
        title: t('ride.my_location'),
        subtitle: zoneTitle(z.zoneId, locale === 'en' ? 'en' : 'ar-IQ'),
        zoneId: z.zoneId,
        pin: fix.pin,
      };
      return { spot, weak: fix.accuracyM === null || fix.accuracyM > WEAK_FIX_M };
    } finally {
      setBusy(false);
    }
  };
  return { locate, busy };
}

// ───────────────────────── swap (ride idea w6) ─────────────────────────

/** Swaps from and to: a half turn and a light tap. */
export function SwapButton({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  const theme = useTheme();
  const t = useT();
  const turn = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  return (
    <Pressable
      testID="ride-swap"
      accessibilityRole="button"
      accessibilityLabel={t('ride.swap')}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        theme.haptic('light');
        if (!theme.reduceMotion) turn.value = withSequence(withTiming(turn.value + 180, { duration: 220 }), withSpring(turn.value + 180));
        onPress();
      }}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.colors.accentTint : theme.colors.surfaceSunken,
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Animated.View style={style}>
        <Icon name="swap" size={20} color="text" strokeWidth={2.2} />
      </Animated.View>
    </Pressable>
  );
}

// ───────────────────────── the zones, folded (ride idea w8) ─────────────────────────

export function ZonesFold({ count, open, onToggle, children }: { count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ gap: theme.space[2] }}>
      <Pressable
        testID="ride-zones-toggle"
        accessibilityRole="button"
        aria-expanded={open}
        onPress={onToggle}
        style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[2], opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="map-pin" size={19} color="text" strokeWidth={2} />
        </View>
        <Text variant="body" weight={600} style={{ flex: 1 }}>
          {t('ride.zones_all', { count })}
        </Text>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <Icon name="chevron-down" size={18} color="textMuted" strokeWidth={2.2} />
        </View>
      </Pressable>
      {open ? children : null}
    </View>
  );
}
