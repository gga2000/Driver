import { describe, expect, it } from 'vitest';
import { around, overlaps, placeLabels, stackTags } from './map-labels';

const VIEW = { w: 800, h: 600 };

describe('label placement (K-09)', () => {
  it('puts a lone label above its anchor', () => {
    const p = placeLabels([{ id: 'a', x: 400, y: 300, w: 80, h: 18, priority: 1 }], [], VIEW);
    expect(p.get('a')).toEqual({ dx: -40, dy: -24 });
  });

  it('moves a colliding label to the next free side, higher priority keeps the best spot', () => {
    const p = placeLabels(
      [
        { id: 'zone', x: 400, y: 300, w: 80, h: 18, priority: 1 },
        { id: 'garage', x: 405, y: 302, w: 80, h: 18, priority: 3 },
      ],
      [],
      VIEW,
    );
    expect(p.get('garage')).toEqual({ dx: -40, dy: -24 });
    expect(p.get('zone')).toEqual({ dx: -40, dy: 6 });
  });

  it('hides a label that has no free side, and never leaves the screen', () => {
    const labels = [0, 1, 2, 3, 4].map((i) => ({ id: `g${i}`, x: 400 + i, y: 300 + i, w: 120, h: 18, priority: 5 - i }));
    const p = placeLabels(labels, [], VIEW);
    expect(p.get('g0')).toEqual({ dx: -60, dy: -24 });
    expect([...p.values()].filter(Boolean).length).toBeLessThan(5);
    expect(p.get('g4')).toBeNull();
    // Near the top-left corner: above and below would leave the screen, so it sits to the right.
    const edge = placeLabels([{ id: 'e', x: 10, y: 20, w: 80, h: 18, priority: 1 }], [], VIEW);
    expect(edge.get('e')).toEqual({ dx: 6, dy: -9 });
  });

  it('keeps labels off driver markers', () => {
    const p = placeLabels([{ id: 'z', x: 400, y: 300, w: 60, h: 16, priority: 1 }], [around(400, 285, 22)], VIEW);
    expect(p.get('z')).toEqual({ dx: -30, dy: 6 });
  });

  it('folds overlapping order tags into the most urgent one and splits them when they part', () => {
    const tag = (id: string, x: number, count: number, rank: number) => ({ id, box: { x, y: 100, w: 60, h: 22 }, count, rank });
    const close = stackTags([tag('calm', 105, 1, 2), tag('late', 100, 2, 0), tag('far', 400, 1, 1)]);
    expect(close.get('late')).toEqual({ shown: true, total: 3 });
    expect(close.get('calm')).toEqual({ shown: false, total: 1 });
    expect(close.get('far')).toEqual({ shown: true, total: 1 });
    const apart = stackTags([tag('calm', 300, 1, 2), tag('late', 100, 2, 0)]);
    expect([...apart.values()].every((v) => v.shown)).toBe(true);
  });

  it('overlap is strict about touching boxes only with padding', () => {
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 13, y: 0, w: 10, h: 10 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 0, w: 10, h: 10 })).toBe(true);
  });
});
