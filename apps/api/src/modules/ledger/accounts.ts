/**
 * Typed account ids (contracts `AccountId`). Sign convention (claims view): positive = owed to the
 * holder / earned by it; negative = the holder owes. A courier holding collected cash has a negative
 * `cash:` balance; the company's real money (`bank`) is negative while it holds cash.
 */
export const Accounts = {
  platform: 'platform' as const,
  /** Earnings the platform owes a driver (fares, delivery fees, tips, incentives). */
  driver: (id: string) => `driver:${id}` as const,
  /** Cash a driver collected and has not yet handed to a merchant or the company (negative = holds it). */
  cash: (driverId: string) => `cash:${driverId}` as const,
  /** M1 merchant account; kept for old rows. New postings use `merchantCash`. */
  merchant: (id: string) => `merchant:${id}` as const,
  /** Merchant cash account (decisions §3): payable net of commission, settled by mode. */
  merchantCash: (id: string) => `merchant_cash:${id}` as const,
  customer: (id: string) => `customer:${id}` as const,
  household: (orgId: string) => `household:${orgId}` as const,
  promo: (promotionId: string) => `promo:${promotionId}` as const,
  /** The company's real-money channels (ZainCash wallet, ops till, bank). */
  bank: 'bank' as const,
  /** G-88 customer-total rounding residue. */
  rounding: 'rounding' as const,
  // points book — never mixed with money
  points: (personId: string) => `points:${personId}` as const,
  pointsPending: (phoneHash: string) => `points_pending:${phoneHash}` as const,
  pointsPool: 'points_pool' as const,
};

/** `driver:abc` → `abc`; undefined when the account is not of that prefix. */
export function idOf(account: string, prefix: string): string | undefined {
  return account.startsWith(`${prefix}:`) ? account.slice(prefix.length + 1) : undefined;
}
