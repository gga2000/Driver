import { describe, expect, it } from 'vitest';
import { DISH_PHOTO_TAKEDOWN_REASONS } from '@driver/contracts';
import { isLate, KEEP_TOAST, TAKEDOWN_REASON_KEY, TAKEDOWN_TOAST } from './dish-photos';

const now = new Date('2026-10-09T15:00:00Z');
const at = (hoursAgo: number) => ({ pendingSince: new Date(now.getTime() - hoursAgo * 3_600_000) });

describe('dish photos (p4 same-day look)', () => {
  it('a photo is late from 8 hours up', () => {
    expect(isLate(at(7.9), now)).toBe(false);
    expect(isLate(at(8), now)).toBe(true);
  });

  it('only a real keep reads as done; a newer photo or someone else’s look is a plain line', () => {
    expect(KEEP_TOAST.kept.tone).toBe('ok');
    expect(KEEP_TOAST.changed).toEqual({ key: 'console.dp_changed', tone: 'default' });
    expect(KEEP_TOAST.gone.key).toBe('console.dp_gone');
  });

  it('«انزّلها» names every reason the server takes, and only a real take-down reads as done', () => {
    expect(Object.keys(TAKEDOWN_REASON_KEY)).toEqual([...DISH_PHOTO_TAKEDOWN_REASONS]);
    expect(TAKEDOWN_TOAST.taken_down.tone).toBe('ok');
    expect(TAKEDOWN_TOAST.changed.tone).toBe('default');
  });
});
