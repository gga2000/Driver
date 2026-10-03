import { Inject, Injectable } from '@nestjs/common';
import type {
  Actor,
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
import { SavedPlacesService } from './saved-places.service.js';
import { BLOB_STORE, type BlobStore } from './uploads.js';

/** `ctx.places`: every call acts on the caller's own places (ownership in `SavedPlacesService`). */
@Injectable()
export class PlacesRpc implements PlacesPort {
  constructor(
    private readonly saved: SavedPlacesService,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
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

  photoUpload(actor: Actor, input: PhotoUploadInput): Promise<PhotoUploadTicket> {
    return this.blobs.createUpload({ ownerId: actor.personId, contentType: input.contentType, sizeBytes: input.sizeBytes });
  }
}
