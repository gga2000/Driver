import type { CarryOverOption } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import type { CartState } from './cart';

/**
 * A rejection that explains (joy o15, audit F-23) as plain data: why the kitchen said no in the
 * customer's words, and what each suggested kitchen can do with the cart. The figures are the
 * server's (`catalog.carryOver`).
 */

export interface Copy {
  key: MessageKey;
  params?: Record<string, string | number>;
}

/**
 * The reason on the order: the Merchant app's codes (sold_out, too_busy, closed, "other: …"), the 90 s
 * running out (merchant_timeout), or a kitchen's own words. Null when there is nothing to say.
 */
export function rejectionReason(code: string | null | undefined): Copy | null {
  const c = code?.trim();
  if (!c) return null;
  switch (c) {
    case 'sold_out':
      return { key: 'kitchen.reason_sold_out' };
    case 'too_busy':
      return { key: 'kitchen.reason_busy' };
    case 'closed':
      return { key: 'kitchen.reason_closed' };
    case 'merchant_timeout':
      return { key: 'kitchen.reason_timeout' };
    case 'partial_timeout':
      return { key: 'kitchen.reason_partial_timeout' };
  }
  if (c.startsWith('other:')) {
    const words = c.slice('other:'.length).trim();
    return words ? { key: 'kitchen.reason_words', params: { words } } : null;
  }
  // Codes we don't know stay unsaid; a kitchen's Arabic words are shown as they are.
  return /^[a-z_]+$/.test(c) ? null : { key: 'kitchen.reason_words', params: { words: c } };
}

/** The refused cart as `catalog.carryOver` lines: dish names, quantities and chosen options by name. */
export function carryLines(cart: Pick<CartState, 'lines'>): Array<{ name: string; qty: number; choices: string[] }> {
  return cart.lines.map((l) => ({ name: l.name, qty: l.qty, choices: l.modifiers.map((m) => m.name) }));
}

/** «كل أصنافك موجودة · تقريباً 14,750 دينار», «2 من 3 أصنافك · …», or «ماكو نفس أصنافك هناك». */
export function optionCopy(o: Pick<CarryOverOption, 'moved' | 'of' | 'totalIqd'>, amount: (n: number) => string): Copy {
  if (o.moved === 0) return { key: 'kitchen.option_none' };
  const total = o.totalIqd !== null ? amount(o.totalIqd) : null;
  if (o.moved === o.of) return total ? { key: 'kitchen.option_all', params: { total } } : { key: 'kitchen.option_all_no_total' };
  return total ? { key: 'kitchen.option_some', params: { n: o.moved, of: o.of, total } } : { key: 'kitchen.option_some_no_total', params: { n: o.moved, of: o.of } };
}
