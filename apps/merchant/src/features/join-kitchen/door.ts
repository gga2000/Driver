import type { LatLng } from '@driver/contracts';
import { goldenMapUrls } from '@/features/area/golden-zones';

/** Aziziyah's centre: where the door map opens before she moves it to her street. */
export const CITY_CENTRE: LatLng = { lat: 32.9093, lng: 45.0636 };

/** Close enough to see the houses on her street. */
export const DOOR_ZOOM = 16.4;

// Inlined by the build (Expo only replaces `process.env.EXPO_PUBLIC_*` written out in full).
export const DOOR_MAP_URLS = goldenMapUrls({ EXPO_PUBLIC_MAP_TILES_URL: process.env.EXPO_PUBLIC_MAP_TILES_URL, EXPO_PUBLIC_MAP_GLYPHS_URL: process.env.EXPO_PUBLIC_MAP_GLYPHS_URL });

export interface DoorMapProps {
  /** Where the pin is now (the map's centre); null until she first moves it. */
  value: LatLng | null;
  onChange: (at: LatLng) => void;
  /** No map in this build or it failed: the screen asks for a landmark instead. */
  onUnavailable: () => void;
  height: number;
}

/** Five decimals (about a metre): what the server keeps of a door. */
export function roundDoor(at: LatLng): LatLng {
  return { lat: Math.round(at.lat * 1e5) / 1e5, lng: Math.round(at.lng * 1e5) / 1e5 };
}
