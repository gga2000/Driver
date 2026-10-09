import { Inject, Injectable } from '@nestjs/common';
import { DISH_PHOTO_RULES, type Actor, type DishPhotoQueueInput, type DishPhotoReviewPort, type DishPhotoRow, type KeepDishPhotoInput, type KeepDishPhotoResult } from '@driver/contracts';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { CatalogService, itemPhotoUrl } from '../catalog/index.js';
import { AuditLogService } from '../controls/index.js';
import { OrgsService } from '../orgs/index.js';
import { BLOB_STORE, type BlobStore } from '../places/index.js';

/** The audit row «تمام» writes (`console_audit_log`). */
export const DISH_PHOTO_AUDIT = { action: 'store.dish_photo_kept', subjectKind: 'store' } as const;

/**
 * p4 (Ali 2026-10-08), Console › الموافقات: dish photos a shop put up itself show to customers at
 * once and wait for the team's same-day look. The pending stamp, the queue and clearing it are the
 * catalog module's (`CatalogService.photoReviewQueue` / `markPhotoReviewed`); this adds the city
 * filter, the store and dish names, the signed photo link and the audit row. The role gate is the
 * router's (`DISH_PHOTO_REVIEW_ROLES`).
 */
@Injectable()
export class OpsDishPhotosService implements DishPhotoReviewPort {
  constructor(
    private readonly catalog: CatalogService,
    private readonly orgs: OrgsService,
    private readonly audits: AuditLogService,
    private readonly uow: UnitOfWork,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
  ) {}

  /** The city's waiting photos, oldest first (the longest wait on top). */
  async queue(_actor: Actor, input: DishPhotoQueueInput): Promise<DishPhotoRow[]> {
    const items = await this.catalog.photoReviewQueue(DISH_PHOTO_RULES.queueLimit);
    const stores = new Map<string, { name: string; cityId: string } | null>();
    const rows: DishPhotoRow[] = [];
    for (const i of items) {
      if (!i.photoReviewPendingAt || !i.photoUrl) continue;
      if (!stores.has(i.orgId)) stores.set(i.orgId, await this.orgs.get(i.orgId).then((o) => ({ name: o.name, cityId: o.cityId }), () => null));
      const store = stores.get(i.orgId);
      if (!store || store.cityId !== input.cityId) continue;
      rows.push({
        itemId: i.id,
        merchantOrgId: i.orgId,
        storeName: store.name,
        dishName: i.nameAr,
        priceIqd: i.priceIqd,
        photoUrl: itemPhotoUrl(this.blobs, i.photoUrl),
        pendingSince: i.photoReviewPendingAt,
      });
    }
    return rows;
  }

  /**
   * «تمام»: the photo stays and the dish leaves the queue. Only the version staff looked at: if the
   * shop put up another photo since (a newer stamp), nothing is cleared and the row comes back fresh.
   */
  async keep(actor: Actor, input: KeepDishPhotoInput): Promise<KeepDishPhotoResult> {
    const [item] = await this.catalog.itemsOf(input.merchantOrgId, [input.itemId]);
    if (!item?.photoReviewPendingAt) return { itemId: input.itemId, outcome: 'gone' };
    if (item.photoReviewPendingAt.getTime() !== input.pendingSince.getTime()) return { itemId: item.id, outcome: 'changed' };
    const org = await this.orgs.get(item.orgId);
    await this.uow.run(async (tx) => {
      await this.catalog.markPhotoReviewed(item.id, tx);
      await this.audits.record(
        {
          cityId: org.cityId,
          actorId: actor.personId,
          action: DISH_PHOTO_AUDIT.action,
          subjectKind: DISH_PHOTO_AUDIT.subjectKind,
          subjectId: org.id,
          summaryAr: `راجع صورة «${item.nameAr}» من ${org.name} وخلّاها`,
          detail: { itemId: item.id, pendingSince: input.pendingSince.toISOString() },
        },
        tx,
      );
    });
    return { itemId: item.id, outcome: 'kept' };
  }
}
