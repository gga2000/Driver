import { AZIZIYAH_ZONES, type ZoneTier } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';

/**
 * Enum → Console label. Keys are built from the enum value (`console.<group>_<value>`), so a new
 * enum member without a string shows its key in QA instead of rendering blank (voice guide §6).
 */
const k = (group: string, value: string) => t(`console.${group}_${value}` as MessageKey);

export const verticalLabel = (v: string) => k('vertical', v);
export const tierLabel = (tier: ZoneTier) => k('tier', tier);
export const tripStateLabel = (s: string) => k('trip_state', s);
export const orderStateLabel = (s: string) => k('order_state', s);
export const orderTypeLabel = (s: string) => k('order_type', s);
export const stopTypeLabel = (s: string) => k('stop_type', s);
export const stopStateLabel = (s: string) => k('stop_state', s);
export const offerStateLabel = (s: string) => k('offer', s);
export const paymentLabel = (s: string) => k('payment', s);
export const participantRoleLabel = (s: string) => k('role', s);
export const capRoleLabel = (s: string) => k('cap_role', s);
export const capTierLabel = (s: string) => k('cap_tier', s);
export const settleModeLabel = (s: string) => k('settle_mode', s);
export const channelLabel = (s: string) => k('channel', s);
export const timelineStepLabel = (s: string) => k('step', s);
export const priceLabel = (s: string) => k('price', s);
export const vehicleLabel = (s: string) => k('vehicle', s);
export const pinStateLabel = (s: string) => k('pin_state', s);

const ZONES = new Map(AZIZIYAH_ZONES.map((z) => [z.id, z]));

/** Arabic zone name, or the raw id for zones outside the seed (Kut, Baghdad…). */
export function zoneName(zoneId: string): string {
  return ZONES.get(zoneId)?.name_ar ?? zoneId;
}

export function zoneTier(zoneId: string): ZoneTier | undefined {
  return ZONES.get(zoneId)?.tier;
}
