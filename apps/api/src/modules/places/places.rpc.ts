import { Inject, Injectable } from '@nestjs/common';
import { AZIZIYAH_LANDMARKS } from '@driver/contracts';
import type {
  Actor,
  LandmarkView,
  RiderLandmarksInput,
  ConfirmPlaceInput,
  PhotoUploadInput,
  PhotoUploadTicket,
  PlaceIdInput,
  PlacesPort,
  SavedPlaceView,
  SavePlaceInput,
  UpdatePlaceInput,
  ZoneForPinInput,
  ZoneForPinOutput,
} from '@driver/contracts';
import type { z } from 'zod';
import { PlacesService } from './places.service.js';
import { SavedPlacesService } from './saved-places.service.js';
import { BLOB_STORE, type BlobStore } from './uploads.js';

/** `ctx.places`: every call acts on the caller's own places (ownership in `SavedPlacesService`). */
@Injectable()
export class PlacesRpc implements PlacesPort {
  constructor(
    private readonly saved: SavedPlacesService,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    private readonly learned: PlacesService,
  ) {}

  mine(actor: Actor): Promise<SavedPlaceView[]> {
    return this.saved.mine(actor.personId);
  }

  save(actor: Actor, input: z.infer<typeof SavePlaceInput>): Promise<SavedPlaceView> {
    return this.saved.save(actor.personId, input);
  }

  update(actor: Actor, input: z.infer<typeof UpdatePlaceInput>): Promise<SavedPlaceView> {
    return this.saved.update(actor.personId, input);
  }

  remove(actor: Actor, input: PlaceIdInput): Promise<{ ok: true }> {
    return this.saved.remove(actor.personId, input.placeId);
  }

  confirm(actor: Actor, input: ConfirmPlaceInput): Promise<SavedPlaceView> {
    return this.saved.confirm(actor.personId, input);
  }

  async zoneFor(input: z.infer<typeof ZoneForPinInput>): Promise<ZoneForPinOutput> {
    return this.saved.zoneFor(input.cityId, input.pin);
  }

  /**
   * "وين رايح؟": the seeded garages and meeting points (Aziziyah) plus landmark places learned or
   * verified since, each with the zone its pin resolves to (server side, like saved places).
   */
  async landmarks(input: z.infer<typeof RiderLandmarksInput>): Promise<LandmarkView[]> {
    const seeded: LandmarkView[] =
      input.cityId === 'aziziyah'
        ? AZIZIYAH_LANDMARKS.map((l) => ({
            id: `lm_${l.key}`,
            name_ar: l.name_ar,
            name_en: l.name_en,
            pin: { lat: l.lat, lng: l.lng },
            zoneId: this.saved.zoneFor(input.cityId, { lat: l.lat, lng: l.lng }).zoneId ?? l.zoneId,
            kind: l.kind,
            aliases_ar: [...(l.aliases_ar ?? [])],
            photoUrl: null,
          }))
        : [];
    const learned: LandmarkView[] = [];
    for (const p of await this.learned.landmarks(input.cityId)) {
      const zone = this.saved.zoneFor(input.cityId, p.pin);
      if (!zone.zoneId || seeded.some((s) => s.name_ar === p.name)) continue;
      learned.push({ id: p.id, name_ar: p.name, name_en: p.name, pin: p.pin, zoneId: zone.zoneId, kind: 'landmark', aliases_ar: [], photoUrl: p.photos[0]?.url ?? null });
    }
    return [...seeded, ...learned];
  }

  photoUpload(actor: Actor, input: PhotoUploadInput): Promise<PhotoUploadTicket> {
    return this.blobs.createUpload({ ownerId: actor.personId, contentType: input.contentType, sizeBytes: input.sizeBytes });
  }
}
