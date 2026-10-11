/**
 * The shopping side's shapes as the customer app reads them (round 2, Ali 2026-10-11). They mirror
 * what the shopping API will return; until it exists the screens read `demo.ts` through `queries.ts`.
 * Names and descriptions are the shop's own words (data), not app copy.
 */

/** How a produce item is sold: by the kilo on the scale, or by the piece (a watermelon). */
export type SoldBy = 'kg' | 'piece';

export interface ProduceItem {
  id: string;
  name: string;
  /** `/media/...` path of the stall's photo of it. */
  photo: string;
  /** True when the stall photographed it this morning; false shows «صورة البارحة». */
  photoToday: boolean;
  soldBy: SoldBy;
  /** Today's published price, per kilo or per piece. */
  priceIqd: number;
  /** Yesterday's price, null for an item new today. */
  yesterdayIqd: number | null;
  /** True when the stall has not published today's price yet: the price is yesterday's. */
  priceFromYesterday: boolean;
  /** Usual pieces in a kilo, for «تقريباً 9 إلى 10 طماطات» (null when it varies too much). */
  piecesPerKg: readonly [number, number] | null;
  /** The plural the hint counts in («طماطات»), from the stall's item list. */
  piecesWord: string | null;
}

export interface Stall {
  id: string;
  name: string;
  area: string;
  rating: number;
  /** Minutes from the customer, as the ETA learns them. */
  minutes: number;
  /** When the stall published today's photos and prices («6:12»), null if not yet. */
  postedAt: string | null;
  photo: string;
  items: ProduceItem[];
}

/** Ali 2026-10-11 21:26Z: no batches, a bakery bakes all day; the baker opens, pauses or closes. */
export type ShopState = 'open' | 'paused' | 'closed';

export interface BakeryItem {
  id: string;
  name: string;
  /** How many come for `priceIqd` («4 بـ 1,000»). */
  per: number;
  priceIqd: number;
}

export interface Bakery {
  id: string;
  name: string;
  street: string;
  state: ShopState;
  /** «11:00» closing time today. */
  closesAt: string;
  /** Paused: when it takes orders again by itself («4:30»). */
  resumesAt: string | null;
  /** Closed: when it opens next («5:00 الصبح»). */
  opensAt: string | null;
  minutes: number;
  photo: string;
  items: BakeryItem[];
}

/** The front door's live facts. */
export interface ShoppingFront {
  bakeriesOpen: number;
  stalls: Stall[];
  bakeries: Bakery[];
}

/** A line in the produce basket: an item and how much of it. */
export interface BasketLine {
  stallId: string;
  itemId: string;
  /** Grams when sold by the kilo, pieces when sold by the piece. */
  amount: number;
  note: string;
}
