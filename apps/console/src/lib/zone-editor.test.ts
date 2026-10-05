import { describe, expect, it } from 'vitest';
import type { LatLng } from '@driver/contracts';
import { closedEditor, editorReducer, isDirty, midpoints } from './zone-editor';

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
