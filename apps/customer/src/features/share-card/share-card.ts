import type { MessageKey } from '@driver/i18n';
import type { DishKind, SceneVehicle } from '@driver/ui';
import { motifForDish } from '@/features/food/food-art';

/**
 * The share card after a good moment (joy l5, delight H1): a story-sized picture (9:16) with the dish
 * or the arrival scene from the sketchbook and one warm line. Never a price, an address or a phone;
 * the person's first name only when he turns «حط اسمي» on. The same model feeds the phone's captured
 * view and the web's canvas, so both say the same thing.
 */

export interface Copy {
  key: MessageKey;
  params?: Record<string, string | number>;
}

export type ShareMoment =
  | { kind: 'food'; dishName: string | null; merchant: string }
  | { kind: 'ride'; vehicle: 'tuktuk' | 'car' }
  | { kind: 'rajaa'; toCity: string | null };

export type CardArt = { dish: DishKind } | { scene: 'safe_arrival'; vehicle: SceneVehicle };

export interface ShareCardModel {
  art: CardArt;
  /** The big line in Marhey (≤ 6 words). */
  head: Copy;
  /** The smaller line under it; null when there is nothing honest to add. */
  sub: Copy | null;
  brand: Copy;
}

/** Baghdad has no daylight saving: UTC+3 all year. */
const BAGHDAD_OFFSET_MIN = 180;

/** ريوگ before 11:00, غدا until 17:00, عشا after (Baghdad clock): how people here name the meal. */
export function mealOf(at: Date): 'breakfast' | 'lunch' | 'dinner' {
  const minutes = (at.getUTCHours() * 60 + at.getUTCMinutes() + BAGHDAD_OFFSET_MIN) % (24 * 60);
  if (minutes >= 4 * 60 && minutes < 11 * 60) return 'breakfast';
  if (minutes >= 11 * 60 && minutes < 17 * 60) return 'lunch';
  return 'dinner';
}

/** The first name alone, trimmed; null when there is none (the card then speaks as «نا»). */
export function firstNameOnly(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return first ? first.slice(0, 20) : null;
}

export function shareCardModel(moment: ShareMoment, opts: { at: Date; name: string | null; includeName: boolean }): ShareCardModel {
  const name = opts.includeName ? firstNameOnly(opts.name) : null;
  const brand: Copy = { key: 'sharecard.brand' };
  switch (moment.kind) {
    case 'food': {
      const meal = mealOf(opts.at);
      return {
        art: { dish: motifForDish(moment.dishName ?? '') },
        head: { key: 'sharecard.food_head' },
        sub: name ? { key: `sharecard.meal_${meal}_name` as MessageKey, params: { name, merchant: moment.merchant } } : { key: `sharecard.meal_${meal}` as MessageKey, params: { merchant: moment.merchant } },
        brand,
      };
    }
    case 'ride':
      return {
        art: { scene: 'safe_arrival', vehicle: moment.vehicle },
        head: name ? { key: 'sharecard.ride_head_name', params: { name } } : { key: 'sharecard.ride_head' },
        sub: { key: moment.vehicle === 'tuktuk' ? 'sharecard.ride_tuktuk' : 'sharecard.ride_taxi' },
        brand,
      };
    case 'rajaa':
      return {
        art: { scene: 'safe_arrival', vehicle: 'minibus' },
        head: { key: 'sharecard.rajaa_head' },
        sub: moment.toCity ? (name ? { key: 'sharecard.rajaa_to_name', params: { name, city: moment.toCity } } : { key: 'sharecard.rajaa_to', params: { city: moment.toCity } }) : null,
        brand,
      };
  }
}

/** «driver-food-<id>.png»: no name, no place in the file name either. */
export function cardFileName(kind: ShareMoment['kind'], id: string): string {
  return `driver-${kind}-${id.replace(/[^A-Za-z0-9]/g, '').slice(-8)}.png`;
}

/** The hint under the preview: food says no prices or address; trips say no address. */
export function cardHint(kind: ShareMoment['kind']): MessageKey {
  return kind === 'food' ? 'sharecard.hint' : 'sharecard.hint_trip';
}
