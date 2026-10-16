import { describe, expect, it } from 'vitest';
import { closedColours, closedData, closedLine, labelBeside, type CourierClosure } from './closed';

const street = (over: Partial<CourierClosure> = {}): CourierClosure => ({
  id: 'c1',
  path: [
    { lat: 32.9, lng: 45.06 },
    { lat: 32.901, lng: 45.061 },
  ],
  reason: 'works',
  nameAr: null,
  extraMin: 0,
  ...over,
});

describe('closedLine (N20)', () => {
  it('says nothing when the road bends round nothing', () => {
    expect(closedLine(undefined)).toBeNull();
    expect(closedLine([])).toBeNull();
  });
  it('a nameless closure under a minute: the plain line', () => {
    expect(closedLine([street()])).toEqual({ key: 'partner.closed_line' });
  });
  it('adds the minutes from the largest way around, when it is a whole minute or more', () => {
    expect(closedLine([street({ extraMin: 1 }), street({ id: 'c2', extraMin: 3 })])).toEqual({ key: 'partner.closed_line_min', params: { n: 3 } });
  });
  it('names the street when exactly one closure has a name', () => {
    expect(closedLine([street({ nameAr: ' شارع المستشفى ' })])).toEqual({ key: 'partner.closed_line_named', params: { name: 'شارع المستشفى' } });
    expect(closedLine([street({ nameAr: 'شارع المستشفى', extraMin: 2 }), street({ id: 'c2' })])).toEqual({ key: 'partner.closed_line_named_min', params: { name: 'شارع المستشفى', n: 2 } });
  });
  it('two named closures: no single name to give', () => {
    expect(closedLine([street({ nameAr: 'أ' }), street({ id: 'c2', nameAr: 'ب', extraMin: 4 })])).toEqual({ key: 'partner.closed_line_min', params: { n: 4 } });
  });
});

describe('closedData / closedColours', () => {
  it('labels every closed stretch with the short map word', () => {
    const labels = closedData([street()], 'مسدود').features.filter((f) => f.properties.part === 'label');
    expect(labels).toHaveLength(1);
    expect(labels[0]!.properties.label).toBe('مسدود');
  });
  it('draws in the piece’s rust, never alarm red, by day and by night', () => {
    const day = closedColours(false);
    const night = closedColours(true);
    expect(day.rust).toMatch(/^#[0-9A-F]{6}$/i);
    expect(night.rust).not.toBe(day.rust);
    expect(day.rust.toUpperCase()).not.toBe('#FF0000');
  });
});

describe('labelBeside', () => {
  // A street running left to right across the screen.
  const a = { x: 0, y: 100 };
  const b = { x: 100, y: 100 };
  const mid = { x: 50, y: 100 };
  it('sits above the street when no road is near', () => {
    expect(labelBeside(mid, a, b, []).y).toBeLessThan(100);
  });
  it('moves to the side away from the road that was bent round it', () => {
    expect(labelBeside(mid, a, b, [{ x: 0, y: 40 }, { x: 100, y: 40 }]).y).toBeGreaterThan(100);
    expect(labelBeside(mid, a, b, [{ x: 0, y: 160 }, { x: 100, y: 160 }]).y).toBeLessThan(100);
  });
});
