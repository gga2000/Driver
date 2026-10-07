import { Inject, Injectable } from '@nestjs/common';
import {
  ApprovalKind,
  DriverError,
  type Actor,
  type ApprovalItem,
  type ApprovalPhoto,
  type ApprovalsView,
  type DecideApprovalInput,
  type DecideApprovalOutput,
  type RoleKind,
  vehicleColourKey,
  type VehicleColour,
  type VehicleFeature,
} from '@driver/contracts';
import { t } from '@driver/i18n';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { ConfigService } from '../config/index.js';
import { AuditLogService, StaffNames } from '../controls/index.js';
import { DOCUMENT_KIND_AR, DriverAccountService } from '../driver-account/index.js';
import { FleetService } from '../fleet/index.js';
import { IdentityService } from '../identity/index.js';
import { OpsService } from '../ops/index.js';
import { OrgsService } from '../orgs/index.js';
import { BLOB_STORE, PlacesService, type BlobStore } from '../places/index.js';
import { PromotionsService } from '../promotions/index.js';

/** Who decides what (the router lets `admin`, `support`, `field_ops` in; each kind narrows it). */
export const APPROVAL_KIND_ROLES: Record<ApprovalKind, readonly RoleKind[]> = {
  // driver-account `reviewDocument` reviewers
  driver_document: ['field_ops', 'support', 'admin'],
  // merchant-admin `deals.review`: the platform approval switch
  merchant_deal: ['admin', 'support'],
  landmark_photo: ['field_ops', 'support', 'admin'],
  // A new merchant goes live: admin, or field ops other than the one who drafted it
  merchant_onboarding: ['admin', 'field_ops'],
  fleet_vehicle: ['field_ops', 'support', 'admin'],
  // The car check of a driver's claimed features (ride ideas n1, n2): whoever checks cars.
  vehicle_features: ['field_ops', 'support', 'admin'],
};

export const APPROVAL_KIND_AR: Record<ApprovalKind, string> = {
  driver_document: 'مستمسك سايق',
  merchant_deal: 'عرض مطعم',
  landmark_photo: 'صورة معلم',
  merchant_onboarding: 'تفعيل محل',
  fleet_vehicle: 'مركبة أسطول',
  vehicle_features: 'مميزات سيارة',
};

/** The `photo` document is the driver's main photo customers see (Ali, 2026-10-06). */
const MAIN_PHOTO_TITLE_AR = 'الصورة الرئيسية';
const MAIN_PHOTO_HINT_AR = 'تبين للزبائن بعد الموافقة';
const DEAL_TYPE_AR: Record<string, string> = { percent: 'خصم نسبة', fixed: 'خصم مبلغ', free_delivery: 'توصيل مجاني', bogo: 'واحد ويا واحد' };
const VEHICLE_AR: Record<string, string> = { bike: 'ماطور', tuktuk: 'تكتك', car: 'سيارة', suv: 'جكسارة', van: 'كيا', intercity: 'سيارة خطوط' };
const REF_TTL_MS = 5 * 60_000;

/** Model and colour, when the registry has them (ride step 3, d1). */
function carFacts(v: { model: string | null; colour: VehicleColour | null }): ApprovalItem['facts'] {
  return [...(v.model ? [{ label_ar: 'الموديل', value: v.model }] : []), ...(v.colour ? [{ label_ar: 'اللون', value: t(vehicleColourKey(v.colour)) }] : [])];
}

/** Every claimed feature with whether the car check already confirmed it. */
function featureChecks(v: { features: readonly VehicleFeature[]; featuresConfirmed: readonly VehicleFeature[] }): ApprovalItem['features'] {
  return v.features.map((feature) => ({ feature, confirmed: v.featuresConfirmed.includes(feature) }));
}

/** «مكيّفة، عوائل» */
const featureNames = (fs: readonly VehicleFeature[]) => fs.map((f) => t(`vehicle.feature.${f}`)).join('، ');
const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * The approvals queue (console spec, ops): driver documents, merchant deals, landmark photos,
 * merchant onboarding drafts and fleet vehicles in one list, oldest first, each with the photos under
 * review next to what to compare them with. Decisions go to the owning module's service (which keeps
 * its own state and events) and every one writes the console audit log. Nobody decides on his own
 * item: the owning services refuse it and the list marks it.
 */
@Injectable()
export class ApprovalsService {
  private readonly refCache = new Map<string, { at: number; refs: Array<{ ref: string; kind: string; recordId: string; at: string }> }>();

  constructor(
    private readonly accounts: DriverAccountService,
    private readonly promotions: PromotionsService,
    private readonly ops: OpsService,
    private readonly fleet: FleetService,
    private readonly identity: IdentityService,
    private readonly orgs: OrgsService,
    private readonly places: PlacesService,
    private readonly config: ConfigService,
    private readonly audits: AuditLogService,
    private readonly names: StaffNames,
    private readonly uow: UnitOfWork,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async kindsFor(personId: string): Promise<ApprovalKind[]> {
    const mine = new Set<RoleKind>();
    for (const r of ['admin', 'support', 'field_ops'] as const) if (await this.identity.hasRole(personId, r)) mine.add(r);
    return ApprovalKind.options.filter((k) => APPROVAL_KIND_ROLES[k].some((r) => mine.has(r)));
  }

  /** A person's vault photo refs (documents or selfies), read once per five minutes per reviewer (logged by identity). */
  private async refs(personId: string, field: 'documentRefs' | 'selfieRefs', reviewerId: string) {
    const key = `${personId}|${field}|${reviewerId}`;
    const now = this.clock.now().getTime();
    const hit = this.refCache.get(key);
    if (hit && now - hit.at < REF_TTL_MS) return hit.refs;
    const refs = await this.identity.vaultRefsFor(personId, field, reviewerId, 'document_review').catch(() => []);
    this.refCache.set(key, { at: now, refs });
    return refs;
  }

  private url(uploadId: string): string {
    return this.blobs.readUrl(uploadId);
  }

  private zoneName(cityId: string, zoneKey: string): string {
    return this.config.city(cityId)?.zones.find((z) => z.id === zoneKey)?.name_ar ?? zoneKey;
  }

  async list(actor: Actor, input: { cityId: string; kind?: ApprovalKind | undefined }): Promise<ApprovalsView> {
    const kinds = (await this.kindsFor(actor.personId)).filter((k) => !input.kind || k === input.kind);
    const items: ApprovalItem[] = [];
    if (kinds.includes('driver_document')) items.push(...(await this.documentItems(actor)));
    if (kinds.includes('merchant_deal')) items.push(...(await this.dealItems(actor, input.cityId)));
    if (kinds.includes('landmark_photo')) items.push(...(await this.photoItems(actor, input.cityId)));
    if (kinds.includes('merchant_onboarding')) items.push(...(await this.onboardingItems(actor, input.cityId)));
    if (kinds.includes('fleet_vehicle')) items.push(...(await this.vehicleItems(actor)));
    if (kinds.includes('vehicle_features')) items.push(...(await this.featureItems(actor)));
    items.sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime() || a.id.localeCompare(b.id));
    const names = await this.names.of(items.map((i) => i.submittedBy).filter((x): x is string => Boolean(x)), actor.personId, 'approvals_queue');
    for (const i of items) if (i.submittedBy && i.submittedByName === null) i.submittedByName = names[i.submittedBy] ?? null;
    const counts = Object.fromEntries(ApprovalKind.options.map((k) => [k, items.filter((i) => i.kind === k).length])) as ApprovalsView['counts'];
    return { at: this.clock.now(), items, counts };
  }

  private async documentItems(actor: Actor): Promise<ApprovalItem[]> {
    const out: ApprovalItem[] = [];
    for (const d of await this.accounts.pendingDocuments()) {
      const own = d.personId === actor.personId;
      const docRefs = own ? [] : await this.refs(d.personId, 'documentRefs', actor.personId);
      const photos: ApprovalPhoto[] = docRefs.filter((r) => r.recordId === d.id).map((r) => ({ url: this.url(r.ref), label_ar: DOCUMENT_KIND_AR[d.kind] }));
      // Compare with his approved ID / photo, then his latest check-in selfie.
      const current = own ? [] : await this.accounts.documentsFor(d.personId).then((v) => v.documents).catch(() => []);
      const approvedIds = new Set(current.filter((c) => c.status === 'approved' || c.status === 'expiring').map((c) => c.id));
      const compare: ApprovalPhoto[] = docRefs
        .filter((r) => r.recordId !== d.id && approvedIds.has(r.recordId) && ['national_id_front', 'photo', 'licence'].includes(r.kind))
        .map((r) => ({ url: this.url(r.ref), label_ar: `${DOCUMENT_KIND_AR[r.kind as keyof typeof DOCUMENT_KIND_AR] ?? r.kind} (موافق عليه)` }));
      if (!own) {
        const selfie = (await this.refs(d.personId, 'selfieRefs', actor.personId)).at(-1);
        if (selfie) compare.push({ url: this.url(selfie.ref), label_ar: 'سيلفي التحقق اليومي' });
      }
      // The main photo (Ali, 2026-10-06) is what customers see on his card: say so to the reviewer.
      const main = d.kind === 'photo';
      out.push({
        id: `driver_document:${d.id}`,
        kind: 'driver_document',
        kind_ar: APPROVAL_KIND_AR.driver_document,
        refId: d.id,
        title_ar: main ? MAIN_PHOTO_TITLE_AR : DOCUMENT_KIND_AR[d.kind],
        subtitle_ar: main ? MAIN_PHOTO_HINT_AR : d.expiresAt ? `ينتهي ${d.expiresAt.toISOString().slice(0, 10)}` : null,
        submittedAt: d.submittedAt,
        submittedBy: d.personId,
        submittedByName: null,
        ownItem: own,
        photos,
        compare,
        facts: [
          { label_ar: 'النوع', value: main ? MAIN_PHOTO_TITLE_AR : DOCUMENT_KIND_AR[d.kind] },
          ...(main ? [{ label_ar: 'يبين لـ', value: 'الزبائن، على بطاقة السايق' }, { label_ar: 'المطلوب', value: 'وجه واضح، بدون نظارة شمسية، نفس الشخص بالبطاقة' }] : []),
          ...(d.expiresAt ? [{ label_ar: 'تاريخ الانتهاء', value: d.expiresAt.toISOString().slice(0, 10) }] : []),
        ],
        takesExpiry: ['licence', 'vehicle_registration', 'insurance', 'national_id_front'].includes(d.kind),
        features: [],
      });
    }
    return out;
  }

  private async dealItems(actor: Actor, cityId: string): Promise<ApprovalItem[]> {
    const out: ApprovalItem[] = [];
    for (const d of (await this.promotions.pendingDeals()).filter((x) => x.cityId === cityId)) {
      const merchant = await this.orgs.get(d.merchantOrgId).then((o) => o.name).catch(() => d.merchantOrgId);
      const own = d.ownerId === actor.personId || (await this.identity.hasRole(actor.personId, 'merchant_owner', d.merchantOrgId)) || (await this.identity.hasRole(actor.personId, 'merchant_staff', d.merchantOrgId));
      const value = d.type === 'percent' ? `${d.value}%` : d.type === 'fixed' ? `${fmt(d.value)} دينار` : '';
      out.push({
        id: `merchant_deal:${d.id}`,
        kind: 'merchant_deal',
        kind_ar: APPROVAL_KIND_AR.merchant_deal,
        refId: d.id,
        title_ar: `${merchant}: ${d.nameAr}`,
        subtitle_ar: `${DEAL_TYPE_AR[d.type] ?? d.type}${value ? ` ${value}` : ''}`,
        submittedAt: d.createdAt,
        submittedBy: d.ownerId,
        submittedByName: null,
        ownItem: own,
        photos: [],
        compare: [],
        facts: [
          { label_ar: 'المطعم', value: merchant },
          { label_ar: 'النوع', value: `${DEAL_TYPE_AR[d.type] ?? d.type}${value ? ` ${value}` : ''}` },
          { label_ar: 'المدة', value: `${d.schedule.startsAt.toISOString().slice(0, 10)} ← ${d.schedule.endsAt.toISOString().slice(0, 10)}` },
          { label_ar: 'أقل طلب', value: `${fmt(d.minOrderIqd)} دينار` },
          { label_ar: 'الكلفة المتوقعة', value: `${fmt(d.projection.weeklyCostIqd)} دينار بالأسبوع (${fmt(d.projection.totalCostIqd)} كلها)` },
          { label_ar: 'سقف الميزانية', value: d.budgetCapIqd ? `${fmt(d.budgetCapIqd)} دينار` : 'بدون سقف' },
          { label_ar: 'الأكلات', value: d.itemIds.length > 0 ? `${d.itemIds.length} أكلة` : 'كل المنيو' },
        ],
        takesExpiry: false,
        features: [],
      });
    }
    return out;
  }

  private async photoItems(actor: Actor, cityId: string): Promise<ApprovalItem[]> {
    const out: ApprovalItem[] = [];
    for (const p of await this.ops.pendingLandmarkPhotos()) {
      const isNew = p.targetId.startsWith('new:');
      const place = isNew ? null : await this.places.get(p.targetId).catch(() => undefined);
      const zone = isNew ? this.zoneName(cityId, p.targetId.slice(4)) : null;
      const title = isNew ? `معلم جديد: ${p.localNames[0] ?? 'بدون اسم'}` : (place?.name ?? p.localNames[0] ?? p.targetId);
      const compare = isNew ? [] : (await this.ops.approvedPhotosOf(p.targetId)).map((a) => ({ url: this.url(a.uploadId), label_ar: 'صورة موافق عليها' }));
      out.push({
        id: `landmark_photo:${p.id}`,
        kind: 'landmark_photo',
        kind_ar: APPROVAL_KIND_AR.landmark_photo,
        refId: p.id,
        title_ar: title,
        subtitle_ar: zone ? `منطقة ${zone}` : (p.caption ?? null),
        submittedAt: p.createdAt,
        submittedBy: p.addedById,
        submittedByName: null,
        ownItem: p.addedById === actor.personId,
        photos: [{ url: this.url(p.uploadId), label_ar: p.caption ?? 'الصورة الجديدة' }],
        compare,
        facts: [
          ...(p.localNames.length > 0 ? [{ label_ar: 'الأسماء المحلية', value: p.localNames.join('، ') }] : []),
          { label_ar: 'الهدف', value: isNew ? 'معلم جديد' : p.targetKind === 'meeting_point' ? 'نقطة تجمّع' : 'مكان' },
        ],
        takesExpiry: false,
        features: [],
      });
    }
    return out;
  }

  private async onboardingItems(actor: Actor, cityId: string): Promise<ApprovalItem[]> {
    const out: ApprovalItem[] = [];
    for (const o of (await this.ops.pendingOnboardings()).filter((x) => x.cityId === cityId)) {
      const photos: ApprovalPhoto[] = [
        ...(o.shopPhotoRef ? [{ url: this.url(o.shopPhotoRef), label_ar: 'واجهة المحل' }] : []),
        ...o.menuPhotoRefs.map((r, i) => ({ url: this.url(r), label_ar: `المنيو ${i + 1}` })),
      ];
      out.push({
        id: `merchant_onboarding:${o.id}`,
        kind: 'merchant_onboarding',
        kind_ar: APPROVAL_KIND_AR.merchant_onboarding,
        refId: o.id,
        title_ar: o.name,
        subtitle_ar: `${o.type === 'grocer' ? 'محل' : 'مطعم'} · ${this.zoneName(o.cityId, o.location.zoneKey)}`,
        submittedAt: o.createdAt,
        submittedBy: o.createdById,
        submittedByName: null,
        ownItem: o.createdById === actor.personId || o.contactPersonId === actor.personId,
        photos: photos.slice(0, 1),
        compare: photos.slice(1),
        facts: [
          { label_ar: 'النوع', value: o.type === 'grocer' ? 'محل' : 'مطعم' },
          { label_ar: 'المنطقة', value: this.zoneName(o.cityId, o.location.zoneKey) },
          { label_ar: 'صور المنيو', value: String(o.menuPhotoRefs.length) },
          ...(o.notes ? [{ label_ar: 'ملاحظات', value: o.notes }] : []),
        ],
        takesExpiry: false,
        features: [],
      });
    }
    return out;
  }

  private async vehicleItems(actor: Actor): Promise<ApprovalItem[]> {
    const out: ApprovalItem[] = [];
    for (const v of await this.fleet.vehiclesInReview()) {
      const fleetName = v.ownerOrgId ? await this.orgs.get(v.ownerOrgId).then((o) => o.name).catch(() => v.ownerOrgId) : null;
      const own = v.ownerOrgId ? await this.identity.hasRole(actor.personId, 'fleet_owner', v.ownerOrgId) : false;
      out.push({
        id: `fleet_vehicle:${v.id}`,
        kind: 'fleet_vehicle',
        kind_ar: APPROVAL_KIND_AR.fleet_vehicle,
        refId: v.id,
        title_ar: `${VEHICLE_AR[v.vehicleClass] ?? v.vehicleClass} · ${v.plate}`,
        subtitle_ar: fleetName ? `أسطول ${fleetName}` : null,
        submittedAt: v.createdAt ?? this.clock.now(),
        submittedBy: null,
        submittedByName: fleetName,
        ownItem: own,
        photos: [],
        compare: [],
        facts: [
          { label_ar: 'اللوحة', value: v.plate },
          { label_ar: 'النوع', value: VEHICLE_AR[v.vehicleClass] ?? v.vehicleClass },
          ...carFacts(v),
          { label_ar: 'المقاعد', value: String(v.seats) },
          { label_ar: 'السايق الحالي', value: v.activeDriverId ? 'معيّن' : 'بدون سايق' },
        ],
        takesExpiry: false,
        features: featureChecks(v),
      });
    }
    return out;
  }

  /** Verified cars whose driver claimed features the car check has not confirmed yet (n1, n2). */
  private async featureItems(actor: Actor): Promise<ApprovalItem[]> {
    const out: ApprovalItem[] = [];
    for (const v of await this.fleet.vehiclesWithUnconfirmedFeatures()) {
      const own = v.activeDriverId === actor.personId || (v.ownerOrgId ? await this.identity.hasRole(actor.personId, 'fleet_owner', v.ownerOrgId) : false);
      const waiting = v.features.filter((f) => !v.featuresConfirmed.includes(f));
      out.push({
        id: `vehicle_features:${v.id}`,
        kind: 'vehicle_features',
        kind_ar: APPROVAL_KIND_AR.vehicle_features,
        refId: v.id,
        title_ar: `${v.model ?? VEHICLE_AR[v.vehicleClass] ?? v.vehicleClass} · ${v.plate}`,
        subtitle_ar: featureNames(waiting),
        submittedAt: v.updatedAt ?? v.createdAt ?? this.clock.now(),
        submittedBy: v.activeDriverId,
        submittedByName: null,
        ownItem: own,
        photos: [],
        compare: [],
        facts: [
          { label_ar: 'اللوحة', value: v.plate },
          { label_ar: 'النوع', value: VEHICLE_AR[v.vehicleClass] ?? v.vehicleClass },
          ...carFacts(v),
        ],
        takesExpiry: false,
        features: featureChecks(v),
      });
    }
    return out;
  }

  async decide(actor: Actor, input: DecideApprovalInput): Promise<DecideApprovalOutput> {
    const allowed = await this.kindsFor(actor.personId);
    if (!allowed.includes(input.kind)) throw new DriverError('forbidden');
    const approve = input.decision === 'approve';
    const reason = input.reason?.trim() || undefined;
    let summary: string;
    let cityId: string | null = null;
    switch (input.kind) {
      case 'driver_document': {
        const doc = await this.accounts.document(input.refId);
        if (!doc) throw new DriverError('approval_not_found');
        if (doc.personId === actor.personId) throw new DriverError('approval_own_item');
        if (doc.status !== 'pending' || doc.supersededAt) throw new DriverError('approval_state_conflict');
        await this.accounts.reviewDocument(actor, { documentId: doc.id, decision: input.decision, ...(reason ? { reason } : {}), ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) });
        summary = `${approve ? 'وافق على' : 'رفض'} ${DOCUMENT_KIND_AR[doc.kind]}`;
        break;
      }
      case 'merchant_deal': {
        const deal = await this.promotions.get(input.refId).catch(() => null);
        if (!deal) throw new DriverError('approval_not_found');
        if (deal.ownerId === actor.personId || (await this.identity.hasRole(actor.personId, 'merchant_owner', deal.merchantOrgId)) || (await this.identity.hasRole(actor.personId, 'merchant_staff', deal.merchantOrgId))) {
          throw new DriverError('approval_own_item');
        }
        if (deal.proposalState !== 'pending_approval') throw new DriverError('approval_state_conflict');
        await this.promotions.review(deal.id, approve, actor.personId, reason);
        cityId = deal.cityId;
        summary = `${approve ? 'وافق على' : 'رفض'} عرض ${deal.nameAr}`;
        break;
      }
      case 'landmark_photo': {
        const p = await this.ops.reviewLandmarkPhoto(actor, { photoId: input.refId, approve, reason });
        summary = `${approve ? 'وافق على' : 'رفض'} صورة معلم ${p.localNames[0] ?? ''}`.trim();
        break;
      }
      case 'merchant_onboarding': {
        const o = await this.ops.reviewOnboarding(actor, { onboardingId: input.refId, approve, reason });
        cityId = o.cityId;
        summary = approve ? `فعّل ${o.name}` : `رفض تسجيل ${o.name}`;
        break;
      }
      case 'fleet_vehicle': {
        const v = await this.fleet.reviewVehicle(actor, { vehicleId: input.refId, approve, reason, confirmFeatures: input.confirmFeatures });
        summary = `${approve ? 'ثبّت' : 'رفض'} المركبة ${v.plate}${approve && v.featuresConfirmed.length > 0 ? ` (${featureNames(v.featuresConfirmed)})` : ''}`;
        break;
      }
      case 'vehicle_features': {
        const v = await this.fleet.reviewFeatures(actor, { vehicleId: input.refId, approve, reason, confirmFeatures: input.confirmFeatures });
        summary = approve ? `أكّد مميزات ${v.plate}: ${v.featuresConfirmed.length > 0 ? featureNames(v.featuresConfirmed) : 'ولا وحدة'}` : `رفض مميزات ${v.plate}`;
        break;
      }
    }
    const decidedAt = this.clock.now();
    await this.uow.run((tx) =>
      this.audits.record(
        {
          cityId,
          actorId: actor.personId,
          action: `approval.${input.decision}`,
          subjectKind: 'approval',
          subjectId: `${input.kind}:${input.refId}`,
          summaryAr: reason ? `${summary}: ${reason}` : summary,
          detail: { kind: input.kind, refId: input.refId, decision: input.decision, reason: reason ?? null, expiresAt: input.expiresAt?.toISOString() ?? null },
        },
        tx,
      ),
    );
    return { id: `${input.kind}:${input.refId}`, kind: input.kind, refId: input.refId, decision: input.decision, decidedAt };
  }
}
