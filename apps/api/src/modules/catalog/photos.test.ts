import { describe, expect, it } from 'vitest';
import { itemPhotoUrl, photoLink, UPLOAD_PHOTO_PREFIX } from './photos.js';

const SIGNER = { readUrl: (id: string) => `/files/${id}?exp=1&sig=s` };

describe('catalog photos', () => {
  it('signs a merchant upload, passes a plain URL, and has nothing for no photo', () => {
    expect(itemPhotoUrl(SIGNER, `${UPLOAD_PHOTO_PREFIX}up_1`)).toBe('/files/up_1?exp=1&sig=s');
    expect(itemPhotoUrl(SIGNER, 'https://cdn.example/kebab.jpg')).toBe('https://cdn.example/kebab.jpg');
    expect(itemPhotoUrl(SIGNER, null)).toBeNull();
    expect(itemPhotoUrl(SIGNER, '')).toBeNull();
  });

  it('never hands an app `upload:<id>`: without a signer the upload is left out', () => {
    expect(itemPhotoUrl(null, `${UPLOAD_PHOTO_PREFIX}up_1`)).toBeNull();
    expect(photoLink(undefined)(`${UPLOAD_PHOTO_PREFIX}up_1`)).toBeNull();
    expect(photoLink(null)('https://cdn.example/kebab.jpg')).toBe('https://cdn.example/kebab.jpg');
    expect(photoLink(SIGNER)(`${UPLOAD_PHOTO_PREFIX}up_2`)).toBe('/files/up_2?exp=1&sig=s');
  });
});
