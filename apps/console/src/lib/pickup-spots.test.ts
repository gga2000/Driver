import { describe, expect, it, vi } from 'vitest';
import { PHOTO_MAX_BYTES, type PhotoUploadTicket } from '@driver/contracts';
import { filterStores, missingCount, photoProblem, storeGaps, toFinish, uploadPhoto } from './pickup-spots';

const rows = [
  { name: 'مطعم خالد', note: 'الشباك اليسار', photos: 1 },
  { name: 'أسواق كريم', note: null, photos: 0 },
  { name: 'مشويات الحاج كريم', note: null, photos: 2 },
  { name: 'كبة السراي', note: null, photos: 0 },
];

describe('Console › المطاعم store list', () => {
  it('finds a store by any of its words, however the hamza or taa marbuta were typed', () => {
    expect(filterStores(rows, '').map((r) => r.name)).toHaveLength(4);
    expect(filterStores(rows, 'كريم').map((r) => r.name)).toEqual(['أسواق كريم', 'مشويات الحاج كريم']);
    expect(filterStores(rows, 'اسواق').map((r) => r.name)).toEqual(['أسواق كريم']);
    expect(filterStores(rows, 'كبه').map((r) => r.name)).toEqual(['كبة السراي']);
    expect(filterStores(rows, ' كريم  الحاج ').map((r) => r.name)).toEqual(['مشويات الحاج كريم']);
    expect(filterStores(rows, 'بيتزا')).toEqual([]);
  });

  it('counts the stores with nothing set (a photo alone is set)', () => {
    expect(missingCount(rows)).toBe(2);
  });

  it('k6: names what each store still lacks and lists the most unfinished first', () => {
    const full = { note: 'الشباك', photos: 1, shopPhoto: true, dishes: 12, dishesNoPhoto: 0 };
    expect(storeGaps(full)).toEqual([]);
    expect(storeGaps({ ...full, shopPhoto: false, dishesNoPhoto: 3 })).toEqual(['shop_photo', 'dish_photos']);
    expect(storeGaps({ note: null, photos: 0, shopPhoto: false, dishes: 0, dishesNoPhoto: 0 })).toEqual(['shop_photo', 'spot', 'menu']);
    const list = [
      { name: 'أ', ...full },
      { name: 'ب', ...full, dishesNoPhoto: 2 },
      { name: 'ج', note: null, photos: 0, shopPhoto: false, dishes: 0, dishesNoPhoto: 0 },
    ];
    expect(toFinish(list).map((r) => r.name)).toEqual(['ج', 'ب']);
  });
});

describe('pickup-spot photo upload', () => {
  it('takes JPEG, PNG and WebP up to the API limit', () => {
    expect(photoProblem({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(photoProblem({ type: 'image/webp', size: PHOTO_MAX_BYTES })).toBeNull();
    expect(photoProblem({ type: 'image/gif', size: 1000 })).toBe('type');
    expect(photoProblem({ type: 'image/png', size: PHOTO_MAX_BYTES + 1 })).toBe('size');
    expect(photoProblem({ type: 'image/png', size: 0 })).toBe('size');
  });

  it('asks for a ticket with the file’s type and size, PUTs the bytes, returns the upload id', async () => {
    const ticket: PhotoUploadTicket = { uploadId: 'up_1', uploadUrl: '/uploads/up_1?sig=x', method: 'PUT', headers: { 'content-type': 'image/png' }, expiresAt: new Date(), maxBytes: PHOTO_MAX_BYTES };
    const requestTicket = vi.fn(async () => ticket);
    const put = vi.fn(async () => new Response(null, { status: 200 }));
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    expect(await uploadPhoto(file, requestTicket, (u) => `http://api${u}`, put)).toBe('up_1');
    expect(requestTicket).toHaveBeenCalledWith({ contentType: 'image/png', sizeBytes: 3 });
    expect(put).toHaveBeenCalledWith('http://api/uploads/up_1?sig=x', { method: 'PUT', headers: ticket.headers, body: file });
    const refused = vi.fn(async () => new Response(null, { status: 413 }));
    await expect(uploadPhoto(file, requestTicket, (u) => u, refused)).rejects.toThrow('upload_413');
  });
});
