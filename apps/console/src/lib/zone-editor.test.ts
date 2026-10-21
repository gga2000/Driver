import { describe, expect, it } from 'vitest';
import type { LatLng } from '@driver/contracts';
import { closedEditor, editorReducer, isDirty, midpoints, snapCorner } from './zone-editor';

const RING: LatLng[] = [{ lat: 0, lng: 0 }, { lat: 0, lng: 2 }, { lat: 2, lng: 2 }, { lat: 2, lng: 0 }];
const open = editorReducer(closedEditor, { type: 'open', key: 'centre', ring: RING, centre: { lat: 1, lng: 1 } });

describe('zone editor', () => {
  it('opens clean', () => {
    expect(open).toMatchObject({ key: 'centre', ring: RING, selected: null });
    expect(isDirty(open)).toBe(false);
  });
  it('drag a corner: begin, move; undo restores; reset returns to saved', () => {
    let s = editorReducer(open, { type: 'begin' });
    s = editorReducer(s, { type: 'moveVertex', index: 2, to: { lat: 3, lng: 3 } });
    s = editorReducer(s, { type: 'moveVertex', index: 2, to: { lat: 2.5, lng: 2.5 } });
    expect(s.ring[2]).toEqual({ lat: 2.5, lng: 2.5 });
    expect(isDirty(s)).toBe(true);
    expect(editorReducer(s, { type: 'undo' }).ring).toEqual(RING);
    expect(editorReducer(s, { type: 'reset' }).ring).toEqual(RING);
  });
  it('insert after a corner and remove; never below 3 corners', () => {
    const ins = editorReducer(open, { type: 'insertVertex', after: 0, at: { lat: -1, lng: 1 } });
    expect(ins.ring).toHaveLength(5);
    expect(ins.ring[1]).toEqual({ lat: -1, lng: 1 });
    expect(ins.selected).toBe(1);
    let tri = editorReducer(open, { type: 'removeVertex', index: 0 });
    expect(tri.ring).toHaveLength(3);
    tri = editorReducer(tri, { type: 'removeVertex', index: 0 });
    expect(tri.ring).toHaveLength(3);
  });
  it('moving the centre moves the whole shape', () => {
    let s = editorReducer(open, { type: 'begin' });
    s = editorReducer(s, { type: 'moveShape', to: { lat: 2, lng: 3 } });
    expect(s.centre).toEqual({ lat: 2, lng: 3 });
    expect(s.ring[0]).toEqual({ lat: 1, lng: 2 });
  });
  it('a corner edit that leaves the centre outside pulls the centre back in', () => {
    const nearCorner = editorReducer(closedEditor, { type: 'open', key: 'centre', ring: RING, centre: { lat: 1.8, lng: 1.8 } });
    const s = editorReducer(nearCorner, { type: 'removeVertex', index: 2 });
    expect(s.centre).not.toEqual({ lat: 1.8, lng: 1.8 });
    expect(s.centre.lat + s.centre.lng).toBeLessThan(2);
  });
  it('midpoints sit between each corner and the next', () => {
    expect(midpoints(RING)[0]).toEqual({ lat: 0, lng: 1 });
    expect(midpoints(RING)).toHaveLength(4);
  });
});

describe('snapping a corner to the area next door', () => {
  // 1 degree = 1,000 px, so pixel distances are easy to read.
  const toPx = (p: LatLng) => ({ x: p.lng * 1000, y: -p.lat * 1000 });
  const fromPx = (q: { x: number; y: number }) => ({ lng: q.x / 1000, lat: -q.y / 1000 });
  const square: LatLng[] = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.1 }, { lat: 0.1, lng: 0.1 }, { lat: 0.1, lng: 0 }];

  it('lands on a neighbour corner first, then on its edge, else stays put', () => {
    expect(snapCorner({ lat: 0.105, lng: 0.108 }, [square], toPx, fromPx)).toEqual({ at: { lat: 0.1, lng: 0.1 }, snapped: 'corner' });
    const onEdge = snapCorner({ lat: 0.05, lng: 0.106 }, [square], toPx, fromPx);
    expect(onEdge.snapped).toBe('edge');
    expect(onEdge.at.lng).toBeCloseTo(0.1, 9);
    expect(onEdge.at.lat).toBeCloseTo(0.05, 9);
    expect(snapCorner({ lat: 0.05, lng: 0.13 }, [square], toPx, fromPx)).toEqual({ at: { lat: 0.05, lng: 0.13 }, snapped: null });
    expect(snapCorner({ lat: 0.05, lng: 0.13 }, [], toPx, fromPx).snapped).toBeNull();
  });
});
