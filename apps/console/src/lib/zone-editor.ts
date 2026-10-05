import { pointInRing, ringCentroid, ZONE_MIN_POINTS, type LatLng } from '@driver/contracts';

/** How many steps "تراجع" remembers. */
export const UNDO_LIMIT = 50;

export interface EditorState {
  key: string | null;
  saved: { ring: LatLng[]; centre: LatLng } | null;
  ring: LatLng[];
  centre: LatLng;
  selected: number | null;
  undo: Array<{ ring: LatLng[]; centre: LatLng }>;
}

export type EditorAction =
  | { type: 'open'; key: string; ring: LatLng[]; centre: LatLng }
  | { type: 'close' }
  /** A drag starts: remember the shape once, so one drag is one undo step. */
  | { type: 'begin' }
  | { type: 'moveVertex'; index: number; to: LatLng }
  | { type: 'moveShape'; to: LatLng }
  | { type: 'insertVertex'; after: number; at: LatLng }
  | { type: 'removeVertex'; index: number }
  | { type: 'select'; index: number | null }
  | { type: 'undo' }
  | { type: 'reset' };

export const closedEditor: EditorState = { key: null, saved: null, ring: [], centre: { lat: 0, lng: 0 }, selected: null, undo: [] };

const snapshot = (s: EditorState) => ({ ring: s.ring, centre: s.centre });
const pushUndo = (s: EditorState) => [...s.undo, snapshot(s)].slice(-UNDO_LIMIT);
/** After a corner edit the centre must stay inside; if it fell out, move it to the middle. */
const keepCentre = (ring: LatLng[], centre: LatLng): LatLng => (ring.length >= ZONE_MIN_POINTS && !pointInRing(centre, ring) ? ringCentroid(ring) : centre);

/** Pure outline editor behind the Zones page; the map only dispatches actions. */
export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case 'open':
      return { key: a.key, saved: { ring: a.ring, centre: a.centre }, ring: a.ring, centre: a.centre, selected: null, undo: [] };
    case 'close':
      return closedEditor;
    case 'begin':
      return { ...s, undo: pushUndo(s) };
    case 'moveVertex': {
      if (!s.ring[a.index]) return s;
      const ring = s.ring.map((p, i) => (i === a.index ? a.to : p));
      return { ...s, ring, centre: keepCentre(ring, s.centre), selected: a.index };
    }
    case 'moveShape': {
      const dLat = a.to.lat - s.centre.lat;
      const dLng = a.to.lng - s.centre.lng;
      return { ...s, centre: a.to, ring: s.ring.map((p) => ({ lat: p.lat + dLat, lng: p.lng + dLng })) };
    }
    case 'insertVertex': {
      const ring = [...s.ring.slice(0, a.after + 1), a.at, ...s.ring.slice(a.after + 1)];
      return { ...s, undo: pushUndo(s), ring, centre: keepCentre(ring, s.centre), selected: a.after + 1 };
    }
    case 'removeVertex': {
      if (s.ring.length <= ZONE_MIN_POINTS || !s.ring[a.index]) return s;
      const ring = s.ring.filter((_, i) => i !== a.index);
      return { ...s, undo: pushUndo(s), ring, centre: keepCentre(ring, s.centre), selected: null };
    }
    case 'select':
      return { ...s, selected: a.index };
    case 'undo': {
      const last = s.undo[s.undo.length - 1];
      return last ? { ...s, ...last, undo: s.undo.slice(0, -1), selected: null } : s;
    }
    case 'reset':
      return s.saved ? { ...s, ring: s.saved.ring, centre: s.saved.centre, undo: [], selected: null } : s;
  }
}

export function isDirty(s: EditorState): boolean {
  return s.saved !== null && (s.ring !== s.saved.ring || s.centre !== s.saved.centre) && JSON.stringify(snapshot(s)) !== JSON.stringify(s.saved);
}

/** The "+" handles: the middle of each edge (corner i → corner i+1). */
export function midpoints(ring: readonly LatLng[]): LatLng[] {
  return ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    return { lat: (p.lat + q.lat) / 2, lng: (p.lng + q.lng) / 2 };
  });
}
