import { Inject, Injectable } from '@nestjs/common';
import {
  DISH_PHOTO_RULES,
  type Actor,
  type DishPhotoQueueInput,
  type DishPhotoReviewPort,
  type DishPhotoRow,
  type DishPhotoTakedownReason,
  type KeepDishPhotoInput,
  type KeepDishPhotoResult,
  type TakeDownDishPhotoInput,
  type TakeDownDishPhotoResult,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { CatalogService, itemPhotoUrl } from '../catalog/index.js';
import { AuditLogService } from '../controls/index.js';
import { EventsService } from '../events/index.js';
import { OrgsService } from '../orgs/index.js';
import { BLOB_STORE, type BlobStore } from '../places/index.js';

/** The audit rows «تمام» and «انزّلها» write (`console_audit_log`). */
export const DISH_PHOTO_AUDIT = { action: 'store.dish_photo_kept', takenDown: 'store.dish_photo_taken_down', subjectKind: 'store' } as const;

/** The store's event when a photo comes down; the Merchant app reads it to tell the owner why. */
export const DISH_PHOTO_TAKEN_DOWN_EVENT = 'catalog.photo_taken_down';

/** The audit line's words for each reason (staff read them in the Console log). */
const REASON_AR: Record<DishPhotoTakedownReason, string> = {
  blurry: 'مو واضحة',
  wrong_dish: 'مو هاي الأكلة',
  people: 'بيها ناس أو وجوه',
  other: 'سبب ثاني',
};

/**
 * p4 (Ali 2026-10-08), Console › الموافقات: dish photos a shop put up itself show to customers at
 * once and wait for the team's same-day look. The pending stamp, the queue and clearing it are the
 * catalog module's (`CatalogService.photoReviewQueue` / `keepShopPhoto` / `takeDownShopPhoto`);
 * this adds the city filter, the store and dish names, the signed photo link, the store's event and
 * the audit rows. The role gate is the router's (`DISH_PHOTO_REVIEW_ROLES`).
 */
@Injectable()
export class OpsDishPhotosService implements DishPhotoReviewPort {
  constructor(
    private readonly catalog: CatalogService,
    private readonly orgs: OrgsService,
    private readonly audits: AuditLogService,
    private readonly uow: UnitOfWork,
    private readonly events: EventsService,
    @Inject(CLOCK) private readonly clock: Clock,
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
   * shop put up another photo since (a newer stamp), nothing is cleared and the row comes back fresh;
   * the catalog's conditional clear settles a race with an upload between the check and the write.
   */
  async keep(actor: Actor, input: KeepDishPhotoInput): Promise<KeepDishPhotoResult> {
    const [item] = await this.catalog.itemsOf(input.merchantOrgId, [input.itemId]);
    if (!item?.photoReviewPendingAt) return { itemId: input.itemId, outcome: 'gone' };
    if (item.photoReviewPendingAt.getTime() !== input.pendingSince.getTime()) return { itemId: item.id, outcome: 'changed' };
    const org = await this.orgs.get(item.orgId);
    const done = await this.uow.run(async (tx) => {
      if (!(await this.catalog.keepShopPhoto(item.id, input.pendingSince, tx))) return false;
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
      return true;
    });
    return { itemId: item.id, outcome: done ? 'kept' : 'changed' };
  }

  /**
   * «انزّلها»: the photo comes off the menu (the dish shows none until the shop puts up another) and
   * the store gets `catalog.photo_taken_down` with the reason, for the Merchant app to tell the owner.
   * Same version rule as «تمام»; the catalog's conditional clear settles a race with a new upload.
   */
  async takeDown(actor: Actor, input: TakeDownDishPhotoInput): Promise<TakeDownDishPhotoResult> {
    const [item] = await this.catalog.itemsOf(input.merchantOrgId, [input.itemId]);
    if (!item?.photoReviewPendingAt) return { itemId: input.itemId, outcome: 'gone' };
    if (item.photoReviewPendingAt.getTime() !== input.pendingSince.getTime()) return { itemId: item.id, outcome: 'changed' };
    const org = await this.orgs.get(item.orgId);
    const at = this.clock.now();
    const done = await this.uow.run(async (tx) => {
      const down = await this.catalog.takeDownShopPhoto(item.id, input.pendingSince, tx);
      if (!down) return false;
      await this.events.emit(tx, { actorId: actor.personId, type: DISH_PHOTO_TAKEN_DOWN_EVENT, occurredAt: at, payload: { merchantOrgId: org.id, itemId: item.id, reason: input.reason, at: at.toISOString() } }, { name: 'org', id: org.id });
      await this.audits.record(
        {
          cityId: org.cityId,
          actorId: actor.personId,
          action: DISH_PHOTO_AUDIT.takenDown,
          subjectKind: DISH_PHOTO_AUDIT.subjectKind,
          subjectId: org.id,
          summaryAr: `نزّل صورة «${item.nameAr}» من ${org.name}: ${REASON_AR[input.reason]}`,
          detail: { itemId: item.id, reason: input.reason, pendingSince: input.pendingSince.toISOString() },
        },
        tx,
      );
      return true;
    });
    return { itemId: item.id, outcome: done ? 'taken_down' : 'changed' };
  }
}
