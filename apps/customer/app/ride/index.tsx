import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LatLng } from '@driver/contracts';
import { color as palette } from '@driver/design-tokens';
import { Button, Chip, Icon, IconButton, Skeleton, Text, useTheme, useToast, type IconName } from '@driver/ui';
import { locationWeakToast } from '@/features/account/device';
import { nearestZone } from '@/features/account/geo';
import { PinPicker } from '@/features/places/PinPicker';
import { RideHabitsStrip } from '@/features/ride-habits/Strip';
import { isRideVertical, searchSpots, smartPicks, tooClose, zoneTitle, type Spot } from '@/features/ride/logic';
import { nearestNamed, quickPlaces, spotAtPin, type RideStep } from '@/features/ride/map-steps';
import { PinBubble, PlaceChip, SearchBox, StepDots } from '@/features/ride/MapSteps';
import { useNearbyVehicles, useZoneFor } from '@/features/ride/queries';
import { rideStore, useRideStore } from '@/features/ride/store';
import { useRideSpots } from '@/features/ride/useSpots';
import { FromDot, MeDot, RouteToPin, useKeptRoads, useLiveRoute } from '@/features/ride/RouteToPin';
import { useGrantedPosition } from '@/features/ride/phone-position';
import type { WalkRoad } from '@/features/ride/walk-stop';
import type { CameraValues } from '@/features/track/map/types';
import type { Size } from '@/features/track/geo';
import type { SharedValue } from 'react-native-reanimated';
import { HomeWorkSlots, savedIcon, Section, SmartPicks, SpotRow, useMyLocationSpot, ZonesFold } from '@/features/ride/WhereParts';
import { useLocale, useT } from '@/lib/i18n';

const CENTRE: LatLng = { lat: 32.905, lng: 45.06 };
/** Close enough to read a door: the steps open here, where the houses show their windows (the pin picker's own default is a wider 15.2). */
const STEP_ZOOM = 17;
const PIN_SETTLE_MS = 1_500;
/** Step 2 opens a little wider, so the line from the pickup has streets to run along. */
const DROPOFF_ZOOM = 15.6;

/**
 * "منين نجيك؟ / وين رايح؟", map-led (Ali 2026-10-17, the "Mix" concept): the day map fills the screen
 * and asks one thing at a time. First the pickup under the fixed pin («اركب من هنا»), then the
 * drop-off («نزّلني هنا»), each with «هنا، تمام»; the big search box opens one search over saved
 * places, recent trips, landmarks, restaurants and the zones (with «موقعي هسة», the habits strip,
 * the smart picks and البيت/الشغل when nothing is typed). The quick places under the box pick in one
 * tap. The drop-off opens the choose screen, where taxi or tuktuk is the third step. The area under
 * the pin comes from the server (`places.zoneFor`): it prices the ride, so «هنا، تمام» waits for it.
 */
export default function RideWhereTo() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const locale = useLocale();
  const lang = locale === 'en' ? 'en' : 'ar-IQ';
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const scale = Math.max(1, fontScale);
  const params = useLocalSearchParams<{ vertical?: string }>();
  const ride = useRideStore();
  const { sources, defaultPickup, landmarksLoading, landmarksFailed, retryLandmarks } = useRideSpots();
  const draft = ride.draft;
  const pickup = draft.pickup ?? defaultPickup;
  const [step, setStep] = useState<RideStep>('pickup');
  const [start] = useState<LatLng>(() => pickup?.pin ?? CENTRE);
  const [pin, setPin] = useState<LatLng>(start);
  const [moving, setMoving] = useState(false);
  const [recentre, setRecentre] = useState<{ pin: LatLng; seq: number; zoom?: number } | null>(null);
  const touched = useRef(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [zonesOpen, setZonesOpen] = useState(false);
  const input = useRef<TextInput>(null);
  const here = useMyLocationSpot();
  const phone = useGrantedPosition();
  const [me, setMe] = useState<LatLng | null>(null);
  // No dot when the phone could not say (grantedPosition never throws; isError is only a guard).
  const meAt = me ?? (phone.isError ? null : phone.data) ?? null;
  // Every street the map has drawn in this visit: the pickup's streets stay known after the camera left them.
  const [roads, addRoads] = useKeptRoads();
  const nearby = useNearbyVehicles(pickup?.pin ?? null, draft.vertical);
  const zone = useZoneFor(pin);
  const z = zone.data;
  const zoneId = z?.zoneId ?? null;
  const outside = z ? !z.inService : false;
  const fresh = !zone.isPlaceholderData && !zone.isFetching;
  // FLOW-28: the server could not say which area the pin is in (offline, a blip): say so, and retry.
  const zoneFailed = zone.isError && !zone.isFetching;

  useEffect(() => {
    if (isRideVertical(params.vertical) && params.vertical !== draft.vertical && !draft.dropoff) rideStore.update({ vertical: params.vertical });
    // Only on arrival from home.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The deliver-to place loaded after the map opened: the pin goes there, unless he already moved it.
  useEffect(() => {
    if (pickup && step === 'pickup' && !touched.current) setRecentre({ pin: pickup.pin, seq: Date.now() });
    // Only when the pickup first becomes known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup !== null]);

  // VIS-21: a touch that lifts the pin but never moves the camera sends no "settled": settle after 1.5 s.
  useEffect(() => {
    if (!moving) return;
    const id = setTimeout(() => setMoving(false), PIN_SETTLE_MS);
    return () => clearTimeout(id);
  }, [moving, pin]);

  useEffect(() => {
    if (!searching) return;
    const id = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(id);
  }, [searching]);

  const results = useMemo(() => searchSpots(query, sources), [query, sources]);
  const picks = useMemo(
    () => (step === 'dropoff' ? smartPicks({ hour: new Date().getHours(), saved: sources.saved, recent: ride.recent, pickup }) : []),
    [step, sources.saved, ride.recent, pickup],
  );
  const named = useMemo(() => nearestNamed(pin, [...sources.landmarks, ...(sources.shops ?? [])]), [pin, sources.landmarks, sources.shops]);
  const shownZone = zoneId ?? (z ? null : nearestZone(pin));
  const keep = step === 'pickup' ? pickup : draft.dropoff;
  const here_ = shownZone
    ? spotAtPin({ pin, zoneId: shownZone, keep, named, zoneName: zoneTitle(shownZone, lang), nearLabel: (place) => t('ride.map_near', { place }), pinLabel: t('ride.pin_spot') })
    : null;
  const quick = useMemo(
    () => (step === 'dropoff' ? quickPlaces({ picks, saved: sources.saved, recent: ride.recent, pickup }) : sources.saved.filter((s) => s.savedLabel === 'home' || s.savedLabel === 'work').slice(0, 2)),
    [step, picks, sources.saved, ride.recent, pickup],
  );

  const moveTo = (p: LatLng) => {
    touched.current = true;
    setRecentre({ pin: p, seq: Date.now() });
  };

  const toDropoff = (from: Spot) => {
    setStep('dropoff');
    // A step back from the door: room for the street line from the pickup to the pin.
    setRecentre({ pin: draft.dropoff && !tooClose(from, draft.dropoff) ? draft.dropoff.pin : from.pin, seq: Date.now(), zoom: DROPOFF_ZOOM });
  };

  const closeSearch = () => {
    setSearching(false);
    setQuery('');
  };

  /** A place picked from the search or the quick places. */
  const choose = (spot: Spot) => {
    closeSearch();
    if (step === 'pickup') {
      rideStore.update({ pickup: spot });
      toDropoff(spot);
      return;
    }
    if (pickup && tooClose(pickup, spot)) {
      toast.show({ message: t('ride.same_place'), tone: 'warning', icon: 'map-pin' });
      return;
    }
    rideStore.update({ dropoff: spot });
    router.push('/ride/choose');
  };

  /** «هنا، تمام»: the place under the pin. */
  const confirm = () => {
    if (!zoneId || !here_) return;
    const spot = spotAtPin({ pin, zoneId, keep, named, zoneName: zoneTitle(zoneId, lang), nearLabel: (place) => t('ride.map_near', { place }), pinLabel: t('ride.pin_spot') });
    if (step === 'pickup') {
      rideStore.update({ pickup: spot });
      toDropoff(spot);
      return;
    }
    if (pickup && tooClose(pickup, spot)) {
      toast.show({ message: t('ride.same_place'), tone: 'warning', icon: 'map-pin' });
      return;
    }
    rideStore.update({ dropoff: spot });
    router.push('/ride/choose');
  };

  const back = () => {
    if (searching) closeSearch();
    else if (step === 'dropoff') {
      setStep('pickup');
      if (pickup) setRecentre({ pin: pickup.pin, seq: Date.now(), zoom: STEP_ZOOM });
    } else if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const pickMyLocation = async () => {
    const r = await here.locate();
    if (r === 'denied') toast.show({ message: t('error.location_denied'), tone: 'danger', icon: 'location-arrow' });
    else if (r === 'none') toast.show({ ...locationWeakToast(t), icon: 'location-arrow' });
    else if (r === 'outside') toast.show({ message: t('ride.my_location_outside'), tone: 'warning', icon: 'map-pin' });
    if (typeof r !== 'object') return;
    setMe(r.spot.pin);
    if (r.weak) {
      // A rough fix would send the driver to the wrong street: the pin goes there and he checks it.
      closeSearch();
      moveTo(r.spot.pin);
      toast.show({ message: t('ride.my_location_weak'), tone: 'warning', icon: 'location-arrow' });
    } else choose(r.spot);
  };

  const placeLine = moving ? (
    <Text color="textMuted" numberOfLines={1}>
      {t('ride.pin_moving')}
    </Text>
  ) : zoneFailed ? (
    <Text variant="bodyStrong" color="dangerText" numberOfLines={1} testID="ride-map-zone-failed">
      {t('ride.pin_zone_failed')}
    </Text>
  ) : outside && fresh ? (
    <Text variant="bodyStrong" color="warningText" numberOfLines={1} testID="ride-map-outside">
      {t('ride.pin_out_of_service')}
    </Text>
  ) : here_ ? (
    <Text variant="title" weight={700} numberOfLines={1} testID="ride-map-place">
      {here_.title}
    </Text>
  ) : (
    <Skeleton width={160} height={22} />
  );

  return (
    <View testID="ride-where" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1 }}>
        <PinPicker
          initial={start}
          zoom={STEP_ZOOM}
          onCentre={setPin}
          onMoving={(m) => {
            if (m) touched.current = true;
            setMoving(m);
          }}
          recentre={recentre}
          tone={step}
          onRoads={addRoads}
          under={(cam, size) => (
            <MapUnder cam={cam} size={size} me={meAt} from={step === 'dropoff' && pickup ? pickup.pin : null} roads={roads} service={draft.vertical === 'tuktuk' ? 'tuktuk' : 'taxi'} />
          )}
          testID="ride-where-map"
        />
        <PinBubble label={t(step === 'pickup' ? 'ride.map_pickup_bubble' : 'ride.map_dropoff_bubble')} hidden={moving} />
        <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + theme.space[3], left: theme.space[4], right: theme.space[4], flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <IconButton icon="chevron-back" variant="outline" accessibilityLabel={t('action.back')} onPress={back} style={{ backgroundColor: theme.colors.surface }} testID="ride-back" />
          {step === 'pickup' && nearby.data?.nearestMinutes ? (
            <Animated.View
              entering={theme.reduceMotion ? undefined : FadeIn.duration(220)}
              exiting={theme.reduceMotion ? undefined : FadeOut.duration(160)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1], paddingHorizontal: theme.space[3], minHeight: 36, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface }}
              testID="ride-where-near"
            >
              <Icon name={draft.vertical === 'tuktuk' ? 'tuktuk' : 'car'} size={15} color="accentText" strokeWidth={2.2} />
              <Text variant="caption" weight={600} tabular>
                {t('ride.near_short', { minutes: nearby.data.nearestMinutes })}
              </Text>
            </Animated.View>
          ) : null}
        </View>
      </View>

      <View
        testID={`ride-step-${step}`}
        style={{
          marginTop: -theme.space[5],
          paddingTop: theme.space[4],
          paddingHorizontal: theme.space[5],
          paddingBottom: Math.max(insets.bottom, theme.space[4]),
          gap: theme.space[3],
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
        {/* The locate button rides on the sheet's top edge, at the map's corner. */}
        <View pointerEvents="box-none" style={{ position: 'absolute', top: -(44 + theme.space[3]), left: theme.space[4] }}>
          <IconButton icon="location-arrow" variant="outline" accessibilityLabel={t('place.use_my_location')} onPress={() => void pickMyLocation()} disabled={here.busy} style={{ backgroundColor: theme.colors.surface }} testID="ride-locate" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[2] }}>
          <StepDots step={step === 'pickup' ? 1 : 2} testID="ride-steps" />
          {step === 'dropoff' && pickup ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`${t('ride.map_from', { place: pickup.title })}، ${t('ride.map_change')}`} onPress={back} hitSlop={8} testID="ride-from" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minHeight: 32 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.success }} />
              <Text variant="caption" weight={600} numberOfLines={1} style={{ flexShrink: 1 }}>
                {t('ride.map_from', { place: pickup.title })}
              </Text>
              <Text variant="caption" weight={700} color="accentText">
                {t('ride.map_change')}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={{ gap: 2 }}>
          <Text variant="heading" face="display" accessibilityRole="header">
            {step === 'pickup' ? t('ride.map_pickup_title') : t('ride.where_title')}
          </Text>
          {/* Fixed line heights: a sheet that grows while the map is dragged would resize the map and drop the drag. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], height: Math.ceil(30 * scale) }} accessibilityLiveRegion="polite">
            <View style={step === 'pickup' ? { width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.success } : { width: 12, height: 12, borderRadius: 3, backgroundColor: theme.colors.accent }} />
            <View style={{ flex: 1 }}>{placeLine}</View>
          </View>
          <Text variant="caption" color="textMuted" numberOfLines={1} style={{ height: Math.ceil(20 * scale) }}>
            {zoneFailed ? t('ride.pin_zone_failed_hint') : t(step === 'pickup' ? 'ride.map_hint_pickup' : 'ride.map_hint_dropoff')}
          </Text>
        </View>

        <SearchBox placeholder={t(step === 'pickup' ? 'ride.map_search_pickup' : 'ride.map_search_dropoff')} onPress={() => setSearching(true)} testID="ride-search" />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: theme.space[2] }} style={{ flexGrow: 0, marginHorizontal: -theme.space[5] }} contentInset={{ left: 0, right: 0 }}>
          <View style={{ width: theme.space[5] - theme.space[2] }} />
          {step === 'pickup' ? <PlaceChip label={t('ride.my_location')} icon="location-arrow" busy={here.busy} onPress={() => void pickMyLocation()} testID="ride-my-location" /> : null}
          {quick.map((s) => (
            <PlaceChip key={s.id} label={s.title} icon={s.kind === 'saved' ? savedIcon(s) : s.kind === 'recent' ? 'clock' : undefined} onPress={() => choose(s)} testID={`ride-quick-${s.id}`} />
          ))}
          <View style={{ width: theme.space[5] - theme.space[2] }} />
        </ScrollView>

        {zoneFailed && !moving ? (
          <Button testID="ride-map-retry" size="lg" variant="secondary" icon="refresh" fullWidth label={t('action.retry')} onPress={() => void zone.refetch()} />
        ) : (
          <Button testID="ride-map-confirm" size="lg" fullWidth label={t('ride.map_confirm')} disabled={moving || !zoneId || outside || !fresh} haptic="success" onPress={confirm} />
        )}
      </View>

      {searching ? (
        <Animated.View
          entering={theme.reduceMotion ? FadeIn.duration(120) : SlideInDown.duration(260)}
          exiting={theme.reduceMotion ? FadeOut.duration(120) : SlideOutDown.duration(200)}
          testID="ride-search-panel"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            top: insets.top + 72,
            backgroundColor: theme.colors.bg,
            borderTopLeftRadius: theme.radius['2xl'],
            borderTopRightRadius: theme.radius['2xl'],
            shadowColor: palette.neutral[1000],
            shadowOpacity: 0.16,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: -6 },
            elevation: 14,
          }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, marginTop: theme.space[2] }} />
          <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[3], paddingBottom: theme.space[2] }}>
            <SearchBox
              placeholder={t(step === 'pickup' ? 'ride.map_search_pickup' : 'ride.map_search_dropoff')}
              value={query}
              onChangeText={setQuery}
              onClear={closeSearch}
              focused
              inputRef={input}
              testID="ride-search-input"
            />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingBottom: Math.max(insets.bottom, theme.space[6]), gap: theme.space[5] }}>
            {query.trim() ? (
              <View style={{ gap: theme.space[1] }} testID="ride-results">
                {results.map((s) => (
                  <SpotRow key={s.id} spot={s} onPress={() => choose(s)} />
                ))}
                {results.length === 0 ? (
                  <Text color="textMuted" style={{ paddingVertical: theme.space[2] }} testID="ride-no-results">
                    {t('ride.no_results', { query: query.trim() })}
                  </Text>
                ) : null}
                <ActionRow icon="map-pin" title={t('ride.on_map')} subtitle={t('ride.on_map_hint')} onPress={closeSearch} testID="ride-on-map" />
              </View>
            ) : (
              <>
                {step === 'pickup' ? (
                  <ActionRow
                    icon="location-arrow"
                    title={t('ride.my_location')}
                    subtitle={t(here.busy ? 'ride.my_location_busy' : 'ride.my_location_hint')}
                    onPress={() => void pickMyLocation()}
                    busy={here.busy}
                    testID="ride-search-my-location"
                  />
                ) : (
                  <>
                    {/* Joy J7d: regular trips asking now, the last good driver, «رحلاتي الثابتة». */}
                    <RideHabitsStrip kind="ride" />
                    <SmartPicks picks={picks} pickup={pickup} onPick={choose} />
                  </>
                )}

                <HomeWorkSlots saved={sources.saved} onPick={choose} />

                {ride.recent.length > 0 ? (
                  <Section title={t('ride.recent_title')}>
                    {ride.recent.map((s) => (
                      <SpotRow key={s.id} spot={s} onPress={() => choose(s)} />
                    ))}
                  </Section>
                ) : null}

                {/* VIS-41: known places say they are loading, or that they didn't load with a retry, instead of just missing. */}
                {sources.landmarks.length > 0 ? (
                  <Section title={t('ride.landmarks_title')}>
                    {sources.landmarks.map((s) => (
                      <SpotRow key={s.id} spot={s} onPress={() => choose(s)} />
                    ))}
                  </Section>
                ) : landmarksLoading ? (
                  <Section title={t('ride.landmarks_title')}>
                    <View style={{ gap: theme.space[3], paddingVertical: theme.space[2] }} testID="ride-landmarks-loading">
                      {[0, 1, 2].map((i) => (
                        <Skeleton key={i} height={40} />
                      ))}
                    </View>
                  </Section>
                ) : landmarksFailed ? (
                  <Section title={t('ride.landmarks_title')}>
                    <Pressable accessibilityRole="button" onPress={retryLandmarks} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 44 }} testID="ride-landmarks-failed">
                      <Icon name="refresh" size={18} color="textMuted" />
                      <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
                        {t('ride.landmarks_failed')} · {t('action.retry')}
                      </Text>
                    </Pressable>
                  </Section>
                ) : null}

                <ZonesFold count={sources.zones.length} open={zonesOpen} onToggle={() => setZonesOpen((o) => !o)}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }} testID="ride-zones">
                    {sources.zones.map((s) => (
                      <Chip key={s.id} role="button" label={s.title} onPress={() => choose(s)} testID={`ride-zone-${s.zoneId}`} />
                    ))}
                  </View>
                </ZonesFold>
              </>
            )}
          </ScrollView>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Under the centre pin: where the phone is, and in step 2 the street line from the pickup to the pin. */
function MapUnder({ cam, size, me, from, roads, service }: { cam: CameraValues; size: SharedValue<Size>; me: LatLng | null; from: LatLng | null; roads: WalkRoad[]; service: 'taxi' | 'tuktuk' }) {
  const t = useT();
  const route = useLiveRoute(cam, from ? [from.lng, from.lat] : null, roads);
  return (
    <>
      {from ? <RouteToPin cam={cam} size={size} route={route} service={service} kmLabel={(km) => t('ride.route_km', { km })} mLabel={(m) => t('ride.route_m', { m })} /> : null}
      {/* The pickup above the phone's dot: in step 2 it is where the line starts. */}
      {me ? <MeDot cam={cam} size={size} at={me} /> : null}
      {from ? <FromDot cam={cam} size={size} at={from} /> : null}
    </>
  );
}

function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
  busy = false,
  testID,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  busy?: boolean;
  testID: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[3],
        borderRadius: theme.radius.lg,
        backgroundColor: pressed ? theme.colors.accentTint : theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
      })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color="accentText" strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" color="textMuted">
          {subtitle}
        </Text>
      </View>
      <Icon name="chevron-forward" size={18} color="textMuted" />
    </Pressable>
  );
}
