import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { Chip, Icon, IconButton, Text, useTheme, useToast, type IconName } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { RideHabitsStrip } from '@/features/ride-habits/Strip';
import { isRideVertical, searchSpots, tooClose, type Spot } from '@/features/ride/logic';
import { rideStore, useRideStore } from '@/features/ride/store';
import { useRideSpots } from '@/features/ride/useSpots';
import { useT } from '@/lib/i18n';
import { color as palette } from '@driver/design-tokens';

type Field = 'pickup' | 'dropoff';

/**
 * "وين رايح؟" (customer spec §5): pickup (the deliver-to place by default) and destination, one
 * search over saved places, recent trips, landmarks and the 34 zones, or a pin on the map. Picking
 * the destination opens the choose-ride screen.
 */
export default function RideWhereTo() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const params = useLocalSearchParams<{ vertical?: string; field?: string }>();
  const ride = useRideStore();
  const { sources, defaultPickup } = useRideSpots();
  const draft = ride.draft;
  const pickup = draft.pickup ?? defaultPickup;
  const [field, setField] = useState<Field>(
    params.field === 'pickup' || !pickup ? 'pickup' : 'dropoff',
  );
  const [query, setQuery] = useState('');
  const input = useRef<TextInput>(null);

  useEffect(() => {
    if (isRideVertical(params.vertical) && params.vertical !== draft.vertical && !draft.dropoff)
      rideStore.update({ vertical: params.vertical });
    // Only on arrival from home.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(id);
  }, [field]);

  const results = useMemo(() => searchSpots(query, sources), [query, sources]);

  const choose = (spot: Spot) => {
    setQuery('');
    if (field === 'pickup') {
      rideStore.update({ pickup: spot });
      if (draft.dropoff && !tooClose(spot, draft.dropoff)) {
        router.push('/ride/choose');
        return;
      }
      setField('dropoff');
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

      {/* The two ends of the trip, joined like a route. */}
      <View
        style={{
          borderRadius: theme.radius.xl,
          backgroundColor: theme.colors.surface,
          paddingVertical: theme.space[2],
          paddingHorizontal: theme.space[3],
          shadowColor: palette.neutral[1000],
          shadowOpacity: 0.07,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
        }}
      >
        <EndRow
          kind="pickup"
          label={t('ride.from')}
          active={field === 'pickup'}
          value={
            pickup
              ? `${pickup.title}${pickup.subtitle && pickup.kind === 'saved' ? ` · ${pickup.subtitle}` : ''}`
              : null
          }
          placeholder={t('ride.search_pickup')}
          query={query}
          onQuery={setQuery}
          onActivate={() => {
            setQuery('');
            setField('pickup');
          }}
          inputRef={field === 'pickup' ? input : undefined}
          testID="ride-pickup"
        />
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 28, alignItems: 'center' }}>
            <View
              style={{
                width: 2,
                height: 14,
                borderRadius: 1,
                backgroundColor: theme.colors.border,
              }}
            />
          </View>
          <View
            style={{
              flex: 1,
              height: 1,
              backgroundColor: theme.colors.border,
              marginStart: theme.space[2],
            }}
          />
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
            setQuery('');
            setField('dropoff');
          }}
          inputRef={field === 'dropoff' ? input : undefined}
          testID="ride-dropoff"
        />
      </View>

      {query.trim() ? (
        <View style={{ gap: theme.space[1] }} testID="ride-results">
          {results.map((s) => (
            <SpotRow key={s.id} spot={s} onPress={() => choose(s)} />
          ))}
          {results.length === 0 ? (
            <Text
              color="textMuted"
              style={{ paddingVertical: theme.space[2] }}
              testID="ride-no-results"
            >
              {t('ride.no_results', { query: query.trim() })}
            </Text>
          ) : null}
          <ActionRow
            icon="map-pin"
            title={t('ride.on_map')}
            subtitle={t('ride.on_map_hint')}
            onPress={onMap}
            testID="ride-on-map"
          />
        </View>
      ) : (
        <>
          {/* Joy J7d: regular trips asking now, the last good driver, «رحلاتي الثابتة». */}
          <RideHabitsStrip kind="ride" />

          {sources.saved.length > 0 ? (
            <Section title={t('ride.saved_title')}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                {sources.saved.map((s) => (
                  <Chip
                    key={s.id}
                    role="button"
                    label={s.title}
                    icon={savedIcon(s)}
                    onPress={() => choose(s)}
                    testID={`ride-saved-${s.id}`}
                  />
                ))}
              </View>
            </Section>
          ) : null}

          <ActionRow
            icon="map-pin"
            title={t('ride.on_map')}
            subtitle={t('ride.on_map_hint')}
            onPress={onMap}
            testID="ride-on-map"
          />

          {ride.recent.length > 0 ? (
            <Section title={t('ride.recent_title')}>
              {ride.recent.map((s) => (
                <SpotRow key={s.id} spot={s} onPress={() => choose(s)} />
              ))}
            </Section>
          ) : null}

          {sources.landmarks.length > 0 ? (
            <Section title={t('ride.landmarks_title')}>
              {sources.landmarks.map((s) => (
                <SpotRow key={s.id} spot={s} onPress={() => choose(s)} />
              ))}
            </Section>
          ) : null}

          <Section title={t('ride.zones_title')}>
            <View
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}
              testID="ride-zones"
            >
              {sources.zones.map((s) => (
                <Chip
                  key={s.id}
                  role="button"
                  label={s.title}
                  onPress={() => choose(s)}
                  testID={`ride-zone-${s.zoneId}`}
                />
              ))}
            </View>
          </Section>
        </>
      )}
    </Screen>
  );
}

function savedIcon(s: Spot): IconName {
  return s.savedLabel === 'home' ? 'home' : s.savedLabel === 'work' ? 'bag' : 'map-pin';
}

function spotIcon(s: Spot): IconName {
  if (s.kind === 'saved') return savedIcon(s);
  if (s.kind === 'recent') return 'clock';
  if (s.kind === 'landmark') return s.landmarkKind === 'garage' ? 'garage' : 'map-pin';
  return 'map-pin';
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" weight={600} color="textMuted" accessibilityRole="header">
        {title}
      </Text>
      <View>{children}</View>
    </View>
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
              borderColor: theme.colors.accent,
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

function SpotRow({ spot, onPress }: { spot: Spot; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={`ride-spot-${spot.id}`}
      accessibilityRole="button"
      accessibilityLabel={[spot.title, spot.subtitle].filter(Boolean).join('، ')}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingVertical: theme.space[2],
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: theme.colors.surfaceSunken,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={spotIcon(spot)} size={19} color="text" strokeWidth={2} />
      </View>
      <View
        style={{
          flex: 1,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          paddingBottom: theme.space[2],
          minHeight: 44,
          justifyContent: 'center',
        }}
      >
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

function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
  testID,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
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
