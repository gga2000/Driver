import type { OrgsService } from '../orgs/index.js';
import { CITY_PAUSE_WINDOWS, ORDERS_RULES } from './orders.config.js';
import type { PauseWindow } from './pause.js';

/**
 * What the orders module needs to know about a merchant, read through the orgs module's public
 * service (never its tables): auto-accept, pause windows, app presence, prep time and commission.
 */
export interface MerchantProfile {
  orgId: string;
  cityId: string;
  autoAccept: boolean;
  /** Effective windows: the merchant's own, or the city's seeded defaults. */
  pauseWindows: PauseWindow[];
  lastHeartbeatAt: Date | null;
  defaultPrepMin: number;
  commissionPct: number;
}

export interface MerchantDirectory {
  profile(orgId: string): Promise<MerchantProfile | null>;
  heartbeat(orgId: string, at: Date): Promise<void>;
}

export const MERCHANT_DIRECTORY = Symbol('MERCHANT_DIRECTORY');

/** Production binding over `OrgsService`. */
export class OrgsMerchantDirectory implements MerchantDirectory {
  constructor(private readonly orgs: Pick<OrgsService, 'get' | 'merchantSettings' | 'heartbeat'>) {}

  async profile(orgId: string): Promise<MerchantProfile | null> {
    let org;
    try {
      org = this.orgs.get(orgId);
    } catch {
      return null;
    }
    if (org.type !== 'restaurant' && org.type !== 'grocer') return null;
    const s = this.orgs.merchantSettings(orgId);
    return {
      orgId,
      cityId: org.cityId,
      autoAccept: s.autoAccept,
      pauseWindows: s.pauseWindows ?? [...(CITY_PAUSE_WINDOWS[org.cityId] ?? [])],
      lastHeartbeatAt: s.lastHeartbeatAt,
      defaultPrepMin: s.defaultPrepMin ?? ORDERS_RULES.defaultPrepMin,
      commissionPct: s.commissionPct ?? ORDERS_RULES.defaultCommissionPct,
    };
  }

  async heartbeat(orgId: string, at: Date): Promise<void> {
    this.orgs.heartbeat(orgId, at);
  }
}

/** Test and simulator double. */
export class InMemoryMerchantDirectory implements MerchantDirectory {
  readonly merchants = new Map<string, MerchantProfile>();

  add(orgId: string, patch: Partial<Omit<MerchantProfile, 'orgId'>> = {}): MerchantProfile {
    const cityId = patch.cityId ?? 'aziziyah';
    const p: MerchantProfile = {
      orgId,
      cityId,
      autoAccept: false,
      pauseWindows: [...(CITY_PAUSE_WINDOWS[cityId] ?? [])],
      lastHeartbeatAt: null,
      defaultPrepMin: ORDERS_RULES.defaultPrepMin,
      commissionPct: ORDERS_RULES.defaultCommissionPct,
      ...patch,
    };
    this.merchants.set(orgId, p);
    return p;
  }

  async profile(orgId: string): Promise<MerchantProfile | null> {
    const p = this.merchants.get(orgId);
    return p ? { ...p, pauseWindows: [...p.pauseWindows] } : null;
  }

  async heartbeat(orgId: string, at: Date): Promise<void> {
    const p = this.merchants.get(orgId);
    if (p) p.lastHeartbeatAt = at;
  }
}
