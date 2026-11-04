import type { ReactNode } from 'react';
import { useWindowDimensions, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@driver/i18n';
import { Art } from '../art/Art';
import { LocalPhoto } from '../components/PhotoImage';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeProvider';
import { homeSize } from './format';
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
  /** All seats in the car (the trip screen draws them); the board says only the free ones. */
  seats: number;
  /** Seats still free; 0 reads «كاملة». */
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
  /** No connection: the live numbers are old, so the board stops claiming them (no live dots, «ما نعرف هسة»). */
  offline?: boolean;
  onPress?: (service: BoardService) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Above this text size the pictures step aside so the words never collide with them. */
const BIG_TEXT = 1.3;
/** A service that can't be used right now: its picture steps back, the words stay readable. */
const UNAVAILABLE = 0.4;

/**
 * «شنو تحتاج؟» — the live board (concept D, Ali 2026-11-02): food as the tall orange tile, taxi and tuktuk
 * as one tile with the nearest car's minutes, محافظات with the next real departures and their seats, then
 * طرود and عربانات. Flat tiles, real pictures, the same layout in both themes.
 */
export function LiveBoard({ town, open, rideMinutes: liveRide, departures, carts, pictures, offline, onPress, style, testID }: LiveBoardProps) {
  const theme = useTheme();
  const look = useHomeLook();
  const press = (s: BoardService) => (onPress ? () => onPress(s) : undefined);
  const gap = theme.space[2];
  const shown = departures.slice(0, 2);
  const art = useWindowDimensions().fontScale <= BIG_TEXT;
  // Offline, the nearest car is unknown rather than «ماكو»: the old minutes would be a guess.
  const rideMinutes = offline ? null : liveRide;
  const rideFact = offline ? t('home.board.unknown') : rideMinutes === null ? t('home.board.no_car') : t('home.board.nearest');
  return (
    <View testID={testID} style={[{ gap }, style]}>
      <View style={{ flexDirection: 'row', gap }}>
        {/* Food: tall, orange, the count big. */}
        <Tile
          label={t('home.board.tile_a11y', { name: t('home.board.food'), fact: open > 0 ? t('live_map.open_now', { n: open }) : t('home.board.food_closed') })}
          onPress={press('food')}
          style={{ width: homeSize.foodTile, minHeight: homeSize.boardTop, backgroundColor: theme.colors.accent, boxShadow: undefined, justifyContent: 'flex-start' }}
          testID={testID ? `${testID}-food` : undefined}
        >
          <Text variant="title" face="display" color="onAccent" compact>
            {t('home.board.food')}
          </Text>
          {open > 0 ? (
            <>
              <Text variant="numeralSm" face="display" color="onAccent">
                {String(open)}
              </Text>
              <Text variant="label" weight={700} color="onAccent" compact numberOfLines={2}>
                {countWord(open, 'home.unit.open')}
              </Text>
            </>
          ) : (
            // Never «0 مطعم فاتح».
            <Text variant="label" weight={700} color="onAccent" numberOfLines={3} testID={testID ? `${testID}-food-closed` : undefined}>
              {t('home.board.food_closed')}
            </Text>
          )}
          {art ? <TilePicture source={pictures.food} width={104} height={100} /> : null}
        </Tile>

        <View style={{ flex: 1, gap }}>
          {/* Taxi + tuktuk: one tile, one screen. Minutes in the flow, pictures at the bottom corner like every tile. */}
          <Tile
            label={t('home.board.tile_a11y', { name: t('home.board.ride'), fact: rideMinutes === null ? rideFact : t('live_map.minutes', { n: rideMinutes }) })}
            onPress={press('ride')}
            style={{ minHeight: (homeSize.boardTop - gap) / 2 }}
            testID={testID ? `${testID}-ride` : undefined}
          >
            <Text variant="bodyStrong" face="display" compact>
              {t('home.board.ride')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              {rideMinutes === null ? null : <View style={{ width: homeSize.dot, height: homeSize.dot, borderRadius: homeSize.dot / 2, backgroundColor: look.board.dot }} />}
              <Text variant="footnote" color="textMuted" numberOfLines={1}>
                {rideFact}
              </Text>
            </View>
            {rideMinutes === null ? null : (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[1] }}>
                <Text variant="numeralSm" face="display" color={look.board.fact} testID={testID ? `${testID}-ride-minutes` : undefined}>
                  {String(rideMinutes)}
                </Text>
                <Text variant="footnote" color="textMuted" compact>
                  {countWord(rideMinutes, 'home.unit.minute')}
                </Text>
              </View>
            )}
            {art ? (
              <View style={{ position: 'absolute', bottom: theme.space[1], end: theme.space[1], flexDirection: 'row', alignItems: 'flex-end', pointerEvents: 'none' }}>
                <LocalPhoto source={pictures.taxi} fit="contain" style={{ width: 72, height: 44, opacity: rideMinutes === null ? UNAVAILABLE : 1 }} />
                <LocalPhoto source={pictures.tuktuk} fit="contain" style={{ width: 46, height: 46, opacity: rideMinutes === null ? UNAVAILABLE : 1 }} />
              </View>
            ) : null}
          </Tile>

          {/* محافظات: the next real departures with their seats. */}
          <Tile
            label={shown.length === 0 ? t('home.board.tile_a11y', { name: t('home.board.gov'), fact: t('home.board.no_trips') }) : t('home.board.gov_a11y', { departures: shown.map(departureA11y).join(t('home.list_sep')) })}
            onPress={press('gov')}
            testID={testID ? `${testID}-gov` : undefined}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="bodyStrong" face="display" compact>
                {t('home.board.gov')}
              </Text>
              {art ? <LocalPhoto source={pictures.intercity} fit="contain" style={{ width: 72, height: 32 }} /> : null}
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
          name={t('home.board.parcel')}
          fact={t('home.board.parcel_sub', { town })}
          art={art ? <Art name="parcel" size={64} /> : null}
          onPress={press('parcel')}
          testID={testID ? `${testID}-parcel` : undefined}
        />
        <SmallTile
          name={t('home.board.carts')}
          fact={offline ? t('home.board.unknown') : carts > 0 ? t('home.board.carts_open', { n: carts }) : t('home.board.carts_closed')}
          live={carts > 0 && !offline}
          art={art ? <Art name="cart" size={64} /> : null}
          muted={offline || carts === 0}
          onPress={press('carts')}
          testID={testID ? `${testID}-carts` : undefined}
        />
      </View>
    </View>
  );
}

/** A board tile: the card colour and its soft shadow (no outline), the whole tile one button. */
function Tile({ children, label, onPress, style, testID }: { children: ReactNode; label: string; onPress?: () => void; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <HomePress
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={[
        {
          minHeight: homeSize.boardBottom,
          gap: 2,
          borderRadius: theme.radius.xl,
          backgroundColor: look.board.tile,
          boxShadow: look.card.shadow ?? undefined,
          borderWidth: look.card.edge ? 1 : 0,
          borderColor: look.card.edge ?? undefined,
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

const departureA11y = (d: Departure) => t('home.board.departure_a11y', { city: d.city, time: t('home.board.departure_time', { time: d.time, part: d.part }), seats: d.free > 0 ? t('intercity.seats_left', { n: d.free }) : t('intercity.full') });

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
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[1], flexShrink: 1 }}>
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
      {/* Seats in words, not dots (audit round 2): «باقي 3 مقاعد», and «كاملة» when none is left. */}
      <Text testID={testID ? `${testID}-seats` : undefined} variant="footnote" weight={few ? 700 : 500} color={few && d.free > 0 ? 'accentText' : 'textMuted'} compact numberOfLines={1}>
        {d.free > 0 ? t('intercity.seats_left', { n: d.free }) : t('intercity.full')}
      </Text>
    </View>
  );
}

function SmallTile({ name, fact, live, art, muted, onPress, testID }: { muted?: boolean; name: string; fact: string; live?: boolean; art: ReactNode; onPress?: () => void; testID?: string }) {
  const look = useHomeLook();
  return (
    <Tile label={t('home.board.tile_a11y', { name, fact })} onPress={onPress} style={{ flex: 1 }} testID={testID}>
      <Text variant="bodyStrong" face="display" compact>
        {name}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: art ? '70%' : undefined }}>
        {live ? <View style={{ width: homeSize.dot, height: homeSize.dot, borderRadius: homeSize.dot / 2, backgroundColor: look.board.dot }} /> : null}
        <Text variant="footnote" color="textMuted" numberOfLines={2}>
          {fact}
        </Text>
      </View>
      {art ? <View style={{ position: 'absolute', end: 4, bottom: 4, pointerEvents: 'none', opacity: muted ? UNAVAILABLE : 1 }}>{art}</View> : null}
    </Tile>
  );
}

/** A tile's cut-out picture, always in the same bottom corner (audit round 3: one place, never cropped). */
function TilePicture({ source, width, height }: { source: ImageSourcePropType; width: number; height: number }) {
  const theme = useTheme();
  return (
    <View style={{ position: 'absolute', bottom: theme.space[1], end: theme.space[1], pointerEvents: 'none' }}>
      <LocalPhoto source={source} fit="contain" style={{ width, height }} />
    </View>
  );
}
