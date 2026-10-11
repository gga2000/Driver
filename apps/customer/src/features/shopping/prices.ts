import type { ProduceItem } from './model';

/** How today's price stands against yesterday's, for the line under a stall's photo. */
export type PriceMove =
  | { kind: 'down' | 'up'; byIqd: number }
  | { kind: 'same' }
  /** New today: nothing to compare. */
  | { kind: 'new' }
  /** The stall hasn't published today yet: the price shown is yesterday's. */
  | { kind: 'yesterday' };

export function priceMove(
  item: Pick<ProduceItem, 'priceIqd' | 'yesterdayIqd' | 'priceFromYesterday'>,
): PriceMove {
  if (item.priceFromYesterday) return { kind: 'yesterday' };
  if (item.yesterdayIqd == null) return { kind: 'new' };
  const diff = item.priceIqd - item.yesterdayIqd;
  if (diff === 0) return { kind: 'same' };
  return diff < 0 ? { kind: 'down', byIqd: -diff } : { kind: 'up', byIqd: diff };
}
