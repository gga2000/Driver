import type { MessageKey } from '@driver/i18n';

/**
 * The restaurant map's cards on home (Ali 2026-10-10, "c main + A as rotating cards with different
 * copy"): the drawn town first, then three shops from the 3D map, each saying one thing the map does.
 * Pure, so the order and the pictures are tested.
 */

export type MapShop = 'grill' | 'sweets' | 'cafe';

export interface MapCard {
  id: 'map' | MapShop;
  title: MessageKey;
  line: MessageKey;
  /** The picture's path on the API (`/media/food/…`), or null for the drawn town. */
  picture: string | null;
}

/**
 * Shops on the 3D map in the late-afternoon sun and with their lights on at night. Served by the API
 * with the dish photos (`apps/api/media/food`), so the phone download doesn't carry them; a changed
 * picture gets the next number (`-2`), since phones keep each name for a year.
 */
export const mapPicture = (shop: MapShop, night: boolean) => `/media/food/home-map-${shop}-${night ? 'night' : 'day'}-1.webp`;

/** The pictures show the town after dark from 18:00 to 06:00 (Aziziyah's sunset is 17:00–19:30 over the year). */
export const mapBoxNight = (hour: number) => hour >= 18 || hour < 6;

/** The cards' height for a column `width`: room for the picture and two lines under it, never a third of a phone. */
export function mapBoxHeight(width: number): number {
  return Math.round(Math.min(Math.max(width * 0.82, 260), 340));
}

/** The four cards. The shops follow the hour; the last one shows the other half of the day, since the map's light follows the sun. */
export function mapCards(night: boolean): MapCard[] {
  return [
    { id: 'map', title: 'home.map_box_title', line: 'home.map_box_line', picture: null },
    { id: 'grill', title: 'home.map_card_place_title', line: 'home.map_card_place_line', picture: mapPicture('grill', night) },
    { id: 'sweets', title: 'home.map_card_tour_title', line: 'home.map_card_tour_line', picture: mapPicture('sweets', night) },
    { id: 'cafe', title: 'home.map_card_sun_title', line: night ? 'home.map_card_sun_line_night' : 'home.map_card_sun_line_day', picture: mapPicture('cafe', !night) },
  ];
}
