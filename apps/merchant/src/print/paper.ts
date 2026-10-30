/**
 * Paper sizes for the kitchen printer (print redesign «الريل», Ali 2026-10-08 k5: shops buy their own
 * 58 mm or 80 mm printer and we support both). A thermal head prints 8 dots per mm; the image we send
 * is exactly as wide as the head:
 *   384 dots = 48 mm  (58 mm roll)
 *   512 dots = 64 mm  (80 mm roll, narrow head)
 *   576 dots = 72 mm  (80 mm roll)
 * 58 mm is a first-class size, not a shrunk 80: its type sizes are set on their own (dishes stay above
 * 5 mm) and lines wrap instead of shrinking. Sizes are the approved mock-up's, in millimetres.
 */

export type PrinterDots = 384 | 512 | 576;
export type PaperMm = 58 | 80;

export const PRINTER_DOTS: readonly PrinterDots[] = [384, 512, 576];
export const DOTS_PER_MM = 8;

export interface PaperSpec {
  /** The roll. */
  paperMm: PaperMm;
  /** The printer head, in dots (the image width). */
  dots: PrinterDots;
  /** Printable width (dots ÷ 8). */
  contentMm: number;
  /** Type and box sizes, mm. */
  num: number;
  item: number;
  mod: number;
  meta: number;
  qty: number;
  band: number;
}

const SIZES: Record<PaperMm, Omit<PaperSpec, 'paperMm' | 'dots' | 'contentMm'>> = {
  80: { num: 17, item: 6.4, mod: 4.9, meta: 3.7, qty: 9.5, band: 5 },
  58: { num: 12.5, item: 5.4, mod: 4.4, meta: 3.3, qty: 7.6, band: 4.4 },
};

export function paperOf(dots: PrinterDots): PaperMm {
  return dots === 384 ? 58 : 80;
}

export function paperSpec(dots: PrinterDots): PaperSpec {
  const paperMm = paperOf(dots);
  return { paperMm, dots, contentMm: dots / DOTS_PER_MM, ...SIZES[paperMm] };
}

export function isPrinterDots(v: unknown): v is PrinterDots {
  return v === 384 || v === 512 || v === 576;
}
