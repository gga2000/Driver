import type { DemandLevel, VehicleClass } from '@driver/contracts';
import type { PartnerTownPulse } from '@driver/contracts/town-pulse';
import type { LngLat } from '@/features/map/geo';
import type { DayStop } from './pulse-logic';

/** What the live home's map draws (the 3D Golden map on the web, the flat map elsewhere). */
export interface LiveTownMapProps {
  self: LngLat | null;
  online: boolean;
  vehicle: VehicleClass;
  /** The town around him (null while offline: the plain map). */
  pulse: PartnerTownPulse | null;
  /** «يومي» open: his deliveries today instead of the town. */
  day: readonly DayStop[] | null;
  /** N17 busy areas, drawn faint. */
  glow: ReadonlyArray<{ zoneId: string; level: DemandLevel; forYou?: boolean }>;
  glowAt: number;
  /** Screen covered by the top pills and the bottom card, so the camera frames what's between. */
  topInset: number;
  bottomInset: number;
}
