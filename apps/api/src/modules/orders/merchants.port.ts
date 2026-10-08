import { holidayOn, localClock, type CommissionTier, type DeliveryPoint } from '@driver/contracts';
import { closedNow, type OrgsService } from '../orgs/index.js';
import { CITY_PAUSE_WINDOWS, DEFAULT_TIMEZONE, ORDERS_RULES } from './orders.config.js';
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
  /** Money §1 tier; the rate comes from the money rules so orders and the ledger agree. */
  commissionTier: CommissionTier;
  /** Where couriers pick up (zone key + pin); null until the merchant's place is on file. */
  location: DeliveryPoint | null;
  /** Busy mode until this time (+10 min on every prep time); null/absent = off. */
  busyUntil?: Date | null;
  /** Closed by hand from the Merchant app: `orders.place` refuses like a pause window. */
  closed?: boolean;
  /** A quick pause from «المحل» reopens by itself at this time (counter step 5, h2); absent otherwise. */
  reopensAt?: Date;
  /** Today is one of the store's holiday closures (Merchant app hours); `closed` is also true then. */
  holiday?: boolean;
}

export interface MerchantDirectory {
  profile(orgId: string): Promise<MerchantProfile | null>;
  heartbeat(orgId: string, at: Date): Promise<void>;
}

export const MERCHANT_DIRECTORY = Symbol('MERCHANT_DIRECTORY');

/** Production binding over `OrgsService`. */
export class OrgsMerchantDirectory implements MerchantDirectory {
  constructor(
    private readonly orgs: Pick<OrgsService, 'find' | 'heartbeat'>,
    /** The clock a holiday closure (local date) and a quick pause's reopening are judged by. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  async profile(orgId: string): Promise<MerchantProfile | null> {
    const org = await this.orgs.find(orgId);
    if (!org || (org.type !== 'restaurant' && org.type !== 'grocer')) return null;
    const s = org.merchant ?? { autoAccept: false, pauseWindows: null, lastHeartbeatAt: null, defaultPrepMin: null, commissionTier: null, location: null };
    const holiday = s.holidays ? holidayOn(s.holidays, localClock(this.now(), DEFAULT_TIMEZONE).date) !== null : false;
    const closed = closedNow(s.closed, this.now());
    return {
      orgId,
      cityId: org.cityId,
      autoAccept: s.autoAccept,
      pauseWindows: s.pauseWindows ?? [...(CITY_PAUSE_WINDOWS[org.cityId] ?? [])],
      lastHeartbeatAt: s.lastHeartbeatAt,
      defaultPrepMin: s.defaultPrepMin ?? ORDERS_RULES.defaultPrepMin,
      commissionTier: s.commissionTier ?? ORDERS_RULES.defaultCommissionTier,
      location: s.location ?? null,
      busyUntil: s.busyUntil ?? null,
      closed: closed !== null || holiday,
      ...(closed?.until ? { reopensAt: closed.until } : {}),
      ...(holiday ? { holiday } : {}),
    };
  }

  async heartbeat(orgId: string, at: Date): Promise<void> {
    await this.orgs.heartbeat(orgId, at);
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
      commissionTier: ORDERS_RULES.defaultCommissionTier,
      location: null,
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
