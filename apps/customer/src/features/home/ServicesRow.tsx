import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { G } from 'react-native-svg';
import { AZIZIYAH_ZONES, type IntercityDirection, type LatLng, type LaunchService } from '@driver/contracts';
import { lift, type ServiceSwatch } from '@driver/design-tokens';
import type { MessageKey } from '@driver/i18n';
import { CornerFill, DishDrawing, DotHalo, DownFill, Icon, MeshFill, Skeleton, StarPattern, Text, useNetwork, useTheme, withAlpha, type IconName } from '@driver/ui';
import { boardSummary, clockLabel, PRIMARY_CORRIDOR } from '@/features/rajaa/logic';
import { useBoard } from '@/features/rajaa/queries';
import { useNearestMinutes } from '@/features/ride/queries';
import { useT } from '@/lib/i18n';
import { selectedPlace, useProfile, type SavedPlace } from '@/lib/profile';
import { useSignedIn } from '@/lib/session';
import { backFact, rideFact, soonNames, tripsFact, type Fact } from './service-facts';

/** `trips`: Baghdad and Kut (leaving Aziziyah); `rajaa`: الرجعة, the way back (Ali, 2026-10-07). */
export type ServiceId = 'food' | 'taxi' | 'tuktuk' | 'trips' | 'rajaa' | LaunchService;

export interface ServiceDef {
  id: ServiceId;
  label: MessageKey;
  icon: IconName;
  /** Not open yet: listed in the quiet «جاي بالطريق» card, opens the "خبرني" sheet (audit C-03). */
  soon?: boolean;
}

/** The live services, food first (spec §1: food-led), then the coming-soon ones. */
export const SERVICES: readonly ServiceDef[] = [
  { id: 'food', label: 'home.service_food', icon: 'food' },
  { id: 'taxi', label: 'home.service_taxi', icon: 'taxi' },
  { id: 'tuktuk', label: 'home.service_tuktuk', icon: 'tuktuk-fringe' },
  { id: 'trips', label: 'home.service_trips', icon: 'rajaa' },
  { id: 'rajaa', label: 'home.service_rajaa', icon: 'arrow-back' },
  { id: 'grocery', label: 'home.service_grocery', icon: 'cart', soon: true },
  { id: 'khat', label: 'home.service_khat', icon: 'clock', soon: true },
  { id: 'parcel', label: 'home.service_parcel', icon: 'parcel', soon: true },
];

const def = (id: ServiceId): ServiceDef => SERVICES.find((s) => s.id === id)!;

/** The bento's measures (Date & Saffron v3, at phone size). */
const GAP = 10;
const SMALL_H = 96;
const TRIP_H = 84;
const FOOD_ART = 104;

/** Where home asks for the nearest free car: the deliver-to place's pin, else its zone's centre. */
export function homePin(place: SavedPlace | null): LatLng | null {
  if (!place) return null;
  if (place.pin) return place.pin;
  const z = AZIZIYAH_ZONES.find((x) => x.id === place.zoneId);
  return z ? { lat: z.lat, lng: z.lng } : null;
}

/** The next car on the main corridor's board in one direction, as "12:15". */
function useNextCar(direction: IntercityDirection, enabled: boolean) {
  const board = useBoard({ corridorId: PRIMARY_CORRIDOR, direction }, { poll: false });
  const next = board.data ? boardSummary(board.data.departures, new Date()).next : null;
  return { loading: enabled && board.isPending, error: board.isError, nextAt: next ? clockLabel(next.departAt) : null };
}

/**
 * The services on home as the Date & Saffron bento (Ali, 2026-10-06; v3 artifact), on a warm dot halo:
 * أكل the tall saffron-gradient tile with a dish breaking out of its corner, تكسي in yellow and تكتك in
 * plum beside it, then بغداد والكوت wide in date brown with gold Iraqi star lines and its next car in a
 * gold chip, and الرجعة (the way back) smaller in gold on its left (Ali, 2026-10-07: the trips' own
 * colours, no blue). Each tile glows in its own colour and shows one live fact from the server. Offline the ride tiles turn grey and say they need the internet; with every
 * kitchen closed the food tile goes quiet. The coming-soon services are in `ComingSoonStrip` at the end.
 */
export function ServicesRow({ onPress, foodFact, foodOff }: { onPress: (id: ServiceId) => void; foodFact: Fact | null; foodOff: boolean }) {
  const theme = useTheme();
  const t = useT();
  const s = theme.services;
  const online = useNetwork().online;
  const signedIn = useSignedIn();
  const pin = homePin(selectedPlace(useProfile()));
  const taxi = useNearestMinutes(online ? pin : null, 'taxi');
  const tuktuk = useNearestMinutes(online ? pin : null, 'tuktuk');
  const out = useNextCar('from_aziziyah', signedIn);
  const back = useNextCar('to_aziziyah', signedIn);
  const ridesOff = !online;
  const facts = {
    taxi: rideFact('taxi', { online, signedIn, loading: taxi.loading, nearestMinutes: taxi.minutes }),
    tuktuk: rideFact('tuktuk', { online, signedIn, loading: tuktuk.loading, nearestMinutes: tuktuk.minutes }),
    trips: tripsFact({ online, signedIn, ...out }),
    rajaa: backFact({ online, signedIn, ...back }),
  };
  const say = (f: Fact | null) => (f ? t(f.key, f.params) : null);
  const press = (id: ServiceId) => {
    theme.haptic('selection');
    onPress(id);
  };

  return (
    <View testID="home-services" style={{ gap: GAP }}>
      {/* The halo reaches past the tiles into the gutter and fades out before the screen's edge. */}
      <DotHalo style={{ top: -22, bottom: -22, start: -theme.space[5], end: -theme.space[5] }} />
      <View style={{ flexDirection: 'row', gap: GAP }}>
        <Tile
          id="food"
          swatch={foodOff ? s.off : s.food}
          label={t(def('food').label)}
          fact={say(foodFact)}
          style={{ flex: 1.12, height: SMALL_H * 2 + GAP }}
          onPress={() => press('food')}
        >
          {foodOff ? null : <MeshFill base={s.food.fill} mesh={s.food.mesh} />}
          <View pointerEvents="none" style={{ position: 'absolute', top: -10, end: -14, width: FOOD_ART, height: FOOD_ART, transform: [{ rotate: '-14deg' }], opacity: foodOff ? 0.45 : 1 }}>
            <Svg width={FOOD_ART} height={FOOD_ART} viewBox="0 0 200 200">
              <G transform="translate(8 6) scale(0.92)">
                <DishDrawing kind="shawarma" look={0} line={4.5} window={false} />
              </G>
            </Svg>
          </View>
          <TileBody icon={def('food').icon} swatch={foodOff ? s.off : s.food} label={t(def('food').label)} fact={say(foodFact)} big />
        </Tile>
        <View style={{ flex: 1, gap: GAP }}>
          <Tile id="taxi" swatch={ridesOff ? s.off : s.taxi} label={t(def('taxi').label)} fact={say(facts.taxi)} disabled={ridesOff} style={{ height: SMALL_H }} onPress={() => press('taxi')}>
            <TileBody icon={def('taxi').icon} swatch={ridesOff ? s.off : s.taxi} label={t(def('taxi').label)} fact={say(facts.taxi)} />
          </Tile>
          <Tile id="tuktuk" swatch={ridesOff ? s.off : s.tuktuk} label={t(def('tuktuk').label)} fact={say(facts.tuktuk)} disabled={ridesOff} style={{ height: SMALL_H }} onPress={() => press('tuktuk')}>
            <TileBody icon={def('tuktuk').icon} swatch={ridesOff ? s.off : s.tuktuk} label={t(def('tuktuk').label)} fact={say(facts.tuktuk)} />
          </Tile>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: GAP }}>
        <Tile id="trips" swatch={ridesOff ? s.off : s.trips} label={t(def('trips').label)} fact={say(facts.trips)} disabled={ridesOff} style={{ flex: 1.75, height: TRIP_H }} onPress={() => press('trips')}>
          {ridesOff ? null : <CornerFill base={s.trips.fill} light={s.trips.light} />}
          {ridesOff ? null : <StarPattern color={s.trips.pattern} />}
          <TileBody icon={def('trips').icon} swatch={ridesOff ? s.off : s.trips} label={t(def('trips').label)} fact={say(facts.trips)} live={facts.trips?.key === 'home.trips_next'} row />
        </Tile>
        <Tile id="rajaa" swatch={ridesOff ? s.off : s.back} label={t(def('rajaa').label)} fact={say(facts.rajaa)} disabled={ridesOff} style={{ flex: 1, height: TRIP_H }} onPress={() => press('rajaa')}>
          {ridesOff ? null : <DownFill top={s.back.light} bottom={s.back.fill} />}
          <TileBody icon={def('rajaa').icon} swatch={ridesOff ? s.off : s.back} label={t(def('rajaa').label)} fact={say(facts.rajaa)} compact />
        </Tile>
      </View>
    </View>
  );
}

/** One tile: its glow outside, its fill and decoration clipped inside. */
function Tile({
  id,
  swatch,
  label,
  fact,
  disabled,
  style,
  onPress,
  children,
}: {
  id: ServiceId;
  swatch: ServiceSwatch;
  label: string;
  fact: string | null;
  disabled?: boolean;
  style: StyleProp<ViewStyle>;
  onPress: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const g = lift.glowOffset;
  const glow = disabled || swatch === theme.services.off ? undefined : `${g.x}px ${g.y}px ${g.blur}px ${g.spread}px ${withAlpha(swatch.glow, lift.glowAlpha)}`;
  return (
    <View style={[{ borderRadius: theme.radius.tile, boxShadow: theme.scheme === 'light' ? glow : undefined }, style]}>
      <Pressable
        testID={`service-${id}`}
        accessibilityRole="button"
        accessibilityLabel={fact ? `${label}، ${fact}` : label}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          borderRadius: theme.radius.tile,
          backgroundColor: swatch.fill,
          overflow: 'hidden',
          transform: [{ scale: pressed ? 0.97 : 1 }],
        })}
      >
        {children}
      </Pressable>
    </View>
  );
}

/**
 * Icon, name and live fact; `big` for أكل, `row` for the wide trips tile (name and fact only),
 * `compact` for الرجعة. `live` puts the fact in a chip with a dot (the trips tile's next car, in gold).
 */
function TileBody({
  icon,
  swatch,
  label,
  fact,
  live,
  big,
  row,
  compact,
}: {
  icon: IconName;
  swatch: ServiceSwatch;
  label: string;
  fact: string | null;
  live?: boolean;
  big?: boolean;
  row?: boolean;
  compact?: boolean;
}) {
  const theme = useTheme();
  const sub = swatch.sub ?? swatch.on;
  const factText = fact ? (
    <Text variant={compact ? 'caption' : 'footnote'} weight={600} color={sub} numberOfLines={1} tabular style={{ flexShrink: 1 }}>
      {fact}
    </Text>
  ) : null;
  const words = (
    <View style={{ gap: live ? 4 : 0, flex: row ? 1 : undefined, flexShrink: 1, minWidth: 0, alignItems: 'flex-start' }}>
      <Text variant={big ? 'display' : compact ? 'bodyStrong' : 'title'} face="display" color={swatch.on} numberOfLines={1}>
        {label}
      </Text>
      {fact && live ? (
        <View testID="service-live" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', paddingHorizontal: theme.space[2], paddingVertical: 2, borderRadius: theme.radius.md, backgroundColor: withAlpha(sub, 0.16) }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: sub, boxShadow: `0px 0px 0px 3px ${withAlpha(sub, 0.3)}` }} />
          {factText}
        </View>
      ) : fact ? (
        factText
      ) : (
        // The shimmer takes the fact line's own height, so the tile doesn't shift when the fact arrives.
        <View style={{ height: theme.type[compact ? 'caption' : 'footnote'].lineHeight, justifyContent: 'center', alignSelf: 'stretch' }}>
          <Skeleton height={10} width="70%" style={{ opacity: 0.5 }} />
        </View>
      )}
    </View>
  );
  if (row) {
    // No icon: the name and the next car's chip get the whole width (the trips artifact's tile).
    return <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space[4] }}>{words}</View>;
  }
  return (
    <View style={{ flex: 1, justifyContent: 'space-between', padding: compact ? 10 : big ? theme.space[4] : theme.space[3] }}>
      <Icon name={icon} size={big ? 28 : compact ? 18 : 24} color={swatch.on} strokeWidth={1.9} />
      {words}
    </View>
  );
}

/**
 * «جاي بالطريق»: the services that aren't open yet, quiet at the end of home (discovery §6) as one
 * dashed card — their icons, «جاي بالطريق», «سوق، خطوط وطرود» and «خبّرني لمن تنفتح». Each icon opens the
 * "خبرني" sheet.
 */
export function ComingSoonStrip({ onPress }: { onPress: (id: ServiceId) => void }) {
  const theme = useTheme();
  const t = useT();
  const soon = SERVICES.filter((s) => s.soon);
  return (
    <View
      testID="home-soon"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[3],
        borderRadius: theme.radius.xl,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: theme.colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', gap: theme.space[1] }}>
        {soon.map((s) => (
          <Pressable
            key={s.id}
            testID={`service-${s.id}`}
            accessibilityRole="button"
            accessibilityLabel={t('soon.a11y', { name: t(s.label) })}
            onPress={() => {
              theme.haptic('selection');
              onPress(s.id);
            }}
            style={({ pressed }) => ({
              width: theme.hitTarget,
              height: theme.hitTarget,
              borderRadius: theme.radius.lg,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? theme.colors.border : theme.colors.accentTint,
            })}
          >
            <Icon name={s.icon} size={20} color="accentText" strokeWidth={2} />
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" accessibilityRole="header" numberOfLines={1}>
          {t('home.soon_coming')}
        </Text>
        <Text variant="footnote" color="textMuted" numberOfLines={1}>
          {soonNames(soon.map((s) => t(s.label)), t)}
        </Text>
        <Text variant="footnote" weight={600} color="accentText" numberOfLines={1}>
          {t('home.soon_notify')}
        </Text>
      </View>
    </View>
  );
}
