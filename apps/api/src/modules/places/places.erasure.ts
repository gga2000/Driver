import type { PlacesRepository } from './places.repository.js';
import type { SavedPlacesRepository } from './saved-places.service.js';
import type { BlobStore } from './uploads.js';

/** Uploads of a deleted person another module still shows to everyone (an approved landmark photo). */
export type UploadKeeper = (personId: string) => Promise<string[]>;

/**
 * W7 account deletion, the places module's part (docs/api/account-deletion.md): every place he saved
 * (pin, note, door photos, entrance, arrival samples), every landmark proposal still his (an approved
 * landmark stays for everyone, unowned), then every photo and voice note he uploaded, bytes first,
 * except the ones a keeper names. Idempotent: a retry finds less to do.
 */
export class PlacesErasure {
  private readonly keepers: UploadKeeper[] = [];

  constructor(
    private readonly places: PlacesRepository,
    private readonly saved: SavedPlacesRepository,
    private readonly blobs: BlobStore,
  ) {}

  /** Another module's uploads to keep (ops: approved landmark photos). Bound at start-up. */
  bindKeeper(keeper: UploadKeeper): void {
    this.keepers.push(keeper);
  }

  async erase(personId: string): Promise<void> {
    await this.saved.deleteOwner(personId);
    await this.places.releaseOwner(personId);
    const keep = new Set((await Promise.all(this.keepers.map((k) => k(personId)))).flat());
    for (const id of await this.blobs.ownedBy(personId)) if (!keep.has(id)) await this.blobs.remove(id);
  }
}
