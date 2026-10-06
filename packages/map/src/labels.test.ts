import { describe, expect, it } from 'vitest';
import { LABEL_MARKER_CLEARANCE_PX, labelBox, labelMarkerGap, labelsClearOf, obstaclesOnScreen, type PlacedLabel } from './labels.js';

const street30: PlacedLabel = { x: 195, y: 200, name: 'شارع 30' };

describe('zone labels keep clear of markers (QA 2026-10-07)', () => {
  it('a label box is centred on its anchor and sits on its baseline', () => {
    const b = labelBox(street30);
    expect((b.left + b.right) / 2).toBeCloseTo(195, 6);
    expect(b.right - b.left).toBeGreaterThan(30);
    expect(b.top).toBeLessThan(200);
    expect(b.bottom).toBeGreaterThan(200);
  });

  it('hides a name drawn right under a marker (the restaurant on the share page)', () => {
    expect(labelsClearOf([street30], [{ x: 197, y: 196 }])).toEqual([]);
  });

  it('hides a name under the stem of the place editor centre pin, whose head rises above the tip', () => {
    // Tip 30 px under the label, head 60 px above the tip: the stem runs through the label.
    expect(labelsClearOf([street30], [{ x: 195, y: 230, up: 60 }])).toEqual([]);
    // Same pin with the label well to the side: kept.
    expect(labelsClearOf([street30], [{ x: 320, y: 230, up: 60 }])).toEqual([street30]);
  });

  it('the line is ~40 px from the label box: 39 px hides it, 41 px keeps it', () => {
    const right = labelBox(street30).right;
    expect(LABEL_MARKER_CLEARANCE_PX).toBe(40);
    expect(labelMarkerGap(street30, { x: right + 39, y: 196 })).toBeCloseTo(39, 6);
    expect(labelsClearOf([street30], [{ x: right + 39, y: 196 }])).toEqual([]);
    expect(labelsClearOf([street30], [{ x: right + 41, y: 196 }])).toEqual([street30]);
  });

  it('keeps every name and their order when there are no markers, and drops only the crowded one', () => {
    const far: PlacedLabel = { x: 40, y: 40, name: 'الفداء' };
    const near: PlacedLabel = { x: 300, y: 500, name: 'داخل محدود' };
    expect(labelsClearOf([far, street30, near], [])).toEqual([far, street30, near]);
    expect(labelsClearOf([far, street30, near], [{ x: 195, y: 205 }])).toEqual([far, near]);
  });

  it('puts the centre pin in the middle of the map and places through the projection', () => {
    const markers = obstaclesOnScreen([{ centre: true, up: 60 }, { at: { lat: 32.9, lng: 45.07 } }], { w: 400, h: 280 }, () => ({ x: 12, y: 34 }));
    expect(markers).toEqual([
      { x: 200, y: 140, up: 60 },
      { x: 12, y: 34, up: 0 },
    ]);
  });
});
