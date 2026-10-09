import { describe, expect, it } from 'vitest';
import { keepPhotoDown, photoDownKey, photoDownReason, unseenPhotoDowns } from './photo-down';

const at = (m: number) => new Date(Date.UTC(2026, 9, 9, 12, m));
const item = (id: string, over: { photoUrl?: string | null; photoTakenDown?: { reason: string; at: Date } | null } = {}) => ({ id, nameAr: `أكلة ${id}`, photoUrl: null, ...over });

describe('p4 · a photo the team took down', () => {
  it('reads an unknown reason as «other»', () => {
    expect(photoDownReason('people')).toBe('people');
    expect(photoDownReason('too_dark')).toBe('other');
  });

  it('the board tells about each take-down once, newest first, only while the dish has no photo', () => {
    const menu = [
      { items: [item('a', { photoTakenDown: { reason: 'blurry', at: at(1) } }), item('b', { photoTakenDown: { reason: 'people', at: at(5) } })] },
      { items: [item('c'), item('d', { photoUrl: '/files/x', photoTakenDown: null }), item('e', { photoUrl: '/files/y', photoTakenDown: { reason: 'blurry', at: at(9) } })] },
    ];
    expect(unseenPhotoDowns(menu, []).map((n) => [n.itemId, n.reason])).toEqual([
      ['b', 'people'],
      ['a', 'blurry'],
    ]);
    expect(unseenPhotoDowns(menu, [photoDownKey('b', at(5))]).map((n) => n.itemId)).toEqual(['a']);
    // A second take-down of the same dish is new news.
    expect(unseenPhotoDowns([{ items: [item('b', { photoTakenDown: { reason: 'other', at: at(7) } })] }], [photoDownKey('b', at(5))]).map((n) => n.reason)).toEqual(['other']);
    expect(unseenPhotoDowns(undefined, [])).toEqual([]);
  });

  it('a write that sends the dish back keeps the notice until a photo goes up', () => {
    const down = item('a', { photoTakenDown: { reason: 'blurry', at: at(1) } });
    expect(keepPhotoDown(down, item('a')).photoTakenDown).toEqual({ reason: 'blurry', at: at(1) });
    expect(keepPhotoDown(down, item('a', { photoUrl: '/files/new' })).photoTakenDown).toBeUndefined();
    expect(keepPhotoDown(down, item('a', { photoTakenDown: null })).photoTakenDown).toBeNull();
    expect(keepPhotoDown(undefined, item('a')).photoTakenDown).toBeUndefined();
  });
});
