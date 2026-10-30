import { DriverMap } from '@/features/map/DriverMap';
import { VEHICLE_ICON } from '@/features/work/logic';
import type { LiveTownMapProps } from './live-map-types';
import { dayPoints } from './pulse-logic';
import { TownLayer } from './TownLayer';

/** The busy-area glow on the live home: faint, so it never covers the map (Ali, 2026-10-22: "very subtle"). */
export const LIVE_GLOW = 0.45;
/** The flat view: his part of town, about 2 km across. */
const FLAT_ZOOM = 13.9;

/**
 * The live home on the flat map: phones (the 3D Golden map is web-only in this app for now), low-data
 * mode, and a web build without our map files. Same town, drawn over `DriverMap`.
 */
export function FlatTownMap({ self, online, vehicle, pulse, day, glow, glowAt, topInset, bottomInset }: LiveTownMapProps) {
  return (
    <DriverMap
      testID="driver-map-home"
      self={self}
      vehicleIcon={VEHICLE_ICON[vehicle]}
      online={online}
      {...(online ? { heat: glow, heatAt: glowAt, heatStrength: LIVE_GLOW } : {})}
      layers={(m) => <TownLayer cam={m.cam} size={m.size} pulse={day ? null : pulse} day={day} />}
      {...(day ? { frame: dayPoints(day) } : {})}
      topInset={topInset}
      bottomInset={bottomInset}
      soloZoom={FLAT_ZOOM}
    />
  );
}
