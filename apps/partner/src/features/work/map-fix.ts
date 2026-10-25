import { haversineM, type LatLng } from '@driver/contracts';

/**
 * «صلّح الخريطة» (Ali's pick C, 2026-10-22): after a pickup more than this far from the kitchen's pin,
 * the app asks once «المطعم جان هنا؟», and «إي» sends where he stood as the kitchen's real place.
 */
export const MAP_FIX_ASK_M = 40;
/** Further than this he was not at the kitchen at all (picked up from a car, a wrong tap): no question. */
export const MAP_FIX_FAR_M = 400;
/** A fix this rough could be the pin itself: no question. */
export const MAP_FIX_ROUGH_M = 30;

export type MapFixKind = 'moved' | 'wrong_name' | 'closed' | 'new_place';
/** What he can say: about the kitchen of this stop when it is one of ours, else only «مكان جديد». */
export function mapFixKinds(hasRestaurant: boolean): readonly MapFixKind[] {
  return hasRestaurant ? ['moved', 'wrong_name', 'closed', 'new_place'] : ['new_place'];
}

/** The device key that remembers he was asked about this kitchen (asked once, whatever he answered). */
export function askedKey(merchantOrgId: string): string {
  return `driver.partner.mapfix.asked.${merchantOrgId.replace(/[^\w.-]/g, '_')}`;
}

/** Metres from the kitchen's pin to where he picked up, when that is worth asking about; null otherwise. */
export function pickupAskDistance(pin: LatLng | null, fix: { lat: number; lng: number; accuracyM?: number } | null): number | null {
  if (!pin || !fix) return null;
  if (fix.accuracyM !== undefined && fix.accuracyM > MAP_FIX_ROUGH_M) return null;
  const m = haversineM(pin, fix);
  return m > MAP_FIX_ASK_M && m <= MAP_FIX_FAR_M ? Math.round(m) : null;
}

export type MapFixKey = 'partner.mapfix_thanks' | 'partner.mapfix_limit' | 'partner.mapfix_offline' | 'partner.mapfix_error' | 'partner.mapfix_outside';

/** What he reads when a report fails: `code` is the API envelope's code, `online` the phone's network. */
export function mapFixFailed(code: string | null, online: boolean): MapFixKey {
  if (code === 'map_reports_limit' || code === 'rate_limited') return 'partner.mapfix_limit';
  if (code === 'outside_zone') return 'partner.mapfix_outside';
  return online ? 'partner.mapfix_error' : 'partner.mapfix_offline';
}
