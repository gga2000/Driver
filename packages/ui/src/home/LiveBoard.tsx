import type { ReactNode } from 'react';
import { Image, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@driver/i18n';
import { Art } from '../art/Art';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeProvider';
import { countWord, useHomeLook } from './look';
import { HomePress } from './media';

export type BoardService = 'food' | 'ride' | 'gov' | 'parcel' | 'carts';

export interface Departure {
  id: string;
  /** «بغداد», «الكوت». */
  city: string;
  /** The clock digits («4:30») and the part of day («العصر»). */
  time: string;
  part: string;
  seats: number;
  free: number;
}

export interface LiveBoardProps {
  town: string;
  /** Restaurants open now. */
  open: number;
  /** Minutes to the nearest taxi or tuktuk; null when none is near. */
  rideMinutes: number | null;
  /** The next departures to Baghdad and Kut (up to two shown). */
  departures: readonly Departure[];
  /** Food carts open now. */
  carts: number;
  /** The cut-out pictures from the app's assets (real photos, no icons; Ali 2026-11-02). */
  pictures: { food: ImageSourcePropType; taxi: ImageSourcePropType; tuktuk: ImageSourcePropType; intercity: ImageSourcePropType };
  onPress?: (service: BoardService) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * «شنو تحتاج؟» — the live board (concept D, Ali 2026-11-02): food as the tall orange tile, taxi and tuktuk
 * as one tile with the nearest car's minutes, محافظات with the next real departures and their seats, then
 * طرود and عربانات. Flat tiles, real pictures, the same layout in both themes.
 */
export function LiveBoard({ town, open, rideMinutes, departures, carts, pictures, onPress, style, testID }: LiveBoardProps) {
  const theme = useTheme();
  const look = useHomeLook();
  const press = (s: BoardService) => (onPress ? () => onPress(s) : undefined);
  const gap = theme.space[2];
  const shown = departures.slice(0, 2);
  return (
    <View testID={testID} style={[{ gap }, style]}>
      <View style={{ flexDirection: 'row', gap }}>
        {/* Food: tall, orange, the count big. */}
        <Tile
          service="food"
          label={t('home.board.tile_a11y', { name: t('home.board.food'), fact: t('live_map.open_now', { n: open }) })}
          onPress={press('food')}
          style={{ width: 108, backgroundColor: theme.colors.accent, boxShadow: undefined, justifyContent: 'flex-start' }}
          testID={testID ? `${testID}-food` : undefined}
        >
          <Text variant="title" face="display" color="onAccent" compact>
            {t('home.board.food')}
          </Text>
          <Text variant="numeralSm" face="display" color="onAccent">
            {String(open)}
          </Text>
          <Text variant="label" weight={700} color="onAccent" compact numberOfLines={2}>
            {countWord(open, 'home.unit.open')}
          </Text>
          <Image source={pictures.food} accessible={false} resizeMode="contain" style={{ position: 'absolute', bottom: -14, end: -14, width: 118, height: 100, transform: [{ rotate: '-8deg' }] }} />
        </Tile>

        <View style={{ flex: 1, gap }}>
          {/* Taxi + tuktuk: one tile, one screen. */}
          <Tile
            service="ride"
            label={t('home.board.tile_a11y', { name: t('home.board.ride'), fact: rideMinutes === null ? t('home.board.no_car') : t('live_map.minutes', { n: rideMinutes }) })}
            onPress={press('ride')}
            style={{ minHeight: 104 }}
            testID={testID ? `${testID}-ride` : undefined}
          >
            <Text variant="bodyStrong" face="display" compact>
              {t('home.board.ride')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              {rideMinutes === null ? null : <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: look.board.dot }} />}
              <Text variant="footnote" color="textMuted" compact numberOfLines={1}>
                {rideMinutes === null ? t('home.board.no_car') : t('home.board.nearest')}
              </Text>
            </View>
            {rideMinutes === null ? null : (
              <View style={{ position: 'absolute', bottom: theme.space[2], start: theme.space[3], flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <Text variant="numeralSm" face="display" color={look.board.fact} testID={testID ? `${testID}-ride-minutes` : undefined}>
                  {String(rideMinutes)}
                </Text>
                <Text variant="footnote" color="textMuted" compact>
                  {countWord(rideMinutes, 'home.unit.minute')}
                </Text>
              </View>
            )}
            <Image source={pictures.taxi} accessible={false} resizeMode="contain" style={{ position: 'absolute', bottom: 2, end: 56, width: 76, height: 46 }} />
            <Image source={pictures.tuktuk} accessible={false} resizeMode="contain" style={{ position: 'absolute', bottom: 2, end: 4, width: 48, height: 48 }} />
          </Tile>

          {/* محافظات: the next real departures with their seats. */}
          <Tile
            service="gov"
            label={shown.length === 0 ? t('home.board.tile_a11y', { name: t('home.board.gov'), fact: t('home.board.no_trips') }) : t('home.board.gov_a11y', { departures: shown.map(departureA11y).join('، ') })}
            onPress={press('gov')}
            testID={testID ? `${testID}-gov` : undefined}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="bodyStrong" face="display" compact>
                {t('home.board.gov')}
              </Text>
              <Image source={pictures.intercity} accessible={false} resizeMode="contain" style={{ width: 84, height: 40, marginVertical: -8 }} />
            </View>
            {shown.length === 0 ? (
              <Text variant="footnote" color="textMuted">
                {t('home.board.no_trips')}
              </Text>
            ) : (
              shown.map((d, i) => <DepartureRow key={d.id} d={d} first={i === 0} testID={testID ? `${testID}-dep-${d.id}` : undefined} />)
            )}
          </Tile>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap }}>
        <SmallTile
          service="parcel"
          name={t('home.board.parcel')}
          fact={t('home.board.parcel_sub', { town })}
          art={<Art name="parcel" size={76} />}
          onPress={press('parcel')}
          testID={testID ? `${testID}-parcel` : undefined}
        />
        <SmallTile
          service="carts"
          name={t('home.board.carts')}
          fact={carts > 0 ? t('home.board.carts_open', { n: carts }) : t('home.board.carts_closed')}
          live={carts > 0}
          art={<Art name="cart" size={76} />}
          onPress={press('carts')}
          testID={testID ? `${testID}-carts` : undefined}
        />
      </View>
    </View>
  );
}

/** A board tile: the card colour and its soft shadow (no outline), the whole tile one button. */
function Tile({ children, label, onPress, style, testID }: { service: BoardService; children: ReactNode; label: string; onPress?: () => void; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <HomePress
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={[
        {
          minHeight: 88,
          borderRadius: theme.radius.xl,
          backgroundColor: look.board.tile,
          boxShadow: look.card.shadow ?? undefined,
          paddingHorizontal: theme.space[3],
          paddingVertical: theme.space[2],
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </HomePress>
  );
}

const departureA11y = (d: Departure) => t('home.board.departure_a11y', { city: d.city, time: t('home.board.departure_time', { time: d.time, part: d.part }), seats: t('intercity.seats_left', { n: d.free }) });

/** Two seats or fewer: the count turns orange (forest-on-sage reads «few left» by weight instead). */
const FEW_SEATS = 2;

function DepartureRow({ d, first, testID }: { d: Departure; first: boolean; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  const few = d.free <= FEW_SEATS;
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: theme.space[2],
        paddingVertical: 6,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, flexShrink: 1 }}>
        <Text variant="label" weight={600} numberOfLines={1}>
          {d.city}
        </Text>
        <Text variant="label" face="display" weight={700} color={look.board.fact} tabular>
          {d.time}
        </Text>
        <Text variant="footnote" color="textMuted" compact>
          {d.part}
        </Text>
      </View>
      {/* Seats in words, not dots (audit round 2): «باقي 3 مقاعد». */}
      <Text testID={testID ? `${testID}-seats` : undefined} variant="footnote" weight={few ? 700 : 500} color={few ? 'accentText' : 'textMuted'} compact numberOfLines={1}>
        {t('intercity.seats_left', { n: d.free })}
      </Text>
    </View>
  );
}

function SmallTile({ service, name, fact, live, art, onPress, testID }: { service: BoardService; name: string; fact: string; live?: boolean; art: ReactNode; onPress?: () => void; testID?: string }) {
  const look = useHomeLook();
  return (
    <Tile service={service} label={t('home.board.tile_a11y', { name, fact })} onPress={onPress} style={{ flex: 1, minHeight: 96 }} testID={testID}>
      <Text variant="bodyStrong" face="display" compact>
        {name}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '70%' }}>
        {live ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: look.board.dot }} /> : null}
        <Text variant="footnote" color="textMuted" numberOfLines={2}>
          {fact}
        </Text>
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', end: -6, bottom: -8 }}>
        {art}
      </View>
    </Tile>
  );
}
