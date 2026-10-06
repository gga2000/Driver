import { describe, expect, it } from 'vitest';
import { PICKUP_SPOT_RULES } from './merchant-io.js';
import { pickupDraft as d } from './pickup-draft.js';

const door = { id: 'up_door', url: '/files/up_door?sig=a' };
const window = { id: 'up_window', url: '/files/up_window?sig=b' };
const counter = { id: 'up_counter', url: '/files/up_counter?sig=c' };

describe('pickup spot draft (maps program r7; Merchant app and Console)', () => {
  it('starts from the saved spot, or empty when never set', () => {
    expect(d.from({ note: null, photos: [] })).toEqual({ note: '', photos: [] });
    expect(d.from({ note: 'الشباك اليسار', photos: [door] })).toEqual({ note: 'الشباك اليسار', photos: [door] });
  });

  it('is dirty only when the note text or the photos change', () => {
    const saved = d.from({ note: 'الشباك اليسار', photos: [door, window] });
    expect(d.same(saved, { ...saved, note: ' الشباك اليسار  ' })).toBe(true);
    expect(d.same(saved, d.withNote(saved, 'الباب الجانبي'))).toBe(false);
    expect(d.same(saved, { ...saved, photos: [window, door] })).toBe(false);
    expect(d.same(saved, d.removePhoto(saved, 'up_door'))).toBe(false);
  });

  it('holds at most two photos, never the same one twice', () => {
    let draft = d.from({ note: null, photos: [] });
    draft = d.addPhoto(draft, door);
    expect(d.addPhoto(draft, door)).toBe(draft);
    draft = d.addPhoto(draft, window);
    expect(draft.photos.map((p) => p.id)).toEqual(['up_door', 'up_window']);
    expect(PICKUP_SPOT_RULES.maxPhotos).toBe(2);
    expect(d.canAddPhoto(draft)).toBe(false);
    expect(d.addPhoto(draft, counter)).toBe(draft);
    expect(d.canAddPhoto(d.removePhoto(draft, 'up_door'))).toBe(true);
  });

  it('stops the note at 140 characters and counts what is left', () => {
    const draft = d.withNote(d.from({ note: null, photos: [] }), 'ش'.repeat(200));
    expect(draft.note).toHaveLength(PICKUP_SPOT_RULES.noteMaxChars);
    expect(d.noteLeft(draft)).toBe(0);
    expect(d.noteLeft(d.withNote(draft, '  الشباك  '))).toBe(PICKUP_SPOT_RULES.noteMaxChars - 'الشباك'.length);
  });

  it('saves a blank note as none and photo ids in order', () => {
    expect(d.toInput('org_1', { note: '   ', photos: [window, door] })).toEqual({ merchantOrgId: 'org_1', note: null, photoIds: ['up_window', 'up_door'] });
    expect(d.toInput('org_1', { note: ' الاستلام من الشباك اليسار ', photos: [] })).toEqual({ merchantOrgId: 'org_1', note: 'الاستلام من الشباك اليسار', photoIds: [] });
  });
});
