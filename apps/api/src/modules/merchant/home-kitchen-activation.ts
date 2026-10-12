import { Inject, Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AuditLogService } from '../controls/index.js';
import { EventsService } from '../events/index.js';
import { MERCHANT_SETUP_CATALOG, type SetupCatalogPort } from './setup.service.js';
import { MERCHANT_STORES, type MerchantStoresPort } from './merchant.service.js';

/**
 * أكل بيت: staff approved a cook's kitchen (`merchant.activated`, its `type` from the stored
 * onboarding row). Her storefront is made a home kitchen, her commission tier is `home` (Ali's 10%,
 * 2026-10-11), and «جهّز محلك» is not for her (she adds dishes in «أكلاتي»). Keyed on the org: a
 * second delivery changes nothing. Customers still see nothing until `homeKitchens.launched` is on.
 */
/** Who approved her, for the tier's audit row (any change of a store's rate is one). */
export interface ActivationAudit {
  audits: Pick<AuditLogService, 'record'>;
  actorId: string;
}

export async function activateHomeKitchen(stores: MerchantStoresPort, catalog: Pick<SetupCatalogPort, 'storefront' | 'saveStorefront'>, orgId: string, audit?: ActivationAudit): Promise<'made' | 'already'> {
  const org = await stores.get(orgId);
  const front = await catalog.storefront(orgId);
  const s = await stores.merchantSettings(orgId);
  let changed = false;
  if (!front?.home) {
    // No monogram of her own yet: the badge falls back to her kitchen name's letter (kitchenMonogram).
    const home = { monogram: null };
    await catalog.saveStorefront(front ? { ...front, home } : { orgId, cityId: org.cityId, nameAr: org.name, cuisineAr: 'أكل بيت', tags: [], photoUrl: null, minOrderIqd: 0, hours: [], home });
    changed = true;
  }
  const patch: Parameters<MerchantStoresPort['setMerchantSettings']>[1] = {};
  if (s.commissionTier !== 'home') patch.commissionTier = 'home';
  // An owner who opened the app before this ran got «جهّز محلك» started: undo it (and its closed shutter).
  if (s.setup && !s.setup.liveAt) Object.assign(patch, { setup: null }, s.setup.closedBySetup ? { closed: null } : {});
  if (Object.keys(patch).length > 0) {
    await stores.setMerchantSettings(orgId, patch);
    if (patch.commissionTier && audit) {
      await audit.audits.record({
        cityId: org.cityId,
        actorId: audit.actorId,
        action: 'store.commission_tier_set',
        subjectKind: 'store',
        subjectId: orgId,
        summaryAr: `${org.name} صار مطبخ بيت بعمولة أكل بيت`,
        detail: { from: s.commissionTier, to: 'home' },
      });
    }
    changed = true;
  }
  return changed ? 'made' : 'already';
}

@Injectable()
export class HomeKitchenActivation implements OnModuleInit, OnModuleDestroy {
  private unsubscribe?: () => void;

  constructor(
    private readonly events: EventsService,
    @Inject(MERCHANT_STORES) private readonly stores: MerchantStoresPort,
    @Inject(MERCHANT_SETUP_CATALOG) private readonly catalog: SetupCatalogPort,
    @Optional() private readonly audits?: AuditLogService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe('merchant:home-kitchen-activation', ['merchant.activated'], async (e) => {
      const p = e.payload as { merchantOrgId?: unknown; type?: unknown };
      if (p.type !== 'home_kitchen' || typeof p.merchantOrgId !== 'string') return;
      await activateHomeKitchen(this.stores, this.catalog, p.merchantOrgId, this.audits ? { audits: this.audits, actorId: e.actorId } : undefined);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
