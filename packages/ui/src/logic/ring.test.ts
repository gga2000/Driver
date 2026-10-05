import { describe, expect, it } from 'vitest';
import { RING_MAX_SEGMENTS, ringArcs } from './ring';

describe('ringArcs (Partner end-of-job ring)', () => {
  const circ = 2 * Math.PI * 80;

  it('one segment per job, evenly spaced from 12 o’clock with the gap split around each slot', () => {
    const arcs = ringArcs(4, circ, 10);
    expect(arcs).toHaveLength(4);
    expect(arcs[0]!.startDeg).toBeCloseTo((5 / circ) * 360);
    expect(arcs[1]!.startDeg - arcs[0]!.startDeg).toBeCloseTo(90);
    for (const a of arcs) expect(a.length).toBeCloseTo(circ / 4 - 10);
  });

  it('nothing, one full arc for a single job, and one full arc past the segment limit', () => {
    expect(ringArcs(0, circ)).toEqual([]);
    expect(ringArcs(1, circ)).toEqual([{ length: circ, startDeg: 0 }]);
    expect(ringArcs(RING_MAX_SEGMENTS + 1, circ)).toEqual([{ length: circ, startDeg: 0 }]);
    expect(ringArcs(RING_MAX_SEGMENTS, circ)).toHaveLength(RING_MAX_SEGMENTS);
  });
});
