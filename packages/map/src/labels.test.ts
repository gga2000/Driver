import { describe, expect, it } from 'vitest';
import { LABEL_MARKER_CLEARANCE_PX, labelBox, labelMarkerGap, labelsClearOf, obstaclesOnScreen, pinLabelPlacement, pinLabelRect, pinLabelSide, pinLabelWidth, rectsOverlap, type PinLabelLayout, type PlacedLabel } from './labels.js';

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

describe('a pin name flips under its pin when the courier covers it (QA 2026-10-07)', () => {
  // The partner pin: a 30 px pill, 17 px over the tip; flipped, 12 px under it.
  const layout: PinLabelLayout = { width: 110, height: 30, gapAbove: 17, gapBelow: 12 };
  const tip = { x: 318, y: 176 };
  /** The courier's 40 px disc centred at (x, y). */
  const disc = (x: number, y: number) => ({ left: x - 20, right: x + 20, top: y - 20, bottom: y + 20 });

  it('the pill sits over the tip, or under it when flipped, centred on it', () => {
    expect(pinLabelRect(tip, 'above', layout)).toEqual({ left: 263, right: 373, top: 129, bottom: 159 });
    expect(pinLabelRect(tip, 'below', layout)).toEqual({ left: 263, right: 373, top: 188, bottom: 218 });
  });

  it('stays above with no courier, or with the courier well away', () => {
    expect(pinLabelSide(tip, [], layout)).toBe('above');
    expect(pinLabelSide(tip, [disc(100, 400)], layout)).toBe('above');
  });

  it('flips below when the disc sits on the start of «مطعم خالد» (the p5a pickup leg)', () => {
    expect(pinLabelSide(tip, [disc(270, 140)], layout)).toBe('below');
  });

  it('stays above when the courier would cover it below too', () => {
    expect(pinLabelSide(tip, [disc(270, 140), disc(318, 200)], layout)).toBe('above');
  });

  it('keeps a small margin: a disc 2 px off the pill still counts, 10 px off does not', () => {
    const pill = pinLabelRect(tip, 'above', layout);
    expect(rectsOverlap(pill, { left: pill.right + 2, right: pill.right + 42, top: 130, bottom: 170 }, 4)).toBe(true);
    expect(rectsOverlap(pill, { left: pill.right + 10, right: pill.right + 50, top: 130, bottom: 170 }, 4)).toBe(false);
  });

  it('a pill grows with its name and stops at the cap', () => {
    expect(pinLabelWidth('مطعم خالد', 12, 39, 150)).toBeGreaterThan(pinLabelWidth('الزبون', 12, 39, 150));
    expect(pinLabelWidth('مطعم بيت الكبة والدولمة العراقية الأصيلة', 12, 39, 150)).toBe(150);
  });
});

describe('a pin name hangs under the courier when he stands on the pin (share page «الوجهة», QA 2026-10-07)', () => {
  // The customer pin: a 30 px pill 17 px over the tip; flipped, 7 px under it.
  const layout: PinLabelLayout = { width: 100, height: 30, gapAbove: 17, gapBelow: 7 };
  const tip = { x: 195, y: 300 };
  /** The courier marker on the share page: his 44 px vehicle and the 24 px minutes pill over it, centred at (x, y). */
  const courier = (x: number, y: number) => ({ left: x - 22, right: x + 22, top: y - 22 - 24, bottom: y + 22 });

  it('at the door his minutes pill sits where the name is: the name flips under him, clear of the whole marker', () => {
    const marker = courier(tip.x, tip.y);
    expect(rectsOverlap(pinLabelRect(tip, 'above', layout), marker, 4)).toBe(true);
    const placed = pinLabelPlacement(tip, [marker], layout);
    expect(placed.side).toBe('below');
    const below = pinLabelRect(tip, 'below', layout);
    const hung = { ...below, top: below.top + placed.drop, bottom: below.bottom + placed.drop };
    expect(rectsOverlap(hung, marker, 4)).toBe(false);
    expect(placed.drop).toBe(22 + 4 - 7);
  });

  it('stays above with the courier away, and flips without a longer stem when under the pin is clear', () => {
    expect(pinLabelPlacement(tip, [], layout)).toEqual({ side: 'above', drop: 0 });
    expect(pinLabelPlacement(tip, [courier(tip.x, tip.y + 300)], layout)).toEqual({ side: 'above', drop: 0 });
    // He is just over the name (coming from the north): it flips, nothing under the pin.
    expect(pinLabelPlacement(tip, [courier(tip.x + 20, tip.y - 40)], layout)).toEqual({ side: 'below', drop: 0 });
  });

  it('clears a second mover lower down too', () => {
    const placed = pinLabelPlacement(tip, [courier(tip.x, tip.y), courier(tip.x, tip.y + 60)], layout);
    const below = pinLabelRect(tip, 'below', layout);
    const hung = { ...below, top: below.top + placed.drop, bottom: below.bottom + placed.drop };
    expect(placed.side).toBe('below');
    expect(rectsOverlap(hung, courier(tip.x, tip.y), 4) || rectsOverlap(hung, courier(tip.x, tip.y + 60), 4)).toBe(false);
  });
});
