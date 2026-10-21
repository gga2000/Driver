import { foldArabic, type LatLng, type MapLandmark, type MapLayers, type MapPinKind, type MapRestaurant } from '@driver/contracts';

/** The map editor's layers (Ali, 2026-10-20): areas, restaurants, landmarks, and the fixes inbox. */
export type MapLayer = 'zones' | 'restaurants' | 'landmarks' | 'review';
export const MAP_LAYERS: readonly MapLayer[] = ['zones', 'restaurants', 'landmarks', 'review'];

/** A pin the editor map draws. `tone` picks the look; only `draggable` pins can be moved. */
export interface EditorPin {
  key: string;
  kind: MapPinKind;
  id: string;
  name: string;
  pin: LatLng;
  category: MapLandmark['category'] | 'restaurant';
  tone: 'place' | 'hidden' | 'before' | 'after';
  draggable: boolean;
  /** Double-click on the label renames it in place (landmarks the editor may change). */
  renamable: boolean;
}

export const pinKey = (kind: MapPinKind, id: string) => `${kind}:${id}`;

export function restaurantPins(list: readonly MapRestaurant[], editable: boolean): EditorPin[] {
  return list.flatMap((r) =>
    r.pin ? [{ key: pinKey('restaurant', r.orgId), kind: 'restaurant' as const, id: r.orgId, name: r.name, pin: r.pin, category: 'restaurant' as const, tone: 'place' as const, draggable: editable, renamable: false }] : [],
  );
}

export function landmarkPins(list: readonly MapLandmark[], editable: boolean): EditorPin[] {
  return list.map((l) => ({
    key: pinKey('landmark', l.id),
    kind: 'landmark' as const,
    id: l.id,
    name: l.name_ar,
    pin: l.pin,
    category: l.category,
    tone: l.hidden ? ('hidden' as const) : ('place' as const),
    draggable: editable && !l.seeded,
    renamable: editable && !l.seeded,
  }));
}

/** Names and other names, folded (أ = ا, ة = ه), so «الجامع» finds «جامع». */
export function matchesQuery(query: string, ...names: ReadonlyArray<string | null | undefined>): boolean {
  const q = foldArabic(query.trim());
  if (!q) return true;
  return names.some((n) => n && foldArabic(n).includes(q));
}

/**
 * A drag of one pin of a selection moves the whole selection by the same step (metres stay metres at
 * this size of town), so a row of shops keeps its shape.
 */
export function groupMove(pins: readonly EditorPin[], selected: ReadonlySet<string>, draggedKey: string, to: LatLng): Array<{ kind: MapPinKind; id: string; pin: LatLng }> {
  const dragged = pins.find((p) => p.key === draggedKey);
  if (!dragged) return [];
  const dLat = to.lat - dragged.pin.lat;
  const dLng = to.lng - dragged.pin.lng;
  const moving = selected.has(draggedKey) ? pins.filter((p) => selected.has(p.key) && p.draggable) : [dragged];
  return moving.map((p) => ({ kind: p.kind, id: p.id, pin: p.key === draggedKey ? to : { lat: p.pin.lat + dLat, lng: p.pin.lng + dLng } }));
}

/** Pins inside the box dragged with Shift (screen corners already turned into lat/lng). */
export function pinsInBox(pins: readonly EditorPin[], a: LatLng, b: LatLng): string[] {
  const [s, n] = [Math.min(a.lat, b.lat), Math.max(a.lat, b.lat)];
  const [w, e] = [Math.min(a.lng, b.lng), Math.max(a.lng, b.lng)];
  return pins.filter((p) => p.pin.lat >= s && p.pin.lat <= n && p.pin.lng >= w && p.pin.lng <= e).map((p) => p.key);
}

/** «شنو يسمّونه الناس» typed as one line: comma or Arabic comma between names, blanks dropped. */
export function parseAliases(text: string): string[] {
  return [...new Set(text.split(/[,،]/).map((s) => s.trim()).filter(Boolean))];
}

export const emptyLayers: MapLayers = { restaurants: [], landmarks: [] };
