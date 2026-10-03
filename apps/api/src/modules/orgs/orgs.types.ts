import type { CommissionTier, DeliveryPoint } from '@driver/contracts';

export type OrgType = 'restaurant' | 'grocer' | 'fleet' | 'household';
export type OrgMemberRole = 'payer' | 'orderer' | 'member';

export interface OrgMember {
  personId: string;
  role: OrgMemberRole;
  /** Household: orders above this ask the payer for one-tap approval. Null = no limit. */
  spendingLimitIqd: number | null;
}

export interface Org {
  id: string;
  type: OrgType;
  name: string;
  cityId: string;
  /** In join order: the creator (owner / first payer) first. */
  members: OrgMember[];
  /** Restaurants and grocers: order-taking settings (columns on `orgs`). */
  merchant?: MerchantSettings;
}

/** Local-time weekly window, e.g. Friday prayer `{dow: 5, start: '11:45', end: '13:15'}`. */
export interface MerchantPauseWindow {
  dow: number;
  start: string;
  end: string;
  reason?: string;
}

export interface MerchantSettings {
  /** Earned by behaviour (domain §2): skips the 90-s acceptance. */
  autoAccept: boolean;
  /** Null = the city's seeded defaults (Friday prayer). */
  pauseWindows: MerchantPauseWindow[] | null;
  /** Last merchant-app heartbeat (edge-case review A.2). */
  lastHeartbeatAt: Date | null;
  defaultPrepMin: number | null;
  /** Money §1 commission tier; null = the orders default. */
  commissionTier: CommissionTier | null;
  /** Pickup point couriers are sent to (zone key + pin); null until the merchant's place is on file. */
  location: DeliveryPoint | null;
  /** Busy mode (Driver Merchant): prep times +10 min until this time; null = off. */
  busyUntil?: Date | null;
  /** Closed by hand from the Merchant app (early-close reason); null = open. */
  closed?: { reason: string; note: string | null; at: Date } | null;
  /** The store's receipt printer as its tablet last reported it (printer-offline marker). */
  printer?: { state: 'connected' | 'disconnected'; name: string | null; at: Date } | null;
}

export const DEFAULT_MERCHANT_SETTINGS: MerchantSettings = {
  autoAccept: false,
  pauseWindows: null,
  lastHeartbeatAt: null,
  defaultPrepMin: null,
  commissionTier: null,
  location: null,
  busyUntil: null,
  closed: null,
  printer: null,
};

/** A restaurant or grocer as the Console's merchant picker lists it. */
export interface MerchantOrg {
  id: string;
  name: string;
  type: 'restaurant' | 'grocer';
  cityId: string;
  lastHeartbeatAt: Date | null;
}

export interface PayerApprovalRequest {
  id: string;
  orgId: string;
  orderId: string;
  requestedBy: string;
  payerId: string;
  amountIqd: number;
  state: 'pending' | 'approved' | 'declined';
  createdAt: Date;
}

export const isMerchantType = (t: OrgType): t is 'restaurant' | 'grocer' => t === 'restaurant' || t === 'grocer';
