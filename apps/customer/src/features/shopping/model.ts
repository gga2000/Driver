/**
 * The shopping side's shapes as the customer app reads them (round 2, Ali 2026-10-11): the shopping
 * API's views. Names and descriptions are the shop's own words (data), not app copy.
 */

import type { BakeryItemView, BakeryView, ProduceItemView, ShoppingFront as ShoppingFrontView, ShopState as ShopStateView, StallView } from '@driver/contracts/shopping';

/** How a produce item is sold: by the kilo on the scale, or by the piece (a watermelon). */
export type SoldBy = ProduceItemView['soldBy'];
export type ProduceItem = ProduceItemView;
export type Stall = StallView;
/** Ali 2026-10-11 21:26Z: no batches, a bakery bakes all day; the baker opens, pauses or closes. */
export type ShopState = ShopStateView;
export type BakeryItem = BakeryItemView;
export type Bakery = BakeryView;
/** The front door's live facts (`shopping.front`). */
export type ShoppingFront = ShoppingFrontView;

/** A line in the produce basket: an item and how much of it. */
export interface BasketLine {
  stallId: string;
  itemId: string;
  /** Grams when sold by the kilo, pieces when sold by the piece. */
  amount: number;
  note: string;
}
