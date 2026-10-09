import { AZIZIYAH_ZONES, type ZoneTier } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { labelDigits } from '@driver/map';

/**
 * Enum → Console label. Keys are built from the enum value (console dot group underscore value), so a new
 * enum member without a string shows its key in QA instead of rendering blank (voice guide §6).
 * Each call names its whole key prefix, so the build's string subset (scripts/locale-subset.mjs)
 * keeps only those groups and not every Console key.
 */
const k = (prefix: string, value: string) => t(`${prefix}${value}` as MessageKey);

export const verticalLabel = (v: string) => k('console.vertical_', v);
export const tierLabel = (tier: ZoneTier) => k('console.tier_', tier);
export const tripStateLabel = (s: string) => k('console.trip_state_', s);
export const orderStateLabel = (s: string) => k('console.order_state_', s);
export const orderTypeLabel = (s: string) => k('console.order_type_', s);
export const stopTypeLabel = (s: string) => k('console.stop_type_', s);
export const stopStateLabel = (s: string) => k('console.stop_state_', s);
export const offerStateLabel = (s: string) => k('console.offer_', s);
export const paymentLabel = (s: string) => k('console.payment_', s);
export const participantRoleLabel = (s: string) => k('console.role_', s);
export const capRoleLabel = (s: string) => k('console.cap_role_', s);
export const capTierLabel = (s: string) => k('console.cap_tier_', s);
export const settleModeLabel = (s: string) => k('console.settle_mode_', s);
export const channelLabel = (s: string) => k('console.channel_', s);
export const timelineStepLabel = (s: string) => k('console.step_', s);
export const priceLabel = (s: string) => k('console.price_', s);
export const vehicleLabel = (s: string) => k('console.vehicle_', s);
export const pinStateLabel = (s: string) => k('console.pin_state_', s);

const ZONES = new Map(AZIZIYAH_ZONES.map((z) => [z.id, z]));

/** Arabic zone name in Western digits ("شارع 30"), or the raw id for zones outside the seed (Kut, Baghdad…). */
export function zoneName(zoneId: string): string {
  const name = ZONES.get(zoneId)?.name_ar;
  return name ? labelDigits(name) : zoneId;
}

export function zoneTier(zoneId: string): ZoneTier | undefined {
  return ZONES.get(zoneId)?.tier;
}
