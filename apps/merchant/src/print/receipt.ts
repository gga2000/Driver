import type { BoardOrder } from '@driver/contracts';
import type { TKey } from '@/lib/i18n-core';
import { clock12 } from '@/lib/time';

/**
 * The 80 mm kitchen ticket, as data. One model feeds every printer: the web preview draws it, the
 * Bluetooth driver will rasterise it (ESC/POS printers have no Arabic shaping, so Arabic goes out as
 * an image — see printer.native.ts), and `toPlainText` gives a monospace fallback for logs and tests.
 * Items are grouped by person, notes in bold, exactly like the board card.
 */

export type ReceiptLine =
  | { kind: 'title'; text: string }
  | { kind: 'number'; text: string }
  | { kind: 'meta'; text: string }
  | { kind: 'payment'; text: string; cash: boolean }
  | { kind: 'person'; text: string; note: string | null }
  | { kind: 'item'; qty: number; name: string; modifiers: string[]; note: string | null; removed: boolean }
  | { kind: 'note'; text: string }
  | { kind: 'total'; label: string; value: string }
  | { kind: 'divider' }
  | { kind: 'footer'; text: string };

export interface Receipt {
  orderId: string;
  number: string;
  /** Paper width in mm (80 mm rolls, 72 mm printable). */
  paperMm: 80;
  lines: ReceiptLine[];
}

export interface ReceiptContext {
  storeName: string;
  t: (key: TKey, params?: Record<string, string | number>) => string;
  /** Formatted money with the currency word ("15,500 دينار"). */
  money: (amount: number) => string;
}

export function buildReceipt(o: BoardOrder, { storeName, t, money }: ReceiptContext): Receipt {
  const lines: ReceiptLine[] = [];
  lines.push({ kind: 'title', text: storeName });
  lines.push({ kind: 'number', text: t('merchant.receipt.order', { number: o.number }) });
  const times = [t('merchant.receipt.placed', { time: clock12(o.placedAt) })];
  if (o.promisedReadyAt) times.push(t('merchant.receipt.ready_by', { time: clock12(o.promisedReadyAt) }));
  lines.push({ kind: 'meta', text: times.join('  ·  ') });
  // «عزيمة» (joy g1): a gift whose sender hid the prices prints no amount anywhere on the ticket.
  const hidePrices = Boolean(o.gift?.hidePrices);
  lines.push(
    o.paymentMethod === 'cash' && !hidePrices
      ? { kind: 'payment', text: t('merchant.receipt.cash', { amount: money(o.collectCashIqd) }), cash: true }
      : { kind: 'payment', text: t('merchant.receipt.prepaid'), cash: false },
  );
  if (o.gift) lines.push({ kind: 'note', text: t(hidePrices ? 'merchant.receipt.gift_hidden' : 'merchant.receipt.gift') });
  lines.push({ kind: 'divider' });
  const several = o.groups.length > 1;
  for (const g of o.groups) {
    if (several || g.kind === 'participant') {
      const who = g.kind === 'orderer' ? t('merchant.receipt.orderer') : (g.label ?? t('merchant.receipt.orderer'));
      lines.push({ kind: 'person', text: g.kind === 'orderer' ? who : t('merchant.receipt.for', { name: who }), note: g.note });
    }
    for (const l of g.lines) {
      lines.push({ kind: 'item', qty: l.qty, name: l.name, modifiers: l.modifiers, note: l.note, removed: l.availability !== 'available' });
    }
  }
  if (o.note) {
    lines.push({ kind: 'divider' });
    lines.push({ kind: 'note', text: t('merchant.receipt.order_note', { note: o.note }) });
  }
  lines.push({ kind: 'divider' });
  if (!hidePrices) lines.push({ kind: 'total', label: t('merchant.receipt.items_total'), value: money(o.itemsTotalIqd) });
  lines.push({ kind: 'footer', text: t('merchant.receipt.footer') });
  return { orderId: o.id, number: o.number, paperMm: 80, lines };
}

/** Columns of Font A on an 80 mm printer. */
export const RECEIPT_COLUMNS = 48;

function wrap(text: string, width: number, indent = ''): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if ([...indent, ...next].length > width && line) {
      out.push(indent + line);
      line = word;
    } else line = next;
  }
  if (line) out.push(indent + line);
  return out.length ? out : [indent];
}

/** Monospace rendering (logical order; the printer or viewer handles direction). Bold → `**…**`. */
export function toPlainText(r: Receipt, width: number = RECEIPT_COLUMNS): string {
  const rows: string[] = [];
  const center = (s: string) => {
    const pad = Math.max(0, Math.floor((width - [...s].length) / 2));
    return ' '.repeat(pad) + s;
  };
  for (const l of r.lines) {
    switch (l.kind) {
      case 'title':
      case 'number':
        rows.push(center(l.text));
        break;
      case 'meta':
      case 'footer':
        rows.push(center(l.text));
        break;
      case 'payment':
        rows.push(...wrap(l.cash ? `**${l.text}**` : l.text, width));
        break;
      case 'person':
        rows.push(`** ${l.text} **`);
        if (l.note) rows.push(...wrap(`**${l.note}**`, width, '   '));
        break;
      case 'item': {
        const head = `${l.qty} × ${l.name}${l.removed ? ' ✗' : ''}`;
        rows.push(...wrap(head, width));
        if (l.modifiers.length) rows.push(...wrap(l.modifiers.join(' · '), width, '    '));
        if (l.note) rows.push(...wrap(`**${l.note}**`, width, '    '));
        break;
      }
      case 'note':
        rows.push(...wrap(`**${l.text}**`, width));
        break;
      case 'total': {
        const gap = Math.max(1, width - [...l.label].length - [...l.value].length);
        rows.push(l.label + ' '.repeat(gap) + l.value);
        break;
      }
      case 'divider':
        rows.push('-'.repeat(width));
        break;
    }
  }
  return rows.join('\n');
}
