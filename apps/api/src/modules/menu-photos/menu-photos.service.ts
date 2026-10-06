import { Inject, Injectable } from '@nestjs/common';
import {
  DriverError,
  MENU_PHOTO_RULES,
  OPEN_MENU_PHOTO_STATES,
  type Actor,
  type AddMenuShotInput,
  type DecideMenuShotInput,
  type MenuPhotoDish,
  type MenuPhotoQueueInput,
  type MenuPhotoRequestRef,
  type MenuPhotoRequestState,
  type MenuPhotoRequestView,
  type MenuPhotosPort,
  type MerchantScope,
  type OpenMenuPhotoRequestsInput,
  type RequestMenuPhotosInput,
  type ScheduleMenuPhotosInput,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { CatalogService, type CatalogItemRecord } from '../catalog/index.js';
import { EventsService } from '../events/index.js';
import { IdentityService } from '../identity/index.js';
import { itemPhotoUrl, UPLOAD_PHOTO_PREFIX } from '../merchant-admin/index.js';
import { OrgsService } from '../orgs/index.js';
import { BLOB_STORE, ownsStoredUpload, type BlobStore } from '../places/index.js';
import { MENU_PHOTOS_REPOSITORY, type MenuPhotoRequestRecord, type MenuPhotoShotRecord, type MenuPhotosRepository } from './menu-photos.repository.js';

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
/** Before the photos are handed over: the merchant can still call it off, field ops can still shoot. */
const BEFORE_SHOOT: readonly MenuPhotoRequestState[] = ['requested', 'scheduled'];
/** What the Partner app lists: requests waiting for a visit or being shot. */
const FOR_FIELD_OPS: readonly MenuPhotoRequestState[] = ['requested', 'scheduled'];
/** Vault purpose for the photographer's first name on the request (logged by identity). */
const NAME_PURPOSE = 'menu_photo_service';

/** Who is looking: the store (owner may act), field ops (the one who has it may act), the Console (reads). */
type Perspective = { kind: 'merchant'; owner: boolean } | { kind: 'ops'; admin: boolean } | { kind: 'console' };

/**
 * Menu photo service (maps program k3, spec §5.7). A restaurant owner asks for a shoot (some dishes or
 * the whole menu); a field ops person takes it by setting the visit, uploads one photo per dish
 * through the Partner app and hands them over; the owner accepts or rejects each. Accepting writes the
 * dish's photo through the catalog exactly like the owner's own photo edit (`upload:<id>`, event
 * `item.photo_replaced`), so customers only ever see a photo the owner said yes to. One open request
 * per store; every state change is a guarded update (`menu_photo_state_conflict` when another phone
 * moved it first). Free of charge: no money moves anywhere here.
 */
@Injectable()
export class MenuPhotosService implements MenuPhotosPort {
  constructor(
    @Inject(MENU_PHOTOS_REPOSITORY) private readonly repo: MenuPhotosRepository,
    private readonly catalog: CatalogService,
    private readonly orgs: OrgsService,
    private readonly identity: IdentityService,
    private readonly events: EventsService,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ───────────────────────── access ─────────────────────────

  /** Owner or staff of the store; FORBIDDEN otherwise. True for the owner. */
  private async merchantOwner(actor: Actor, merchantOrgId: string): Promise<boolean> {
    if (await this.identity.hasRole(actor.personId, 'merchant_owner', merchantOrgId)) return true;
    if (await this.identity.hasRole(actor.personId, 'merchant_staff', merchantOrgId)) return false;
    throw new DriverError('forbidden');
  }

  private async requireOwner(actor: Actor, merchantOrgId: string): Promise<void> {
    if (!(await this.merchantOwner(actor, merchantOrgId))) throw new DriverError('forbidden');
  }

  /** The store's own request (another store's id reads as not found). */
  private async storeRequest(merchantOrgId: string, requestId: string): Promise<MenuPhotoRequestRecord> {
    const rec = await this.repo.get(requestId);
    if (!rec || rec.orgId !== merchantOrgId) throw new DriverError('menu_photo_not_found');
    return rec;
  }

  private async anyRequest(requestId: string): Promise<MenuPhotoRequestRecord> {
    const rec = await this.repo.get(requestId);
    if (!rec) throw new DriverError('menu_photo_not_found');
    return rec;
  }

  /**
   * Field ops may work on a request nobody has yet or one they hold; an admin may step in on anyone's.
   * Returns the guard for the update so the same rule holds when it lands.
   */
  private async opsHold(actor: Actor, rec: MenuPhotoRequestRecord): Promise<{ admin: boolean; holders: readonly (string | null)[] | undefined }> {
    const admin = await this.identity.hasRole(actor.personId, 'admin');
    if (!admin && rec.assignedOpsId !== null && rec.assignedOpsId !== actor.personId) throw new DriverError('menu_photo_taken');
    return { admin, holders: admin ? undefined : [null, actor.personId] };
  }

  // ───────────────────────── views ─────────────────────────

  /** Views for several requests at once: one org and menu read per store, one name read for all. */
  private async views(actor: Actor, recs: readonly MenuPhotoRequestRecord[], perspective: Perspective): Promise<MenuPhotoRequestView[]> {
    if (recs.length === 0) return [];
    const shots = await this.repo.shotsOf(recs.map((r) => r.id));
    const orgIds = [...new Set(recs.map((r) => r.orgId))];
    const orgs = new Map(await Promise.all(orgIds.map(async (id) => [id, await this.orgs.get(id)] as const)));
    const menus = new Map(await Promise.all(orgIds.map(async (id) => [id, await this.catalog.adminMenu(id)] as const)));
    const opsIds = [...new Set(recs.map((r) => r.assignedOpsId).filter((x): x is string => x !== null))];
    const names = opsIds.length > 0 ? await this.identity.firstNamesFor(opsIds, actor.personId, NAME_PURPOSE) : {};
    return recs.map((rec) => {
      const org = orgs.get(rec.orgId);
      const menu = menus.get(rec.orgId) ?? [];
      const mine = shots.filter((s) => s.requestId === rec.id);
      const location = org?.merchant?.location ?? null;
      const canAct =
        perspective.kind === 'merchant'
          ? perspective.owner
          : perspective.kind === 'ops'
            ? BEFORE_SHOOT.includes(rec.state) && (perspective.admin || rec.assignedOpsId === null || rec.assignedOpsId === actor.personId)
            : false;
      return {
        requestId: rec.id,
        merchantOrgId: rec.orgId,
        storeName: org?.name ?? '',
        cityId: rec.cityId,
        zoneKey: location?.zoneKey ?? null,
        pin: location?.pin ?? null,
        state: rec.state,
        note: rec.note,
        wholeMenu: rec.itemIds.length === 0,
        dishes: this.dishes(rec, menu, mine),
        photographerName: rec.assignedOpsId ? (names[rec.assignedOpsId] ?? null) : null,
        assignedToMe: rec.assignedOpsId === actor.personId,
        scheduledFor: rec.scheduledFor,
        requestedAt: rec.createdAt,
        shotAt: rec.shotAt,
        closedAt: rec.closedAt,
        counts: {
          dishes: rec.itemIds.length === 0 ? menu.length : rec.itemIds.filter((id) => menu.some((i) => i.id === id)).length,
          proposed: mine.filter((s) => s.state === 'proposed').length,
          accepted: mine.filter((s) => s.state === 'accepted').length,
          rejected: mine.filter((s) => s.state === 'rejected').length,
        },
        canAct,
      };
    });
  }

  /** The dishes to shoot in menu order (named ones, or every dish), each with its photo today and the visit's. */
  private dishes(rec: MenuPhotoRequestRecord, menu: readonly CatalogItemRecord[], shots: readonly MenuPhotoShotRecord[]): MenuPhotoDish[] {
    const wanted = rec.itemIds.length === 0 ? null : new Set(rec.itemIds);
    return menu
      .filter((i) => !wanted || wanted.has(i.id))
      .map((i) => {
        const shot = shots.find((s) => s.itemId === i.id);
        return {
          itemId: i.id,
          nameAr: i.nameAr,
          categoryAr: i.categoryAr,
          currentPhotoUrl: itemPhotoUrl(this.blobs, i.photoUrl),
          shot: shot ? { shotId: shot.id, itemId: shot.itemId, photoUrl: this.blobs.readUrl(shot.uploadId), state: shot.state, takenAt: shot.createdAt } : null,
        };
      });
  }

  private async view(actor: Actor, rec: MenuPhotoRequestRecord, perspective: Perspective): Promise<MenuPhotoRequestView> {
    const [v] = await this.views(actor, [rec], perspective);
    if (!v) throw new DriverError('menu_photo_not_found');
    return v;
  }

  private emit(tx: Tx, actor: Actor, type: string, rec: MenuPhotoRequestRecord, payload: Record<string, unknown> = {}): Promise<unknown> {
    return this.events.emit(tx, { actorId: actor.personId, type, occurredAt: this.clock.now(), payload: { requestId: rec.id, merchantOrgId: rec.orgId, cityId: rec.cityId, ...payload } }, { name: 'org', id: rec.orgId });
  }

  /** Uploads nobody will see any more (a re-shot or rejected photo, a cancelled visit's photos). */
  private async dropUploads(ids: readonly string[]): Promise<void> {
    for (const id of ids) await this.blobs.remove(id);
  }

  // ───────────────────────── merchant ─────────────────────────

  async merchantList(actor: Actor, input: MerchantScope): Promise<MenuPhotoRequestView[]> {
    const owner = await this.merchantOwner(actor, input.merchantOrgId);
    const recs = await this.repo.forOrg(input.merchantOrgId, MENU_PHOTO_RULES.historyLimit);
    const open = recs.filter((r) => OPEN_MENU_PHOTO_STATES.includes(r.state));
    return this.views(actor, [...open, ...recs.filter((r) => !open.includes(r))], { kind: 'merchant', owner });
  }

  async request(actor: Actor, input: z.output<typeof RequestMenuPhotosInput>): Promise<MenuPhotoRequestView> {
    await this.requireOwner(actor, input.merchantOrgId);
    const org = await this.orgs.get(input.merchantOrgId);
    const menu = new Set((await this.catalog.adminMenu(org.id)).map((i) => i.id));
    const itemIds = [...new Set(input.itemIds)];
    if (itemIds.some((id) => !menu.has(id))) throw new DriverError('menu_item_not_found');
    const rec = await this.uow.run(async (tx) => {
      if ((await this.repo.forOrg(org.id, MENU_PHOTO_RULES.historyLimit, tx)).some((r) => OPEN_MENU_PHOTO_STATES.includes(r.state))) throw new DriverError('menu_photo_request_open');
      const created = await this.repo.create(
        { orgId: org.id, cityId: org.cityId, requestedById: actor.personId, note: input.note?.trim() || null, itemIds, state: 'requested', assignedOpsId: null, scheduledFor: null, shotAt: null, closedAt: null, closedById: null, createdAt: this.clock.now() },
        tx,
      );
      await this.emit(tx, actor, 'menu_photos.requested', created, { dishes: itemIds.length, wholeMenu: itemIds.length === 0 });
      return created;
    });
    return this.view(actor, rec, { kind: 'merchant', owner: true });
  }

  async cancel(actor: Actor, input: MenuPhotoRequestRef): Promise<MenuPhotoRequestView> {
    await this.requireOwner(actor, input.merchantOrgId);
    const rec = await this.storeRequest(input.merchantOrgId, input.requestId);
    if (!BEFORE_SHOOT.includes(rec.state)) throw new DriverError('menu_photo_state_conflict');
    const now = this.clock.now();
    const { cancelled, orphaned } = await this.uow.run(async (tx) => {
      const done = await this.repo.update(rec.id, { states: BEFORE_SHOOT }, { state: 'cancelled', closedAt: now, closedById: actor.personId }, tx);
      if (!done) throw new DriverError('menu_photo_state_conflict');
      await this.emit(tx, actor, 'menu_photos.cancelled', done, { assignedOpsId: done.assignedOpsId });
      return { cancelled: done, orphaned: (await this.repo.shotsOf([rec.id], tx)).map((s) => s.uploadId) };
    });
    await this.dropUploads(orphaned);
    return this.view(actor, cancelled, { kind: 'merchant', owner: true });
  }

  /**
   * Accept: the photo becomes the dish's photo (catalog, same as the owner's own edit). Reject: the
   * photo is deleted. When no photo of the visit is left undecided, the request is done.
   */
  async decide(actor: Actor, input: DecideMenuShotInput): Promise<MenuPhotoRequestView> {
    await this.requireOwner(actor, input.merchantOrgId);
    const rec = await this.storeRequest(input.merchantOrgId, input.requestId);
    if (rec.state !== 'shot') throw new DriverError('menu_photo_state_conflict');
    const shot = await this.repo.shot(input.shotId);
    if (!shot || shot.requestId !== rec.id) throw new DriverError('menu_photo_not_found');
    const now = this.clock.now();
    const after = await this.uow.run(async (tx) => {
      const decided = await this.repo.decideShot(shot.id, { state: input.accept ? 'accepted' : 'rejected', decidedById: actor.personId, decidedAt: now }, tx);
      if (!decided) throw new DriverError('menu_photo_state_conflict');
      if (input.accept) {
        await this.catalog.replacePhoto(rec.orgId, shot.itemId, `${UPLOAD_PHOTO_PREFIX}${shot.uploadId}`, tx);
        await this.events.emit(
          tx,
          { actorId: actor.personId, type: 'item.photo_replaced', occurredAt: now, payload: { merchantOrgId: rec.orgId, itemId: shot.itemId, uploadId: shot.uploadId, via: 'menu_photo_service', requestId: rec.id } },
          { name: 'org', id: rec.orgId },
        );
      }
      await this.emit(tx, actor, input.accept ? 'menu_photos.accepted' : 'menu_photos.rejected', rec, { shotId: shot.id, itemId: shot.itemId, takenById: shot.takenById });
      const undecided = (await this.repo.shotsOf([rec.id], tx)).some((s) => s.state === 'proposed');
      if (undecided) return rec;
      const done = await this.repo.update(rec.id, { states: ['shot'] }, { state: 'done', closedAt: now, closedById: actor.personId }, tx);
      if (!done) throw new DriverError('menu_photo_state_conflict');
      await this.emit(tx, actor, 'menu_photos.done', done);
      return done;
    });
    if (!input.accept) await this.dropUploads([shot.uploadId]);
    return this.view(actor, after, { kind: 'merchant', owner: true });
  }

  // ───────────────────────── field ops ─────────────────────────

  async openForOps(actor: Actor, input: z.output<typeof OpenMenuPhotoRequestsInput>): Promise<MenuPhotoRequestView[]> {
    const admin = await this.identity.hasRole(actor.personId, 'admin');
    const recs = await this.repo.inCity(input.cityId, FOR_FIELD_OPS, MENU_PHOTO_RULES.queueLimit);
    // His own visits first (soonest first), then requests nobody has taken (oldest first), then the rest.
    const rank = (r: MenuPhotoRequestRecord) => (r.assignedOpsId === actor.personId ? 0 : r.assignedOpsId === null ? 1 : 2);
    const sorted = [...recs].sort((a, b) => rank(a) - rank(b) || (a.scheduledFor?.getTime() ?? a.createdAt.getTime()) - (b.scheduledFor?.getTime() ?? b.createdAt.getTime()));
    return this.views(actor, sorted, { kind: 'ops', admin });
  }

  async opsGet(actor: Actor, input: { requestId: string }): Promise<MenuPhotoRequestView> {
    const admin = await this.identity.hasRole(actor.personId, 'admin');
    return this.view(actor, await this.anyRequest(input.requestId), { kind: 'ops', admin });
  }

  /** Takes the request (if nobody has it) and sets or moves the visit: from an hour ago to two weeks ahead. */
  async schedule(actor: Actor, input: ScheduleMenuPhotosInput): Promise<MenuPhotoRequestView> {
    const rec = await this.anyRequest(input.requestId);
    if (!BEFORE_SHOOT.includes(rec.state)) throw new DriverError('menu_photo_state_conflict');
    const { admin, holders } = await this.opsHold(actor, rec);
    const now = this.clock.now().getTime();
    const at = input.scheduledFor.getTime();
    if (at < now - MENU_PHOTO_RULES.scheduleGraceMin * MIN_MS || at > now + MENU_PHOTO_RULES.maxScheduleAheadDays * DAY_MS) throw new DriverError('menu_photo_schedule_invalid');
    const updated = await this.uow.run(async (tx) => {
      const u = await this.repo.update(rec.id, { states: BEFORE_SHOOT, ...(holders ? { assignedOpsIds: holders } : {}) }, { state: 'scheduled', assignedOpsId: rec.assignedOpsId ?? actor.personId, scheduledFor: input.scheduledFor }, tx);
      if (!u) throw new DriverError('menu_photo_state_conflict');
      await this.emit(tx, actor, 'menu_photos.scheduled', u, { scheduledFor: input.scheduledFor.toISOString(), assignedOpsId: u.assignedOpsId });
      return u;
    });
    return this.view(actor, updated, { kind: 'ops', admin });
  }

  /**
   * One dish's photo. It must be the caller's own finished upload and a dish on the request. A
   * request nobody had is taken on the spot (visit = now): someone shooting in the shop needs no
   * appointment first. A second photo of the same dish replaces the first.
   */
  async addShot(actor: Actor, input: AddMenuShotInput): Promise<MenuPhotoRequestView> {
    if (!(await ownsStoredUpload(this.blobs, input.uploadId, actor.personId))) throw new DriverError('upload_invalid');
    const rec = await this.anyRequest(input.requestId);
    if (!BEFORE_SHOOT.includes(rec.state)) throw new DriverError('menu_photo_state_conflict');
    const { admin, holders } = await this.opsHold(actor, rec);
    if (rec.itemIds.length > 0 && !rec.itemIds.includes(input.itemId)) throw new DriverError('menu_photo_item_not_listed');
    await this.catalog.adminItem(rec.orgId, input.itemId);
    const now = this.clock.now();
    const { current, replaced } = await this.uow.run(async (tx) => {
      let cur = rec;
      if (rec.state === 'requested') {
        const taken = await this.repo.update(rec.id, { states: ['requested'], ...(holders ? { assignedOpsIds: holders } : {}) }, { state: 'scheduled', assignedOpsId: rec.assignedOpsId ?? actor.personId, scheduledFor: now }, tx);
        if (!taken) throw new DriverError('menu_photo_state_conflict');
        await this.emit(tx, actor, 'menu_photos.scheduled', taken, { scheduledFor: now.toISOString(), assignedOpsId: taken.assignedOpsId, onTheSpot: true });
        cur = taken;
      }
      const put = await this.repo.putShot({ requestId: rec.id, itemId: input.itemId, uploadId: input.uploadId, takenById: actor.personId, at: now }, tx);
      await this.emit(tx, actor, 'menu_photos.shot_added', cur, { shotId: put.shot.id, itemId: input.itemId, reshoot: put.replacedUploadId !== null });
      return { current: cur, replaced: put.replacedUploadId };
    });
    if (replaced && replaced !== input.uploadId) await this.dropUploads([replaced]);
    return this.view(actor, current, { kind: 'ops', admin });
  }

  /** Hands the photos over: the owner hears «صور المنيو جاهزة» (notify) and decides on each. */
  async markShot(actor: Actor, input: { requestId: string }): Promise<MenuPhotoRequestView> {
    const rec = await this.anyRequest(input.requestId);
    if (rec.state === 'requested') throw new DriverError('menu_photo_no_shots');
    if (rec.state !== 'scheduled') throw new DriverError('menu_photo_state_conflict');
    const { admin, holders } = await this.opsHold(actor, rec);
    const now = this.clock.now();
    const updated = await this.uow.run(async (tx) => {
      const photos = (await this.repo.shotsOf([rec.id], tx)).filter((s) => s.state === 'proposed').length;
      if (photos === 0) throw new DriverError('menu_photo_no_shots');
      const u = await this.repo.update(rec.id, { states: ['scheduled'], ...(holders ? { assignedOpsIds: holders } : {}) }, { state: 'shot', shotAt: now }, tx);
      if (!u) throw new DriverError('menu_photo_state_conflict');
      await this.emit(tx, actor, 'menu_photos.shot', u, { photos });
      return u;
    });
    return this.view(actor, updated, { kind: 'ops', admin });
  }

  // ───────────────────────── Console ─────────────────────────

  /** Open requests first (oldest first: the longest wait on top), then closed ones, latest closed first. */
  async queue(actor: Actor, input: z.output<typeof MenuPhotoQueueInput>): Promise<MenuPhotoRequestView[]> {
    const recs = await this.repo.inCity(input.cityId, input.state ? [input.state] : null, MENU_PHOTO_RULES.queueLimit);
    const open = recs.filter((r) => OPEN_MENU_PHOTO_STATES.includes(r.state));
    const closed = recs.filter((r) => !OPEN_MENU_PHOTO_STATES.includes(r.state)).sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0));
    return this.views(actor, [...open, ...closed], { kind: 'console' });
  }
}
