import { useMemo, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { runOnJS, useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import type { CatalogSearchDish } from '@driver/contracts';
import { Skeleton, useTheme } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import { useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';
import type { BandBasket } from './DaypartBand';
import { dishPhoto } from './dish-photos';
import { DishGallery, galleryHeight, type DishPhoto } from './DishGallery';
import { hourFood, type HourDish } from './gallery';
import { usePots } from './habit-queries';
import { MoreDishes } from './MoreDishes';
import type { RestaurantSummary } from './restaurant-summary';

/** The hour's food (`hourFood`) from the town's pots and the hour's picks, while either is still loading. */
export function useHourFood({
  picks,
  picksPending,
  words,
  later,
  taken,
  now,
}: {
  picks: readonly CatalogSearchDish[] | undefined;
  picksPending: boolean;
  words: readonly string[];
  later: string | null;
  /** The usual card's dish photo, so the gallery doesn't show it a second time. */
  taken: number | null;
  now: Date;
}) {
  const pots = usePots();
  // Each dish's picture: its kitchen's photo, else the library's photo of that dish; none, and it stays on its menu.
  const food = useMemo(
    () => hourFood({ pots: pots.data, picks, now, later, words, pictureOf: (d) => apiPhoto(d.photoUrl) ?? dishPhoto(d.name), taken: taken === null ? [] : [taken] }),
    [pots.data, picks, now, later, words, taken],
  );
  return { food, pending: picksPending || pots.isPending };
}

/**
 * The hour's food on home (Ali 2026-10-08, concept C with the big dish as a rotating gallery): the
 * hour's title («للغدا اليوم», «للعشا»…), the gallery of the town's pots and the hour's dishes, and
 * «أكلات ثانية» in two columns under it. It replaces «العزيزية اليوم» and the hour's dish row, so a
 * kitchen's pot and its dishes are one place, not two. Every picture is a real photo: the kitchen's
 * own, else the dish library's photo of that dish; a dish with neither, or a picture already showing,
 * stays on its menu. Nothing open and nothing cooking: nothing drawn.
 */
export function HourFood({
  title,
  food,
  pending,
  kitchens,
  basket,
  now,
  scrollY,
  width,
}: {
  title: string;
  food: { slides: HourDish[]; more: HourDish[] };
  /** The pots or the picks are still on their way. */
  pending: boolean;
  kitchens: readonly RestaurantSummary[];
  basket: BandBasket;
  now: Date;
  /** The page's scroll; this section must be a direct child of the page, so its layout is page-relative. */
  scrollY: SharedValue<number>;
  width: number;
}) {
  const theme = useTheme();
  const t = useT();
  const { height: screenH } = useWindowDimensions();
  const [top, setTop] = useState<number | null>(null);
  const [galleryY, setGalleryY] = useState<number | null>(null);
  const [inView, setInView] = useState(false);
  const photos = useMemo<DishPhoto[]>(() => [...food.slides, ...food.more].map((h) => ({ uri: apiPhoto(h.dish.photoUrl), local: dishPhoto(h.dish.name) })), [food]);
  const minutesOf = (id: string) => {
    const k = kitchens.find((r) => r.id === id);
    return k ? (k.etaMaxMinutes ?? k.prepMaxMinutes) : null;
  };
  const height = galleryHeight(width);

  // In view: most of the gallery is between the top of the screen and its foot.
  const at = top != null && galleryY != null ? top + galleryY : null;
  useAnimatedReaction(
    () => (at == null ? false : scrollY.value + screenH > at + height * 0.7 && scrollY.value < at + height * 0.3),
    (seen, before) => {
      if (seen !== before) runOnJS(setInView)(seen);
    },
    [at, screenH, height],
  );

  const loading = food.slides.length === 0 && pending;
  if (!loading && food.slides.length === 0) return null;
  return (
    <View testID="home-hour-food" style={{ gap: theme.space[6] }} onLayout={(e) => setTop(e.nativeEvent.layout.y)}>
      <View style={{ gap: theme.space[3] }}>
        <SectionHeader big title={title} />
        <View onLayout={(e) => setGalleryY(e.nativeEvent.layout.y)}>
          {loading ? (
            <View testID="home-gallery-loading" accessibilityLabel={t('status.loading')}>
              <Skeleton width={width} height={height} radius={theme.radius['2xl']} />
            </View>
          ) : (
            <DishGallery key={food.slides.map((h) => h.dish.id).join()} slides={food.slides} photos={photos} minutesOf={minutesOf} width={width} visible={inView} basket={basket} now={now} />
          )}
        </View>
      </View>
      <MoreDishes items={food.more} photos={photos.slice(food.slides.length)} basket={basket} />
    </View>
  );
}
