import type { LatLng, ReportMapFixInput } from '@driver/contracts';
import { roundDoor } from '@/features/join-kitchen/door';

/**
 * «مكاني على الخريطة»: a shop tells our team its pin is wrong (it moved) or its name on the map is
 * wrong. The fix lands in the Console's map inbox (`ops.mapEditor.report`); nothing on the map
 * changes until the team checks it. Plain Node, tested.
 */

export type MyMapKind = 'moved' | 'wrong_name';

/** Less than this from the pin on file is the same door: a nudge, not a move. */
export const MOVE_MIN_M = 15;
/** The server's limits (MAP_EDITOR_RULES.nameMax / noteMax), kept here so the screen pulls no schemas. */
export const NAME_MAX = 60;
export const NOTE_MAX = 200;

const CITY_ID = 'aziziyah';
const EARTH_M = 6_371_000;

/** Metres between two points (haversine; plenty for one town). */
export function metresBetween(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface MyMapDraft {
  kind: MyMapKind;
  /** Where the map's centre pin is now; null until the map first moves. */
  pin: LatLng | null;
  name: string;
  note: string;
}

/** Why «دزّ للفريق» is off, or null when it can go. */
export type MyMapBlocker = 'no_map' | 'move_more' | 'name_missing' | 'name_same';

export function blockerOf(draft: MyMapDraft, ctx: { current: LatLng | null; storeName: string; mapOk: boolean }): MyMapBlocker | null {
  if (draft.kind === 'moved') {
    if (!ctx.mapOk) return 'no_map';
    if (!draft.pin) return 'move_more';
    // No pin on file yet: any place she chose is news to the team.
    if (ctx.current && metresBetween(ctx.current, draft.pin) < MOVE_MIN_M) return 'move_more';
    return null;
  }
  const name = draft.name.trim();
  if (!name) return 'name_missing';
  if (name === ctx.storeName.trim()) return 'name_same';
  return null;
}

/** The report sent to the team: the pin only for a move, the name only for a wrong name. */
export function toReportInput(orgId: string, draft: MyMapDraft): ReportMapFixInput {
  const note = draft.note.trim().slice(0, NOTE_MAX);
  return {
    cityId: CITY_ID,
    kind: draft.kind,
    target: { kind: 'restaurant', id: orgId },
    ...(draft.kind === 'moved' && draft.pin ? { pin: roundDoor(draft.pin) } : {}),
    ...(draft.kind === 'wrong_name' ? { name_ar: draft.name.trim().slice(0, NAME_MAX) } : {}),
    ...(note ? { note } : {}),
  };
}
