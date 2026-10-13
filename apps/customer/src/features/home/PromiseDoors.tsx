import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useWindowDimensions, View } from 'react-native';
import type { CartCard } from '@driver/contracts';
import type { ServiceCard } from '@driver/design-tokens';
import { Icon, Text, useTheme, withAlpha } from '@driver/ui';
import { CartPhoto } from '@/features/food-carts/CartPhoto';
import { cartPalette } from '@/features/food-carts/palette';
import { useApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { countKey } from '@/lib/plural';
import { useSeason } from '@/lib/use-season';
import { useAmbient } from './ambient';
import { doorOpen } from './launched';
import { liveDoors } from './promise-doors';
import { GAP, SideWords, SMALL_H, Tile, Words } from './ServicesRow';
import { grownTileHeight } from './tile-size';

/** The carts list is re-read about this often (the carts page reads the same list, so they share it). */
const CARTS_STALE_MS = 60_000;
/** The cart's round photo on its card, and the width the name and fact keep at the card's start. */
const CART_PHOTO = 56;
const WORDS = '66%';

/**
 * «وعدنا هم» (look D, Ali 2026-10-11): the services that came after food and rides, as cards like the
 * top ones near the end of home, above «جاي قريب». Each card shows only while its service is open: the
 * food carts while a cart is open, and طرود once the city has opened it. Each card is wide, one under the
 * other (look D's bento comes back when السوق joins). Nothing open → nothing here, not even the heading.
 */
export function PromiseDoors() {
  const theme = useTheme();
  const t = useT();
  const api = useApi();
  const beat = useAmbient();
  const { fontScale } = useWindowDimensions();
  const parcel = doorOpen('parcel', useSeason().launched);
  const carts = useQuery({ ...api.foodCarts.list.queryOptions({}), staleTime: CARTS_STALE_MS });
  const doors = liveDoors({ parcel, carts: carts.data ? { launched: carts.data.launched, open: carts.data.open.length } : null });
  if (doors.length === 0) return null;
  const height = grownTileHeight(SMALL_H, [theme.type.title.lineHeight, theme.type.caption.lineHeight, theme.type.caption.lineHeight], fontScale);
  return (
    <View testID="home-promise" style={{ gap: theme.space[3] }}>
      <Text variant="section" face="display" accessibilityRole="header">
        {t('home.promise_title')}
      </Text>
      <View style={{ gap: GAP }}>
        {doors.map((id) =>
          id === 'carts' && carts.data ? (
            <CartsDoor key={id} open={carts.data.open} height={height} beat={beat} />
          ) : id === 'parcel' ? (
            <ParcelDoor key={id} height={height} beat={beat} />
          ) : null,
        )}
      </View>
    </View>
  );
}

/**
 * عربانات: the page's cream with a fuchsia edge (carts wear no pale wash, carts thread 2026-10-11), how
 * many are open now with the live dot, and the first open cart's photo in its fuchsia ring.
 */
function CartsDoor({ open, height, beat }: { open: readonly CartCard[]; height: number; beat: boolean }) {
  const theme = useTheme();
  const t = useT();
  const pal = cartPalette(theme);
  const card: ServiceCard = { bg: theme.colors.surface, on: theme.colors.text, sub: theme.colors.textMuted, dot: pal.text };
  const label = t('home.door_carts');
  const fact = t(countKey('home.door_carts_open', open.length), { n: open.length });
  return (
    <Tile
      id="carts"
      card={card}
      label={label}
      fact={fact}
      edge={withAlpha(pal.ring, 0.55)}
      style={{ height }}
      onPress={() => {
        theme.haptic('selection');
        router.push('/food-carts');
      }}
    >
      {open[0] ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, end: theme.space[3], justifyContent: 'center' }}>
          <CartPhoto card={open[0]} size={CART_PHOTO} round testID="home-door-carts-photo" />
        </View>
      ) : null}
      <SideWords text={WORDS}>
        <Words card={card} label={label} fact={fact} live beat={beat} />
      </SideWords>
    </Tile>
  );
}

/** طرود: its henna wash, what it does, and a small kraft tag with the henna seal (the parcel page's tag). */
function ParcelDoor({ height, beat }: { height: number; beat: boolean }) {
  const theme = useTheme();
  const t = useT();
  const p = theme.services.parcel;
  const label = t('home.service_parcel');
  const fact = t('home.door_parcel');
  return (
    <Tile
      id="parcel"
      card={p.card}
      label={label}
      fact={fact}
      style={{ height }}
      onPress={() => {
        theme.haptic('selection');
        router.push('/parcel');
      }}
    >
      <KraftTag fill={p.fill} on={p.on} kraft={p.kraft} hole={p.card.bg} ink={p.card.on} />
      <SideWords text={WORDS}>
        <Words card={p.card} label={label} fact={fact} live={false} beat={beat} />
      </SideWords>
    </Tile>
  );
}

/** The tag's measures: its size, the punched hole and the seal pressed on it. */
const TAG_W = 80;
const TAG_H = 56;
const HOLE = 10;
const SEAL = 30;

/** A kraft parcel tag, leaning, with its punched hole and the henna seal on it. */
function KraftTag({ fill, on, kraft, hole, ink }: { fill: string; on: string; kraft: string; hole: string; ink: string }) {
  const theme = useTheme();
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, bottom: 0, end: theme.space[4], justifyContent: 'center' }}>
      <View
        testID="home-door-parcel-tag"
        style={{
          width: TAG_W,
          height: TAG_H,
          borderRadius: theme.radius.md,
          backgroundColor: kraft,
          borderWidth: 1,
          borderColor: withAlpha(ink, 0.12),
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate: '-8deg' }],
        }}
      >
        <View style={{ position: 'absolute', start: 7, top: (TAG_H - HOLE) / 2, width: HOLE, height: HOLE, borderRadius: HOLE / 2, backgroundColor: hole, borderWidth: 2, borderColor: withAlpha(ink, 0.2) }} />
        <View style={{ width: SEAL, height: SEAL, borderRadius: SEAL / 2, marginStart: HOLE + 6, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="parcel" size={16} color={on} />
        </View>
      </View>
    </View>
  );
}
