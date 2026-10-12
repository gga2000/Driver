import type { CartCard, CartKind } from '@driver/contracts';
import { formatHourPart } from '@driver/i18n';
import type { FoodPhotoSource } from '@/features/food-landing/photos';

/**
 * Each cart's stand-in photo until it uploads its own (Ali's approved dish library on the API,
 * `/media/food/lib-*`): the very dish the cart sells. Corn and the seasonal carts have no library photo
 * yet, so they get the drawn tile (no other dish stands in).
 */
const PHOTO: Partial<Record<CartKind, string>> = {
  liver: '/media/food/lib-liver-2.webp',
  falafel: '/media/food/lib-falafel-1.webp',
  tea: '/media/food/lib-tea-2.webp',
  bagilla: '/media/food/lib-bagilla-1.webp',
};

export function cartPhoto(card: Pick<CartCard, 'kind' | 'dishes'>): FoodPhotoSource | null {
  return card.dishes.find((d) => d.photoUrl)?.photoUrl ?? PHOTO[card.kind] ?? null;
}

/** The city clock's offset (Baghdad, no daylight saving). */
const CITY_OFFSET_MIN = 180;

/** "18:00" → "6 المسا" ("6 PM"): the owner's usual hour, said the way people say it. */
export function usualHour(hhmm: string, locale: 'ar-IQ' | 'en'): string {
  const [h, m] = hhmm.split(':').map(Number);
  const at = Date.UTC(2026, 0, 1, h ?? 0, m ?? 0) - CITY_OFFSET_MIN * 60_000;
  return formatHourPart(at, { locale });
}
