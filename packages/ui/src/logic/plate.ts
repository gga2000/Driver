/**
 * Iraqi plates mix a governorate word and the number, written either way round ("واسط 45678",
 * "12345 بغداد", sometimes with a series letter "أ 45678 واسط"). The plate chip draws the number
 * big and the governorate small, like the plate itself, so it is read in one glance at the kerb.
 */
export interface PlateParts {
  /** Digits (and any Latin series letters), kept left to right. */
  number: string;
  /** Governorate / Arabic words, or null when the plate has none. */
  region: string | null;
}

const ARABIC = /[؀-ۿ]/;

export function splitPlate(plate: string): PlateParts {
  const tokens = plate.trim().split(/\s+/).filter(Boolean);
  const words = tokens.filter((t) => ARABIC.test(t) && !/\d/.test(t));
  const rest = tokens.filter((t) => !words.includes(t));
  // A lone Arabic series letter ("أ") belongs with the number; a governorate is a real word.
  const series = words.filter((w) => Array.from(w).length === 1);
  const region = words.filter((w) => Array.from(w).length > 1);
  const number = [...series, ...rest].join(' ');
  if (!number) return { number: plate.trim(), region: null };
  return { number, region: region.length > 0 ? region.join(' ') : null };
}
