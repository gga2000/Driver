import { describe, expect, it, vi } from 'vitest';
import type { PlacesPort } from './account-io.js';
import { AZIZIYAH_LANDMARKS } from './aziziyah-landmarks.js';
import { LANDMARK_CATEGORIES, LANDMARK_FEED_RULES, LandmarkFeed, landmarkCategoryOf } from './landmarks.js';
import { appRouter } from './router.js';
import { t, type AppContext } from './trpc.js';

describe('landmarkCategoryOf (maps program b3)', () => {
  it('gives every seeded garage and meeting point its icon', () => {
    const byKey = Object.fromEntries(AZIZIYAH_LANDMARKS.map((l) => [l.key, landmarkCategoryOf(l.name_ar, l.kind)]));
    expect(byKey).toEqual({
      garage_bab1: 'garage',
      garage_bab2: 'garage',
      garage_souq: 'garage',
      mp_jami_kabir: 'mosque',
      mp_hadiqat_shasha: 'other',
      mp_kuliyat_tarbiya: 'school',
      mp_shari_30: 'other',
      mp_hawas_bridge: 'bridge',
      mp_khamas_bridge: 'bridge',
    });
  });

  it.each([
    ['الجامع الكبير', 'mosque'],
    ['جامع الرسول', 'mosque'],
    ['حسينية الزهراء', 'mosque'],
    ['جامعة واسط', 'school'],
    ['مدرسة الفارابي الابتدائية', 'school'],
    ['إعدادية العزيزية للبنين', 'school'],
    ['سوق العزيزية الكبير', 'market'],
    ['سوك الخضرة', 'market'],
    ['مستشفى العزيزية العام', 'clinic'],
    ['المركز الصحي', 'clinic'],
    ['صيدلية الشفاء', 'clinic'],
    ['محطة وقود العزيزية', 'fuel'],
    ['بانزينخانة زاكور', 'fuel'],
    ['كراج السوق', 'garage'],
    ['گراج بغداد القديم', 'garage'],
    ['رأس جسر حواس', 'bridge'],
    ['دوّار شارع 30', 'other'],
    ['محطة الباص', 'other'],
    ['', 'other'],
  ] as const)('%s → %s', (name, category) => {
    expect(landmarkCategoryOf(name)).toBe(category);
  });

  it('a garage kind wins over the words of its name', () => {
    expect(landmarkCategoryOf('كراج السوق', 'garage')).toBe('garage');
    expect(landmarkCategoryOf('السوق', 'garage')).toBe('garage');
    expect(landmarkCategoryOf('السوق', 'meeting_point')).toBe('market');
  });

  it('only ever answers a known category', () => {
    for (const l of AZIZIYAH_LANDMARKS) expect(LANDMARK_CATEGORIES).toContain(landmarkCategoryOf(l.name_ar, l.kind));
  });
});

describe('places.landmarkFeed', () => {
  const ITEM = { id: 'lm_garage_bab1', name_ar: 'كراج البوابة 1', category: 'garage' as const, pin: { lat: 32.9032, lng: 45.0578 }, photoUrl: null };

  function caller(port: Partial<PlacesPort>, signedIn = false) {
    const ctx = {
      auth: signedIn ? { sub: 'p_1', sid: 's1', iss: 'driver-api', iat: 0, exp: 0 } : null,
      authError: null,
      places: port,
    } as unknown as AppContext;
    return t.createCallerFactory(appRouter)(ctx);
  }

  it('is readable without a session (the share page) and defaults the city', async () => {
    const landmarkFeed = vi.fn(async () => ({ changed: true as const, etag: 'e1', maxAgeS: LANDMARK_FEED_RULES.maxAgeS, landmarks: [ITEM] }));
    const res = await caller({ landmarkFeed }).places.landmarkFeed({});
    expect(res).toEqual({ changed: true, etag: 'e1', maxAgeS: LANDMARK_FEED_RULES.maxAgeS, landmarks: [ITEM] });
    expect(landmarkFeed).toHaveBeenCalledWith({ cityId: 'aziziyah' });
  });

  it('passes the phone etag through', async () => {
    const landmarkFeed = vi.fn(async () => ({ changed: false as const, etag: 'e1', maxAgeS: 60 }));
    expect(await caller({ landmarkFeed }, true).places.landmarkFeed({ cityId: 'aziziyah', etag: 'e1' })).toEqual({ changed: false, etag: 'e1', maxAgeS: 60 });
    expect(landmarkFeed).toHaveBeenCalledWith({ cityId: 'aziziyah', etag: 'e1' });
  });

  it('answers an empty, stable feed without the port', async () => {
    const first = await caller({}).places.landmarkFeed({});
    expect(first).toMatchObject({ changed: true, landmarks: [] });
    expect(await caller({}).places.landmarkFeed({ etag: first.etag })).toMatchObject({ changed: false, etag: first.etag });
  });

  it('never lets an item carry more than the map needs', () => {
    const parsed = LandmarkFeed.parse({ changed: true, etag: 'e', maxAgeS: 1, landmarks: [{ ...ITEM, ownerId: 'p_9', note: 'بيت' }] });
    expect(parsed.changed && parsed.landmarks[0]).toEqual(ITEM);
  });
});
