import { z } from 'zod';

/**
 * How the kitchen ticket marks a dish (k4/j6): the Merchant app guesses it from the dish's name, and
 * the owner can say it when the guess is wrong. Kept in the dish's `labels` column as `kind:<value>`
 * (no migration; the API's `catalog/dish-kind.ts` reads and writes it); customers never see it.
 * Its own file so the board contracts (`merchant-io`) don't pull the whole catalog module along.
 */
export const DISH_KINDS = ['food', 'hot_drink', 'cold_drink', 'sweet'] as const;
export const DishKind = z.enum(DISH_KINDS);
export type DishKind = z.infer<typeof DishKind>;
