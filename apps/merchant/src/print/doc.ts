import type { PaperSpec } from './paper';

/**
 * A printed document as data (print redesign «الريل», Ali 2026-10-08). Each block is one piece of the
 * approved mock-up (`/merchant-redesign/print/print.html`): the same blocks feed the on-screen paper
 * (`PaperDoc`), the browser's print page (`docHtml`), the plain-text log (`toPlainText`) and, on the
 * tablet build, the black-and-white image the printer gets. Black only: thermal paper has no grey, so
 * emphasis is a black band, a box, a dashed rule or bold type, never a shade.
 */

/** A wish on a dish: a chosen extra (+), «بدون …» (✕, bold), or a free note (bold). */
export interface PrintMod {
  text: string;
  mark: 'plus' | 'no' | 'note';
}

export interface PrintItem {
  qty: number;
  name: string;
  mods: PrintMod[];
  /** Under the name in small type («خلصت · الزبون وافق»). */
  sub?: string;
  /** The allergy that belongs to this dish, shown again on the dish (i03). */
  allergy?: string;
}

export type Block =
  /** A black band across the top: «نسخة ثانية», «تعديل على الطلب», «مجدول», «طلب كبير». */
  | { t: 'band'; title: string; sub?: string }
  /** The order number huge, with the ready-by box beside it. */
  | { t: 'head'; label: string; number: string; ready: { label: string; time: string; period: string } | null; code?: { label: string; value: string } }
  /** One line of small facts separated by dots («توصيل · انطلب 8:42 · 9 أصناف»). */
  | { t: 'facts'; parts: string[] }
  /** Allergy: a black band with a warning mark (i03); `small` on the packing ticket. */
  | { t: 'alert'; title: string; sub?: string; small?: boolean }
  /** The order note, before the dishes, in a dashed box (i07). */
  | { t: 'note'; label: string; text: string }
  /** A person's dishes start here: a thin labelled rule with their item count (i26). */
  | { t: 'who'; label: string; count?: number; note?: string }
  | ({ t: 'item' } & PrintItem)
  /** Run-out or removed dishes in a box, struck through (i15); also «زيد على الطلب» on a change ticket. */
  | { t: 'box'; tone: 'out' | 'add'; title: string; items: PrintItem[] }
  /** «9 أصناف بالكيس» (i25). */
  | { t: 'count'; text: string }
  /** Where to cut, with scissors. */
  | { t: 'tear'; text: string }
  /** The bag stub (i09–i12): number, pickup code, cash, items, bag n of m, courier. */
  | {
      t: 'stub';
      numberLabel: string;
      number: string;
      code: { label: string; value: string | null; blank: string };
      money: { kind: 'cash'; label: string; amount: string; unit: string } | { kind: 'paid'; text: string };
      items: string;
      bag: string;
      courier?: string;
    }
  /** Bottom line: «انطبع 8:43 م» and the small «درايفر» wordmark (i24, i30). */
  | { t: 'foot'; start: string; end: string; wordmark: boolean }
  // ── the customer slip ──
  /** The restaurant's name, large (k3). */
  | { t: 'store'; text: string }
  | { t: 'hello'; text: string }
  /** «طلب 4821» and the day and time. */
  | { t: 'meta'; label: string; number: string; when: string }
  /** The Ledger's double rule (i30). */
  | { t: 'double' }
  /** A slip row: qty, dish (+ wishes small), price from the server (absent on a gift). */
  | { t: 'row'; qty: number; name: string; sub?: string; price?: string }
  | { t: 'sum'; rows: { label: string; value: string }[] }
  | { t: 'total'; label: string; amount: string; unit: string }
  /** The round «كاش» stamp (i31), or the «مدفوع» box. */
  | { t: 'stamp'; kind: 'cash'; top: string; amount: string; unit: string }
  | { t: 'stamp'; kind: 'paid'; text: string }
  /** How to get help (i32). */
  | { t: 'help'; text: string }
  /** The gift card's top (i23). */
  | { t: 'gift'; title: string; line?: string; from: string }
  // ── stations and cafés ──
  /** A station's band: «الشوي» … «1 من 2» (i19). */
  | { t: 'station'; name: string; part: string }
  /** A packing line with a tick box. */
  | { t: 'pack'; qty: number; name: string; station: string }
  /** One cup label (i20). */
  | { t: 'cup'; number: string; part: string; name: string; mods: string }
  // ── calibration (i27) ──
  | { t: 'ruler'; bars: { dots: number; mm: number; label: string }[] }
  | { t: 'text'; text: string; strong?: boolean; center?: boolean };

export type DocKind = 'kitchen' | 'slip' | 'gift' | 'change' | 'station' | 'packing' | 'cups' | 'calibration';

export interface PrintDoc {
  kind: DocKind;
  orderId: string;
  number: string;
  paper: PaperSpec;
  blocks: Block[];
}

/**
 * One trip to the printer: the documents in order, a beep first when the printer has a buzzer (i28)
 * and a cut after each document when it has a cutter (i29).
 */
export interface PrintJob {
  orderId: string;
  number: string;
  docs: PrintDoc[];
  beep: boolean;
  cut: boolean;
}
