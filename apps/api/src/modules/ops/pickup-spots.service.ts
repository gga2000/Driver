import { Injectable } from '@nestjs/common';
import type { Actor, ConsolePickupSpotView, MerchantOrgInput, PickupSpotView, PickupSpotsOpsPort, PickupStoreRow, PickupStoresInput, SetPickupSpotInput } from '@driver/contracts';
import { AuditLogService } from '../controls/index.js';
import { MerchantService } from '../merchant/index.js';
import { OrgsService } from '../orgs/index.js';

/** The audit row a Console save writes (`console_audit_log`); also how the page finds the last one. */
export const PICKUP_SPOT_AUDIT = { action: 'store.pickup_spot_set', subjectKind: 'store' } as const;

/**
 * Console › المطاعم (Ali 2026-10-07): field ops and admins see each store's pickup spot and set it
 * when the owner can't (he has no smartphone, or ops stood at the window themselves). The spot itself
 * — validation, the "your own upload" rule for new photos, deleting dropped photos, the store's event
 * — is the merchant module's (`MerchantService.consoleSetPickupSpot`); this adds the store list and
 * the Console audit row saying who changed it. The role gate is the router's (`PICKUP_SPOT_CONSOLE_ROLES`).
 */
@Injectable()
export class OpsPickupSpotsService implements PickupSpotsOpsPort {
  constructor(
    private readonly merchant: MerchantService,
    private readonly orgs: OrgsService,
    private readonly audits: AuditLogService,
  ) {}

  /** The city's restaurants and grocers by name, with how far their spot is set (one org read). */
  async stores(_actor: Actor, input: PickupStoresInput): Promise<PickupStoreRow[]> {
    const rows: PickupStoreRow[] = [];
    for (const org of await this.orgs.inCity(input.cityId)) {
      if (org.type !== 'restaurant' && org.type !== 'grocer') continue;
      const spot = org.merchant?.pickupSpot ?? null;
      rows.push({ merchantOrgId: org.id, name: org.name, type: org.type, note: spot?.note ?? null, photos: spot?.photoRefs.length ?? 0, updatedAt: spot?.updatedAt ?? null });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.merchantOrgId.localeCompare(b.merchantOrgId));
  }

  async get(_actor: Actor, input: MerchantOrgInput): Promise<ConsolePickupSpotView> {
    return this.view(await this.merchant.consolePickupSpot(input.merchantOrgId));
  }

  async set(actor: Actor, input: SetPickupSpotInput): Promise<ConsolePickupSpotView> {
    const saved = await this.merchant.consoleSetPickupSpot(actor, input);
    const org = await this.orgs.get(saved.merchantOrgId);
    await this.audits.record({
      cityId: org.cityId,
      actorId: actor.personId,
      action: PICKUP_SPOT_AUDIT.action,
      subjectKind: PICKUP_SPOT_AUDIT.subjectKind,
      subjectId: org.id,
      summaryAr: saved.note || saved.photos.length > 0 ? `غيّر مكان الاستلام لـ${org.name}` : `شال مكان الاستلام من ${org.name}`,
      detail: { note: saved.note !== null, photos: saved.photos.length },
    });
    return this.view(saved);
  }

  /**
   * The store's name, and the latest Console edit when it is the spot couriers see now: an owner's
   * save after it (a later `updatedAt`) means the owner spoke last, so no Console line is shown. A
   * cleared spot has no time: it is the Console's only if its last edit was the clearing.
   */
  private async view(spot: PickupSpotView): Promise<ConsolePickupSpotView> {
    const org = await this.orgs.get(spot.merchantOrgId);
    const [last] = await this.audits.list({ subjectKind: PICKUP_SPOT_AUDIT.subjectKind, subjectId: org.id, limit: 1 });
    const consoleSpoke =
      last !== undefined &&
      last.action === PICKUP_SPOT_AUDIT.action &&
      (spot.updatedAt === null ? last.detail['note'] === false && last.detail['photos'] === 0 : last.at.getTime() >= spot.updatedAt.getTime());
    return { ...spot, storeName: org.name, consoleEdit: consoleSpoke ? { at: last.at, byName: last.actorName } : null };
  }
}
