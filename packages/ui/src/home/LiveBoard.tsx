import type { ReactNode } from 'react';
import { Image, Pressable, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@driver/i18n';
import { Art } from '../art/Art';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeProvider';
import { seatSquares } from './logic';
import { countWord, useHomeLook } from './look';

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
          style={{ width: 108, backgroundColor: theme.colors.accent, borderColor: theme.colors.accent, justifyContent: 'flex-start' }}
          testID={testID ? `${testID}-food` : undefined}
        >
          <Text variant="title" face="display" color="onAccent" compact>
            {t('home.board.food')}
          </Text>
          <Text variant="numeralSm" face="display" color="onAccent">
            {String(open)}
          </Text>
          <Text variant="label" weight={700} color="onAccent" compact numberOfLines={2}>
            {countWord(open, 'home.word.open', 'home.word.open_pl')}
          </Text>
          <Image source={pictures.food} accessible={false} resizeMode="contain" style={{ position: 'absolute', bottom: -14, end: -14, width: 118, height: 100, transform: [{ rotate: '-8deg' }] }} />
        </Tile>

        <View style={{ flex: 1, gap }}>
          {/* Taxi + tuktuk: one tile, one screen. */}
          <Tile
            service="ride"
            label={t('home.board.tile_a11y', { name: t('home.board.ride'), fact: rideMinutes === null ? t('home.board.no_car') : t('live_map.minutes', { n: rideMinutes }) })}
            onPress={press('ride')}
            style={{ height: 104 }}
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
                  {countWord(rideMinutes, 'home.word.minute', 'home.word.minute_pl')}
                </Text>
              </View>
            )}
            <Image source={pictures.taxi} accessible={false} resizeMode="contain" style={{ position: 'absolute', bottom: 2, end: 56, width: 76, height: 46 }} />
            <Image source={pictures.tuktuk} accessible={false} resizeMode="contain" style={{ position: 'absolute', bottom: 2, end: 4, width: 48, height: 48 }} />
          </Tile>

          {/* محافظات: the next real departures with their seats. */}
          <Tile service="gov" label={t('home.board.gov')} onPress={press('gov')} testID={testID ? `${testID}-gov` : undefined}>
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
              shown.map((d, i) => <DepartureRow key={d.id} d={d} first={i === 0} />)
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

function Tile({ children, label, onPress, style, testID }: { service: BoardService; children: ReactNode; label: string; onPress?: () => void; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        {
          minHeight: 88,
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: look.board.edge,
          backgroundColor: look.board.tile,
          paddingHorizontal: theme.space[3],
          paddingVertical: theme.space[2],
          overflow: 'hidden',
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

function DepartureRow({ d, first }: { d: Departure; first: boolean }) {
  const theme = useTheme();
  const look = useHomeLook();
  const squares = seatSquares(d.seats, d.free);
  return (
    <View
      accessible
      accessibilityLabel={t('home.board.departure_a11y', { city: d.city, time: `${d.time} ${d.part}`, seats: t('intercity.seats_left', { n: d.free }) })}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 6,
        borderTopWidth: first ? 0 : 1,
        borderStyle: 'dashed',
        borderTopColor: look.board.edge,
      }}
    >
      <Text variant="label" numberOfLines={1}>
        {d.city}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text variant="label" face="display" color={look.board.fact} tabular>
          {d.time}
        </Text>
        <Text variant="footnote" color="textMuted" compact>
          {d.part}
        </Text>
        <View testID={`seats-${d.id}`} style={{ flexDirection: 'row', gap: 3, marginStart: theme.space[1], direction: 'ltr' }}>
          {squares.map((free, i) => (
            <View
              key={i}
              testID={free ? 'seat-free' : 'seat-taken'}
              style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: free ? look.board.fact : 'transparent', borderWidth: free ? 0 : 1, borderColor: look.board.edge }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function SmallTile({ service, name, fact, live, art, onPress, testID }: { service: BoardService; name: string; fact: string; live?: boolean; art: ReactNode; onPress?: () => void; testID?: string }) {
  const look = useHomeLook();
  return (
    <Tile service={service} label={t('home.board.tile_a11y', { name, fact })} onPress={onPress} style={{ flex: 1, height: 96 }} testID={testID}>
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
