import { describe, expect, it } from 'vitest';
import { PICKUP_SPOT_RULES } from '@driver/contracts';
import { addPhoto, canAddPhoto, draftFrom, noteLeft, removePhoto, sameDraft, toInput, withNote } from './logic';

const door = { id: 'up_door', url: '/files/up_door?sig=a' };
const window = { id: 'up_window', url: '/files/up_window?sig=b' };
const counter = { id: 'up_counter', url: '/files/up_counter?sig=c' };

describe('pickup spot draft (maps program r7)', () => {
  it('starts from the saved spot, or empty when never set', () => {
    expect(draftFrom({ note: null, photos: [] })).toEqual({ note: '', photos: [] });
    expect(draftFrom({ note: 'الشباك اليسار', photos: [door] })).toEqual({ note: 'الشباك اليسار', photos: [door] });
  });

  it('is dirty only when the note text or the photos change', () => {
    const saved = draftFrom({ note: 'الشباك اليسار', photos: [door, window] });
    expect(sameDraft(saved, { ...saved, note: ' الشباك اليسار  ' })).toBe(true);
    expect(sameDraft(saved, withNote(saved, 'الباب الجانبي'))).toBe(false);
    expect(sameDraft(saved, { ...saved, photos: [window, door] })).toBe(false);
    expect(sameDraft(saved, removePhoto(saved, 'up_door'))).toBe(false);
  });

  it('holds at most two photos, never the same one twice', () => {
    let d = draftFrom({ note: null, photos: [] });
    d = addPhoto(d, door);
    expect(addPhoto(d, door)).toBe(d);
    d = addPhoto(d, window);
    expect(d.photos.map((p) => p.id)).toEqual(['up_door', 'up_window']);
    expect(PICKUP_SPOT_RULES.maxPhotos).toBe(2);
    expect(canAddPhoto(d)).toBe(false);
    expect(addPhoto(d, counter)).toBe(d);
    expect(canAddPhoto(removePhoto(d, 'up_door'))).toBe(true);
  });

  it('stops the note at 140 characters and counts what is left', () => {
    const d = withNote(draftFrom({ note: null, photos: [] }), 'ش'.repeat(200));
    expect(d.note).toHaveLength(PICKUP_SPOT_RULES.noteMaxChars);
    expect(noteLeft(d)).toBe(0);
    expect(noteLeft(withNote(d, '  الشباك  '))).toBe(PICKUP_SPOT_RULES.noteMaxChars - 'الشباك'.length);
  });

  it('saves a blank note as none and photo ids in order', () => {
    expect(toInput('org_1', { note: '   ', photos: [window, door] })).toEqual({ merchantOrgId: 'org_1', note: null, photoIds: ['up_window', 'up_door'] });
    expect(toInput('org_1', { note: ' الاستلام من الشباك اليسار ', photos: [] })).toEqual({ merchantOrgId: 'org_1', note: 'الاستلام من الشباك اليسار', photoIds: [] });
  });
});
