import { z } from 'zod';

/**
 * «عندي غراض» (ride idea x5, the souq): the rider says he carries shopping bags, a gas cylinder or
 * something big. It rides with the order (`orders.ride_cargo`) so the driver sees «عنده غراض: …» on the
 * offer before he accepts and on the trip; the choose screen points to the tuktuk as the best fit.
 * Information only: it never changes the price or who is offered the ride.
 */
export const RideCargo = z.enum(['bags', 'gas', 'big']);
export type RideCargo = z.infer<typeof RideCargo>;

/** Chip and card order: the everyday souq bags first. */
export const RIDE_CARGO_ORDER: readonly RideCargo[] = ['bags', 'gas', 'big'];

/** The rider's picks, each once, in `RIDE_CARGO_ORDER` (what the order stores and every card shows). */
export function sortCargo(cargo: readonly RideCargo[]): RideCargo[] {
  return RIDE_CARGO_ORDER.filter((c) => cargo.includes(c));
}

/** i18n key of a cargo kind's name («أكياس سوق»، «قنينة غاز»، «غراض كبيرة»). */
export function rideCargoKey(c: RideCargo): `ride.cargo.${RideCargo}` {
  return `ride.cargo.${c}`;
}

/** `PlaceOrderInput.rideCargo`: at most one of each kind. */
export const RideCargoInput = z
  .array(RideCargo)
  .max(RIDE_CARGO_ORDER.length)
  .refine((a) => new Set(a).size === a.length, { message: 'each kind once' });
