/**
 * How often the Golden hour light is checked (it changes a few times a day; the swap is a quiet cross-fade).
 * Its own file so the phone maps read it without `golden-setup`, whose web-only `pmtiles` import (and
 * fflate under it) would otherwise ride along in the phone bundle.
 */
export const LIGHT_CHECK_MS = 10 * 60_000;
