import { describe, expect, it } from 'vitest';
import { blockReason, HOME_CELL_DEG, homeCells, marksOf } from './fingerprint.js';

const shared = (a: string[], b: string[]) => a.some((x) => b.includes(x));

describe('referral fingerprint: device + phone + home (decisions §1)', () => {
  it('two pins less than half a cell apart share a home cell wherever the grid lines fall', () => {
    const base = { lat: 32.9095, lng: 45.0635 };
    for (const [dy, dx] of [
      [0, 0],
      [0.00015, 0],
      [0, 0.00019],
      [-0.00019, 0.00019],
      [0.00012, -0.00018],
    ] as const) {
      expect(shared(homeCells(base), homeCells({ lat: base.lat + dy, lng: base.lng + dx })), `${dy},${dx}`).toBe(true);
    }
  });

  it('homes a few houses apart do not match', () => {
    const base = { lat: 32.9095, lng: 45.0635 };
    expect(shared(homeCells(base), homeCells({ lat: base.lat + HOME_CELL_DEG * 2.5, lng: base.lng }))).toBe(false);
    expect(shared(homeCells(base), homeCells({ lat: base.lat, lng: base.lng + HOME_CELL_DEG * 2.5 }))).toBe(false);
  });

  it('marks keep their kind and drop repeats', () => {
    expect(marksOf({ phoneHash: 'ph', deviceMarks: ['d1', 'd1'], homeMarks: ['h1'] })).toEqual(['p:ph', 'd:d1', 'h:h1']);
    expect(marksOf({ phoneHash: null, deviceMarks: [], homeMarks: [] })).toEqual([]);
  });

  const friend = marksOf({ phoneHash: 'pf', deviceMarks: ['df'], homeMarks: ['hf'] });

  it('a clean friend pays', () => {
    expect(blockReason({ friend, inviter: marksOf({ phoneHash: 'pi', deviceMarks: ['di'], homeMarks: ['hi'] }), earners: ['p:px', 'd:dx', 'h:hx'] })).toBeNull();
  });

  it('blocks a shared device, phone or home with the inviter', () => {
    expect(blockReason({ friend, inviter: ['d:df'], earners: [] })).toBe('shared_device');
    expect(blockReason({ friend, inviter: ['p:pf'], earners: [] })).toBe('shared_phone');
    expect(blockReason({ friend, inviter: ['h:hf'], earners: [] })).toBe('shared_home');
    // Device first when several are shared.
    expect(blockReason({ friend, inviter: ['h:hf', 'd:df'], earners: [] })).toBe('shared_device');
  });

  it('blocks a device, phone or home of someone who already earned a referral', () => {
    expect(blockReason({ friend, inviter: [], earners: ['d:df'] })).toBe('device_earned');
    expect(blockReason({ friend, inviter: [], earners: ['p:pf'] })).toBe('phone_earned');
    expect(blockReason({ friend, inviter: [], earners: ['h:hf'] })).toBe('home_earned');
  });
});
