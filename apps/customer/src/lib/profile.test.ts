import { describe, expect, it } from 'vitest';
import type { SavedPlaceView } from '@driver/contracts';
import { createProfileStore, deliveryPointOf, fromServerPlace, toServerDraft, type SavedPlace } from './profile';
import { createMemoryStorage } from './storage';

const view = (over: Partial<SavedPlaceView> = {}): SavedPlaceView => ({
  id: 'sp_1',
  cityId: 'aziziyah',
  label: 'home',
  name: 'البيت',
  zoneId: 'street_30',
  zoneName_ar: 'شارع 30',
  zoneName_en: 'Street 30',
  pin: { lat: 32.9096, lng: 45.0636 },
  note: 'باب أخضر',
  photos: [{ id: 'up_1', url: '/files/up_1?exp=1&sig=x' }],
  confidence: 0.85,
  confirmed: true,
  confirmedAt: new Date('2026-10-03T09:00:00Z'),
  sharedWithHousehold: false,
  access: 'owner',
  createdAt: new Date('2026-10-03T09:00:00Z'),
  updatedAt: new Date('2026-10-03T09:00:00Z'),
  ...over,
});

describe('saved places: server ↔ device', () => {
  it('maps a server place (custom reads as other with its name; exact pin; first photo)', () => {
    expect(fromServerPlace(view())).toEqual({
      id: 'sp_1',
      label: 'home',
      title: 'البيت',
      zoneId: 'street_30',
      note: 'باب أخضر',
      pin: { lat: 32.9096, lng: 45.0636 },
      synced: true,
      confirmed: true,
      photoUrl: '/files/up_1?exp=1&sig=x',
      sharedWithHousehold: false,
      access: 'owner',
    });
    expect(fromServerPlace(view({ label: 'custom', name: 'بيت خالتي', photos: [], note: null }))).toMatchObject({ label: 'other', title: 'بيت خالتي' });
    expect(deliveryPointOf(fromServerPlace(view()))).toEqual({ zoneKey: 'street_30', pin: { lat: 32.9096, lng: 45.0636 } });
  });

  it('a device-only place becomes an idempotent save at its zone centroid', () => {
    const local: SavedPlace = { id: 'place_abc', label: 'family', zoneId: 'zakur', note: 'يم الجامع' };
    expect(toServerDraft(local, (l) => (l === 'family' ? 'بيت أهلي' : l))).toEqual({
      cityId: 'aziziyah',
      label: 'custom',
      name: 'بيت أهلي',
      pin: { lat: 32.887, lng: 45.0765 },
      note: 'يم الجامع',
      clientRef: 'device:place_abc',
    });
    expect(toServerDraft({ id: 'p2', label: 'home', zoneId: 'centre' }, () => 'x').label).toBe('home');
  });

  it('syncPlaces keeps unmigrated device places, drops migrated ones and moves the selection to the server id', async () => {
    const store = createProfileStore(createMemoryStorage());
    await store.load();
    const a = await store.addPlace({ label: 'home', zoneId: 'centre' });
    await store.addPlace({ label: 'other', zoneId: 'zakur' });
    expect(store.getSnapshot().selectedPlaceId).toBe(a.id);
    const server = fromServerPlace(view({ id: 'sp_9' }));
    await store.syncPlaces([server], { [a.id]: 'sp_9' });
    const s = store.getSnapshot();
    expect(s.places.map((p) => [p.id.startsWith('place_') ? 'local' : p.id, p.synced ?? false])).toEqual([
      ['sp_9', true],
      ['local', false],
    ]);
    expect(s.selectedPlaceId).toBe('sp_9');
    // A later sync without the local one (migrated too) leaves only server places.
    const other = s.places[1]!;
    await store.syncPlaces([server], { [other.id]: 'sp_10' });
    expect(store.getSnapshot().places.map((p) => p.id)).toEqual(['sp_9']);
  });

  it('remembers the share-trips safety preference across loads', async () => {
    const mem = createMemoryStorage();
    const s1 = createProfileStore(mem);
    await s1.load();
    expect(s1.getSnapshot().shareTripsByDefault).toBe(false);
    await s1.setShareTripsByDefault(true);
    const s2 = createProfileStore(mem);
    await s2.load();
    expect(s2.getSnapshot().shareTripsByDefault).toBe(true);
  });
});
