import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Chip, Icon, IconButton, Skeleton, Text, useTheme, useToast, type IconName } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { RideHabitsStrip } from '@/features/ride-habits/Strip';
import { isRideVertical, searchSpots, smartPicks, tooClose, type Spot } from '@/features/ride/logic';
import { useNearbyVehicles } from '@/features/ride/queries';
import { RideMap } from '@/features/ride/RideMap';
import { rideStore, useRideStore } from '@/features/ride/store';
import { useRideSpots } from '@/features/ride/useSpots';
import { HomeWorkSlots, Section, SmartPicks, SpotRow, SwapButton, useMyLocationSpot, ZonesFold } from '@/features/ride/WhereParts';
import { useT } from '@/lib/i18n';
import { color as palette } from '@driver/design-tokens';

type Field = 'pickup' | 'dropoff';

/** The live map the screen opens on (ride idea w1): you and the free cars around you. */
const MAP_H = 230;

/**
 * "وين رايح؟" (customer spec §5; ride ideas w1–w8, p3): opens on the live map of the pickup with the
 * free cars around it and the search card on top. Under it, three likely places with the price and
 * minutes, البيت and الشغل always shown, «موقعي هسة» for the pickup, recent trips, landmarks with an
 * icon by kind (and the meeting point's photo when there is one) and the 34 zones folded away. One
 * search covers saved places, recent trips, landmarks, restaurants and the zones, or a pin on the map.
 * Picking the destination opens the choose-ride screen.
 */
export default function RideWhereTo() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const params = useLocalSearchParams<{ vertical?: string; field?: string }>();
  const ride = useRideStore();
  const { sources, defaultPickup, landmarksLoading, landmarksFailed, retryLandmarks } = useRideSpots();
  const draft = ride.draft;
  const pickup = draft.pickup ?? defaultPickup;
  const [field, setField] = useState<Field>(params.field === 'pickup' || !pickup ? 'pickup' : 'dropoff');
  const fieldChosen = useRef(false);
  const [query, setQuery] = useState('');
  const [zonesOpen, setZonesOpen] = useState(false);
  const input = useRef<TextInput>(null);
  const here = useMyLocationSpot();
  const nearby = useNearbyVehicles(pickup?.pin ?? null, draft.vertical);

  useEffect(() => {
    if (isRideVertical(params.vertical) && params.vertical !== draft.vertical && !draft.dropoff) rideStore.update({ vertical: params.vertical });
    // Only on arrival from home.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opened before the deliver-to place loaded: once it does, the question is where to.
  useEffect(() => {
    if (pickup && !fieldChosen.current && params.field !== 'pickup') setField('dropoff');
    // Only when the pickup first becomes known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup !== null]);

  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(id);
  }, [field]);

  const results = useMemo(() => searchSpots(query, sources), [query, sources]);
  const picks = useMemo(
    () => (field === 'dropoff' ? smartPicks({ hour: new Date().getHours(), saved: sources.saved, recent: ride.recent, pickup }) : []),
    [field, sources.saved, ride.recent, pickup],
  );

  const choosePickup = (spot: Spot) => {
    rideStore.update({ pickup: spot });
    if (draft.dropoff && !tooClose(spot, draft.dropoff)) {
      router.push('/ride/choose');
      return;
    }
    setField('dropoff');
  };

  const choose = (spot: Spot) => {
    setQuery('');
    if (field === 'pickup') {
      choosePickup(spot);
      return;
    }
    if (pickup && tooClose(pickup, spot)) {
      toast.show({ message: t('ride.same_place'), tone: 'warning', icon: 'map-pin' });
      return;
    }
    rideStore.update({ dropoff: spot });
    if (pickup) router.push('/ride/choose');
    else setField('pickup');
  };

  const onMap = () => router.push({ pathname: '/ride/pin', params: { field } });

  const swap = () => {
    if (!pickup || !draft.dropoff) return;
    rideStore.update({ pickup: draft.dropoff, dropoff: pickup });
    setQuery('');
  };

  const pickMyLocation = async () => {
    const r = await here.locate();
    if (r === 'denied') toast.show({ message: t('error.location_denied'), tone: 'danger', icon: 'location-arrow' });
    else if (r === 'none') toast.show({ message: t('error.location_weak'), tone: 'danger', icon: 'location-arrow' });
    else if (r === 'outside') toast.show({ message: t('ride.my_location_outside'), tone: 'warning', icon: 'map-pin' });
    else if (r.weak) {
      // A rough fix would send the driver to the wrong street: the rider checks it on the map first.
      rideStore.update({ pickup: r.spot });
      toast.show({ message: t('ride.my_location_weak'), tone: 'warning', icon: 'location-arrow' });
      router.push({ pathname: '/ride/pin', params: { field: 'pickup' } });
    } else choosePickup(r.spot);
  };

  const showMap = pickup !== null && !query.trim();
  // The map frames the pickup with the three nearest free cars, so "you and the cars around you" both show.
  const nearFrame = useMemo(() => nearby.data?.vehicles.slice(0, 3).map((c) => ({ lat: c.lat, lng: c.lng })) ?? [], [nearby.data]);

  return (
    <Screen testID="ride-where" contentStyle={{ gap: theme.space[5] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <IconButton
          icon="chevron-back"
          variant="outline"
          accessibilityLabel={t('action.back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          testID="ride-back"
        />
        <Text variant="heading" accessibilityRole="header">
          {t('ride.where_title')}
        </Text>
      </View>

      <View>
        {showMap && pickup ? (
          <Animated.View
            entering={theme.reduceMotion ? undefined : FadeIn.duration(220)}
            exiting={theme.reduceMotion ? undefined : FadeOut.duration(160)}
            style={{ height: MAP_H, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}
          >
            <RideMap
              pickup={pickup.pin}
              dropoff={null}
              pickupLabel={t('ride.pickup_here')}
              dropoffLabel=""
              topInset={0}
              bottomInset={56}
              nearby={{ data: nearby.data, kind: draft.vertical === 'tuktuk' ? 'tuktuk' : 'car' }}
              frame={nearFrame}
              testID="ride-where-map"
            />
            {nearby.data?.nearestMinutes ? (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: theme.space[3],
                  start: theme.space[3],
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space[1],
                  paddingHorizontal: theme.space[3],
                  paddingVertical: 6,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.colors.surface,
                }}
                testID="ride-where-near"
              >
                <Icon name={draft.vertical === 'tuktuk' ? 'tuktuk' : 'car'} size={15} color="accentText" strokeWidth={2.2} />
                <Text variant="caption" weight={600} tabular>
                  {t('ride.near_short', { minutes: nearby.data.nearestMinutes })}
                </Text>
              </View>
            ) : null}
          </Animated.View>
        ) : null}

        {/* The two ends of the trip, joined like a route, over the map's lower edge. */}
        <View
          style={{
            marginTop: showMap ? -56 : 0,
            marginHorizontal: showMap ? theme.space[2] : 0,
            borderRadius: theme.radius.xl,
            backgroundColor: theme.colors.surface,
            paddingVertical: theme.space[2],
            paddingHorizontal: theme.space[3],
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[2],
            shadowColor: palette.neutral[1000],
            shadowOpacity: 0.1,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 6 },
            elevation: 4,
          }}
        >
          <View style={{ flex: 1 }}>
            <EndRow
              kind="pickup"
              label={t('ride.from')}
              active={field === 'pickup'}
              value={pickup ? `${pickup.title}${pickup.subtitle && pickup.kind === 'saved' ? ` · ${pickup.subtitle}` : ''}` : null}
              placeholder={t('ride.search_pickup')}
              query={query}
              onQuery={setQuery}
              onActivate={() => {
                fieldChosen.current = true;
                setQuery('');
                setField('pickup');
              }}
              inputRef={field === 'pickup' ? input : undefined}
              testID="ride-pickup"
            />
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 28, alignItems: 'center' }}>
                <View style={{ width: 2, height: 14, borderRadius: 1, backgroundColor: theme.colors.border }} />
              </View>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border, marginStart: theme.space[2] }} />
            </View>
            <EndRow
              kind="dropoff"
              label={t('ride.to')}
              active={field === 'dropoff'}
              value={draft.dropoff ? draft.dropoff.title : null}
              placeholder={t('ride.search_dropoff')}
              query={query}
              onQuery={setQuery}
              onActivate={() => {
                fieldChosen.current = true;
                setQuery('');
                setField('dropoff');
              }}
              inputRef={field === 'dropoff' ? input : undefined}
              testID="ride-dropoff"
            />
          </View>
          <SwapButton onPress={swap} disabled={!pickup || !draft.dropoff} />
        </View>
      </View>

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
          <ActionRow icon="map-pin" title={t('ride.on_map')} subtitle={t('ride.on_map_hint')} onPress={onMap} testID="ride-on-map" />
        </View>
      ) : (
        <>
          {field === 'pickup' ? (
            <ActionRow
              icon="location-arrow"
              title={t('ride.my_location')}
              subtitle={t(here.busy ? 'ride.my_location_busy' : 'ride.my_location_hint')}
              onPress={() => void pickMyLocation()}
              busy={here.busy}
              testID="ride-my-location"
            />
          ) : null}

          {/* Joy J7d: regular trips asking now, the last good driver, «رحلاتي الثابتة». */}
          <RideHabitsStrip kind="ride" />

          <SmartPicks picks={picks} pickup={pickup} onPick={choose} />

          <HomeWorkSlots saved={sources.saved} onPick={choose} />

          <ActionRow icon="map-pin" title={t('ride.on_map')} subtitle={t('ride.on_map_hint')} onPress={onMap} testID="ride-on-map" />

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
    </Screen>
  );
}

/** One end of the trip: a coloured marker, the label, and the place or the live search input. */
function EndRow({
  kind,
  label,
  active,
  value,
  placeholder,
  query,
  onQuery,
  onActivate,
  inputRef,
  testID,
}: {
  kind: Field;
  label: string;
  active: boolean;
  value: string | null;
  placeholder: string;
  query: string;
  onQuery: (q: string) => void;
  onActivate: () => void;
  inputRef?: Ref<TextInput>;
  testID: string;
}) {
  const theme = useTheme();
  const marker =
    kind === 'pickup' ? (
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: theme.colors.success,
          borderWidth: 3,
          borderColor: theme.colors.successTint,
        }}
      />
    ) : (
      <View
        style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: theme.colors.text }}
      />
    );
  return (
    <Pressable
      testID={testID}
      onPress={onActivate}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? placeholder}`}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: theme.space[2] }}
    >
      <View style={{ width: 28, alignItems: 'center' }}>{marker}</View>
      <Text variant="caption" weight={600} color="textMuted" style={{ width: 22 }}>
        {label}
      </Text>
      {active ? (
        <TextInput
          ref={inputRef}
          testID={`${testID}-input`}
          value={query}
          onChangeText={onQuery}
          placeholder={value ?? placeholder}
          placeholderTextColor={value ? theme.colors.text : theme.colors.textMuted}
          returnKeyType="search"
          autoCorrect={false}
          style={[
            {
              flex: 1,
              // Web inputs carry an intrinsic ~20ch width; let the row shrink them.
              minWidth: 0,
              height: 44,
              paddingHorizontal: theme.space[3],
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surfaceSunken,
              borderWidth: 1.5,
              borderColor: theme.colors.focusRing,
              color: theme.colors.text,
              fontSize: 15,
              // Native RTL swaps left/right (left = start); the web needs the physical side.
              textAlign: Platform.OS === 'web' && theme.isRTL ? 'right' : 'left',
              writingDirection: theme.direction,
              ...theme.font(500),
            },
            // Web: drop the UA focus outline; the field draws its own accent border.
            { outlineStyle: 'none' } as object,
          ]}
        />
      ) : (
        <Text
          variant="body"
          weight={value ? 500 : 400}
          color={value ? 'text' : 'textMuted'}
          numberOfLines={1}
          style={{ flex: 1, paddingHorizontal: theme.space[3] }}
        >
          {value ?? placeholder}
        </Text>
      )}
    </Pressable>
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
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: theme.colors.accentTint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
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
