import { cityParts, formatClock } from '@driver/i18n';
import type { BoardGroup, BoardLine, BoardOrder } from '@driver/contracts';
import { mentionsAllergy } from '@driver/contracts';
import type { Locale, TKey } from '@/lib/i18n-core';
import { amountParam } from '@/lib/money';
import type { PrintItem, PrintMod } from './doc';
import type { PaperSpec } from './paper';

/** What every ticket builder needs: words, the store, the paper and when it prints. */
export interface PrintCtx {
  t: (key: TKey, params?: Record<string, string | number>) => string;
  locale: Locale;
  storeName: string;
  /** The moment of printing (the foot's «انطبع 8:43 م»). */
  now: Date;
  paper: PaperSpec;
}

/** «8:43 م» (Baghdad clock, Western digits). */
export function clock(ctx: PrintCtx, at: Date): string {
  return formatClock(at, { locale: ctx.locale });
}

/** «8:57» without the part of day (the ready box prints «مساءً» under it). */
export function bareClock(ctx: PrintCtx, at: Date): string {
  return formatClock(at, { locale: ctx.locale, period: false });
}

export function periodWord(ctx: PrintCtx, at: Date): string {
  return ctx.t(cityParts(at).hour < 12 ? 'merchant.ticket.morning' : 'merchant.ticket.evening');
}

/** `23500` → «23,500»: amounts exactly as the server sent them, never added up here. */
export function amount(n: number): string {
  return amountParam(n);
}

/** «لـ أبو حسين» / «صاحب الطلب». */
export function whoLabel(ctx: PrintCtx, g: Pick<BoardGroup, 'kind' | 'label'>): string {
  return g.kind === 'orderer' || !g.label ? ctx.t('merchant.receipt.orderer') : ctx.t('merchant.receipt.for', { name: g.label });
}

const WITHOUT = /^(بدون|بلا|بلاش|مو|without|no)(\s|$)/i;

/**
 * A dish's wishes: chosen extras with a drawn + (i05), and the customer's note split at commas —
 * «بدون …» with a drawn ✕ in bold, anything else bold with a dot. An allergy note is not a wish: it
 * goes in the black band and on the dish's own allergy box (i03, i04).
 */
export function modsOf(l: Pick<BoardLine, 'modifiers' | 'note'>): PrintMod[] {
  const out: PrintMod[] = l.modifiers.map((text) => ({ text, mark: 'plus' as const }));
  if (l.note && !mentionsAllergy(l.note)) {
    for (const part of l.note.split(/[،,؛;\n]+/)) {
      const text = part.trim();
      if (text) out.push({ text, mark: WITHOUT.test(text) ? 'no' : 'note' });
    }
  }
  return out;
}

/** The wishes as one small line on the customer slip («صمون، حار، بدون بصل»). */
export function modsLine(l: Pick<BoardLine, 'modifiers' | 'note'>): string | undefined {
  const all = modsOf(l).map((m) => m.text);
  return all.length ? all.join('، ') : undefined;
}

export function itemOf(l: BoardLine): PrintItem {
  return { qty: l.qty, name: l.name, mods: modsOf(l), ...(l.note && mentionsAllergy(l.note) ? { allergy: l.note } : {}) };
}

/** Counted phrase with its Arabic plural («صنفين», «9 أصناف»). */
export function items(ctx: PrintCtx, count: number): string {
  return ctx.t('merchant.card.items', { count });
}

export interface AllergyNote {
  text: string;
  /** Whose and which dish («لـ أبو حسين · الكنافة»). */
  where?: string;
}

/**
 * Every allergy on the order (the board's rule, `mentionsAllergy`), in reading order: the order note,
 * then each person's note and each dish note. Only real allergies, never «بدون بصل» (i04).
 */
export function allergiesOf(ctx: PrintCtx, o: Pick<BoardOrder, 'note' | 'groups'>): AllergyNote[] {
  const out: AllergyNote[] = [];
  if (o.note && mentionsAllergy(o.note)) out.push({ text: o.note, where: ctx.t('merchant.ticket.order_note') });
  for (const g of o.groups) {
    if (g.note && mentionsAllergy(g.note)) out.push({ text: g.note, where: whoLabel(ctx, g) });
    for (const l of g.lines) {
      if (l.availability !== 'available' || !l.note || !mentionsAllergy(l.note)) continue;
      out.push({ text: l.note, where: `${whoLabel(ctx, g)} · ${l.name}` });
    }
  }
  return out;
}
