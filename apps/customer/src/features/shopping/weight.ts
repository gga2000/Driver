/**
 * Weighing produce (Ali, 2026-10-11: "people here are particular about their fruits and vegetables,
 * have the options for people to select the weight from a beautiful selector"). Grams throughout; the
 * dial snaps to a quarter kilo, the way a stall weighs. The price shown is an estimate: the order's
 * real amount is computed on the server from the stall's published price.
 */
export const WEIGHT_STEP_G = 250;
export const WEIGHT_MAX_G = 3000;
export const WEIGHT_PRESETS_G = [250, 500, 1000, 1500, 2000] as const;

/** Snap a dial reading to the nearest quarter kilo, never below a quarter or above the dial. */
export function snapWeight(grams: number): number {
  const snapped = Math.round(grams / WEIGHT_STEP_G) * WEIGHT_STEP_G;
  return Math.min(WEIGHT_MAX_G, Math.max(WEIGHT_STEP_G, snapped));
}

/** Cash in Iraq moves in 250s: the estimate rounds up to the next 250 دينار. */
export function roundUpCash(iqd: number): number {
  return Math.ceil(iqd / 250) * 250;
}

/**
 * What `grams` of something priced per kilo comes to: the server's own rule (`priceForWeight`), so the
 * basket shows what the order will charge; cash rounding happens once, on the order's total.
 */
export { priceForWeight } from '@driver/contracts';

/** Pieces in `grams`, from the item's usual pieces per kilo: a [low, high] range, or null. */
export function piecesFor(
  perKg: readonly [number, number] | null | undefined,
  grams: number,
): [number, number] | null {
  if (!perKg) return null;
  const low = Math.max(1, Math.floor((perKg[0] * grams) / 1000));
  const high = Math.max(low, Math.ceil((perKg[1] * grams) / 1000));
  return [low, high];
}

/**
 * The words for a weight the way a stall says it: ربع، نص، كيلو، كيلو ونص، 2 كيلو، 2 كيلو ونص.
 * `key` is an i18n key under `shopping.weight.*`, `kilos` the whole kilos when it has them.
 */
export function weightWords(grams: number): { key: string; kilos?: number } {
  const kilos = Math.floor(grams / 1000);
  const rest = grams - kilos * 1000;
  if (kilos === 0)
    return {
      key:
        rest === 250
          ? 'shopping.weight.quarter'
          : rest === 500
            ? 'shopping.weight.half'
            : 'shopping.weight.three_quarters',
    };
  if (rest === 0)
    return kilos === 1 ? { key: 'shopping.weight.one' } : { key: 'shopping.weight.kilos', kilos };
  if (rest === 500)
    return kilos === 1
      ? { key: 'shopping.weight.one_half' }
      : { key: 'shopping.weight.kilos_half', kilos };
  if (rest === 250) return { key: 'shopping.weight.kilos_quarter', kilos };
  return { key: 'shopping.weight.kilos_three_quarters', kilos };
}

/** The dial's reading in kilos with at most two decimals, Western digits: 1.5, 0.25, 2. */
export function kilosLabel(grams: number): string {
  return String(Math.round(grams / 10) / 100);
}
