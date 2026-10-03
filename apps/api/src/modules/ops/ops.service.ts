import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DriverError,
  type Actor,
  type AddLandmarkPhotoInput,
  type CashReceiptView,
  type LandmarksInput,
  type LandmarkPhotoView,
  type MerchantOnboardingInput,
  type MerchantOnboardingView,
  type OpsCashHolder,
  type OpsLandmark,
  type OpsPort,
  type OpsTask,
  type RecordCashReceiptInput,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { DriverAccountService } from '../driver-account/index.js';
import { EventsService } from '../events/index.js';
import { IdentityService } from '../identity/index.js';
import { CapsService, LedgerService, MerchantCashService, settlementReference } from '../ledger/index.js';
import { OrgsService } from '../orgs/index.js';
import { BLOB_STORE, PlacesService, ZoneResolver, type BlobStore } from '../places/index.js';
import { OPS_REPOSITORY, type CashReceiptRecord, type OpsRepository, type TaskRecord } from './ops.repository.js';

/** Computed cash task: a courier owing at least this share of his cap (or over it) is worth a visit. */
export const CASH_TASK_SHARE_OF_CAP = 0.5;
const DAY_MS = 86_400_000;

function taskView(t: TaskRecord): OpsTask {
  return {
    taskId: t.id,
    kind: t.kind,
    title_ar: t.title,
    refId: t.refId,
    amountIqd: typeof t.payload['amountIqd'] === 'number' ? t.payload['amountIqd'] : null,
    dueAt: t.dueAt,
    state: t.state,
    computed: false,
  };
}

/**
 * Ops mode for field staff (partner spec). Cash receipts post `driver_settlement` through the
 * ledger's public API (MerchantCashService.recordDriverSettlement, channel `ops_round`) in the same
 * unit of work as the receipt row and its event; onboarding creates the merchant org (in-memory
 * orgs today) as a draft with the owner as a vault person; photos are signed-PUT uploads.
 */
@Injectable()
export class OpsService implements OpsPort {
  constructor(
    @Inject(OPS_REPOSITORY) private readonly repo: OpsRepository,
    private readonly accounts: DriverAccountService,
    private readonly merchantCash: MerchantCashService,
    private readonly caps: CapsService,
    private readonly ledger: LedgerService,
    private readonly orgs: OrgsService,
    private readonly identity: IdentityService,
    private readonly events: EventsService,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() private readonly places?: PlacesService,
  ) {}

  private readonly zones = new ZoneResolver();

  /** Couriers holding customers' cash right now, most owed first, with names from the vault (logged). */
  async cashHolders(actor: Actor, _input: { cityId?: string | undefined }): Promise<OpsCashHolder[]> {
    const holders = (await this.ledger.cashInField()).holders;
    if (holders.length === 0) return [];
    const cards = await this.identity.memberCards(
      holders.map((h) => h.driverId),
      actor.personId,
      'ops_cash_round',
    );
    const rows: OpsCashHolder[] = [];
    for (const h of holders) {
      const s = await this.caps.status(h.driverId);
      rows.push({
        courierId: h.driverId,
        name: cards[h.driverId]?.name ?? null,
        phoneMasked: cards[h.driverId]?.phoneMasked ?? null,
        heldIqd: h.amountIqd,
        owedIqd: s.owedIqd,
        capIqd: s.capIqd,
        tier: s.tier,
        overCap: s.overCap,
      });
    }
    return rows.sort((a, b) => Number(b.overCap) - Number(a.overCap) || b.owedIqd - a.owedIqd || b.heldIqd - a.heldIqd);
  }

  /** Landmark places in the city (optionally one zone) with how many photos they have or have pending. */
  async landmarks(_actor: Actor, input: z.output<typeof LandmarksInput>): Promise<OpsLandmark[]> {
    const list = this.places?.landmarks(input.cityId) ?? [];
    const proposed = await this.repo.proposedPhotoCounts(list.map((p) => p.id));
    return list
      .map((p) => ({ placeId: p.id, name: p.name, zoneKey: this.zones.resolve(input.cityId, p.pin), pin: p.pin, photos: p.photos.length + (proposed.get(p.id) ?? 0) }))
      .filter((l) => !input.zoneKey || l.zoneKey === input.zoneKey)
      .sort((a, b) => a.photos - b.photos || a.name.localeCompare(b.name, 'ar'));
  }

  private async assertUpload(ownerId: string, uploadId: string): Promise<void> {
    const blob = await this.blobs.get(uploadId);
    if (!blob || blob.ownerId !== ownerId || blob.state !== 'stored') throw new DriverError('upload_invalid');
  }

  async addLandmarkPhoto(actor: Actor, input: z.output<typeof AddLandmarkPhotoInput>): Promise<LandmarkPhotoView> {
    await this.assertUpload(actor.personId, input.uploadId);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const row = await this.repo.addLandmarkPhoto(
        { targetKind: input.target.kind, targetId: input.target.id, uploadId: input.uploadId, caption: input.caption ?? null, localNames: input.localNames, state: 'proposed', addedById: actor.personId, createdAt: now },
        tx,
      );
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'landmark.proposed', occurredAt: now, payload: { photoId: row.id, target: input.target, localNames: input.localNames, via: 'field_ops' } },
        { name: 'place', id: input.target.id },
      );
      return { photoId: row.id, target: { kind: row.targetKind, id: row.targetId }, state: row.state, addedAt: row.createdAt };
    });
  }

  async recordCashReceipt(actor: Actor, input: RecordCashReceiptInput): Promise<CashReceiptView> {
    if (input.idempotencyKey) {
      const prior = await this.repo.cashReceiptByKey(input.idempotencyKey);
      if (prior && prior.courierId === input.courierId && prior.receivedById === actor.personId) return this.receiptView(prior);
      if (prior) throw new DriverError('invalid_input');
    }
    if (!this.accounts.verifyHandoverCode(input.courierId, input.code)) throw new DriverError('handover_code_invalid');
    const before = await this.caps.status(input.courierId);
    if (input.amountIqd > Math.max(0, -before.cashIqd)) throw new DriverError('cash_receipt_exceeds_held');
    const now = this.clock.now();
    const receipt = await this.uow.run(async (tx) => {
      const reference = settlementReference('D', input.courierId, now, await this.repo.countCashReceipts(input.courierId, tx));
      const cashAfter = await this.merchantCash.recordDriverSettlement({ driverId: input.courierId, amountIqd: input.amountIqd, channel: 'ops_round', reference });
      const row = await this.repo.addCashReceipt(
        { courierId: input.courierId, receivedById: actor.personId, amountIqd: input.amountIqd, reference, idempotencyKey: input.idempotencyKey ?? null, note: input.note ?? null, courierCashAfterIqd: cashAfter, createdAt: now },
        tx,
      );
      // Money §4: every hand-over has both confirmations and a WhatsApp receipt (notify subscribes).
      await this.events.emit(
        tx,
        {
          actorId: actor.personId,
          type: 'ops.cash_received',
          occurredAt: now,
          payload: { receiptId: row.id, courierId: input.courierId, amountIqd: input.amountIqd, reference, courierCashAfterIqd: cashAfter, whatsappReceipt: true },
          ...(input.idempotencyKey ? { idempotencyKey: `ops.cash_received:${input.idempotencyKey}` } : {}),
        },
        { name: 'person', id: input.courierId },
      );
      return row;
    });
    return this.receiptView(receipt);
  }

  private async receiptView(r: CashReceiptRecord): Promise<CashReceiptView> {
    const after = await this.caps.status(r.courierId);
    return { receiptId: r.id, courierId: r.courierId, amountIqd: r.amountIqd, reference: r.reference, receivedAt: r.createdAt, courierOwedIqd: after.owedIqd, courierCapRemainingIqd: after.capRemainingIqd };
  }

  async merchantOnboarding(actor: Actor, input: z.output<typeof MerchantOnboardingInput>): Promise<MerchantOnboardingView> {
    for (const id of [...input.menuPhotoUploadIds, ...(input.shopPhotoUploadId ? [input.shopPhotoUploadId] : [])]) await this.assertUpload(actor.personId, id);
    const contactPersonId = await this.identity.ensurePersonByPhone(input.contact.phone, actor.personId, 'merchant_onboarding');
    await this.identity.nameIfMissing(contactPersonId, input.contact.name);
    // TODO(orgs-prisma): orgs are in memory; the draft org lives until restart, the onboarding row stays.
    const org = this.orgs.create({ type: input.type, name: input.name, cityId: input.cityId, ownerId: contactPersonId });
    this.orgs.setMerchantSettings(org.id, { location: input.location });
    if (input.settlementMode) await this.merchantCash.configure(org.id, { mode: input.settlementMode });
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const row = await this.repo.addOnboarding(
        {
          orgId: org.id,
          cityId: input.cityId,
          name: input.name,
          type: input.type,
          contactPersonId,
          location: input.location,
          menuPhotoRefs: [...input.menuPhotoUploadIds],
          shopPhotoRef: input.shopPhotoUploadId ?? null,
          notes: input.notes ?? null,
          state: 'draft',
          createdById: actor.personId,
          createdAt: now,
        },
        tx,
      );
      const task = await this.repo.addTask(
        {
          cityId: input.cityId,
          kind: 'merchant_followup',
          refId: row.id,
          title: `كمّل تسجيل ${input.name}: المنيو من الصور وهوية صاحب المحل`,
          state: 'open',
          assigneeId: actor.personId,
          dueAt: new Date(now.getTime() + DAY_MS),
          payload: { merchantOrgId: org.id, menuPhotos: input.menuPhotoUploadIds.length, ...(input.settlementMode ? { settlementMode: input.settlementMode } : {}) },
          completedAt: null,
          completedById: null,
          createdAt: now,
        },
        tx,
      );
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'merchant.onboarding_drafted', occurredAt: now, payload: { onboardingId: row.id, merchantOrgId: org.id, cityId: input.cityId, type: input.type, menuPhotos: input.menuPhotoUploadIds.length } },
        { name: 'org', id: org.id },
      );
      return { onboardingId: row.id, merchantOrgId: org.id, state: row.state, menuPhotos: row.menuPhotoRefs.length, taskId: task.id, createdAt: row.createdAt };
    });
  }

  /** Stored tasks (mine or unassigned) plus cash to collect now: couriers at ≥ half their cap or over it. */
  async myTasks(actor: Actor, input: { cityId?: string | undefined }): Promise<OpsTask[]> {
    const stored = (await this.repo.openTasks(actor.personId)).filter((t) => !input.cityId || t.cityId === null || t.cityId === input.cityId).map(taskView);
    const computed: OpsTask[] = [];
    for (const h of (await this.ledger.cashInField()).holders) {
      const s = await this.caps.status(h.driverId);
      if (s.owedIqd <= 0 || (!s.overCap && s.owedIqd < s.capIqd * CASH_TASK_SHARE_OF_CAP)) continue;
      computed.push({
        taskId: `cash:${h.driverId}`,
        kind: 'cash_collection',
        title_ar: s.overCap ? `استلم كاش من المندوب — فوگ السقف (${s.owedIqd})` : `استلم كاش من المندوب (${s.owedIqd})`,
        refId: h.driverId,
        amountIqd: s.owedIqd,
        dueAt: null,
        state: 'open',
        computed: true,
      });
    }
    computed.sort((a, b) => (b.amountIqd ?? 0) - (a.amountIqd ?? 0));
    return [...computed, ...stored];
  }

  async completeTask(actor: Actor, input: { taskId: string; note?: string | undefined }): Promise<OpsTask> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const t = await this.repo.task(input.taskId, tx);
      if (!t) throw new DriverError('task_not_found');
      if (t.assigneeId && t.assigneeId !== actor.personId && !(await this.identity.hasRole(actor.personId, 'admin'))) throw new DriverError('forbidden');
      if (t.state === 'done') return taskView(t);
      const done = await this.repo.updateTask(t.id, { state: 'done', completedAt: now, completedById: actor.personId, payload: { ...t.payload, ...(input.note ? { note: input.note } : {}) } }, tx);
      await this.events.emit(tx, { actorId: actor.personId, type: 'ops.task_completed', occurredAt: now, payload: { taskId: t.id, kind: t.kind, refId: t.refId } }, { name: 'ops_task', id: t.id });
      return taskView(done);
    });
  }
}
