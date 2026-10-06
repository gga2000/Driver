import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** Who invited whom (joy g2): one row per friend. */
export interface ReferralRecord {
  refereeId: string;
  referrerId: string;
  code: string;
  claimedAt: Date;
}

/**
 * `invite_codes` and `referrals` (public schema; ids and codes only). Writes that lose a race return
 * false instead of throwing, so the service can read what won.
 */
export interface ReferralsRepository {
  codeOf(personId: string): Promise<string | null>;
  ownerOf(code: string): Promise<string | null>;
  /** False when the person already has a code or the code is taken. */
  saveCode(personId: string, code: string, now: Date): Promise<boolean>;
  referralOf(refereeId: string): Promise<ReferralRecord | null>;
  /** False when the friend already accepted an invitation. */
  saveReferral(r: ReferralRecord): Promise<boolean>;
  countInvited(referrerId: string): Promise<number>;
}

export const REFERRALS_REPOSITORY = Symbol('REFERRALS_REPOSITORY');

export class InMemoryReferralsRepository implements ReferralsRepository {
  private readonly codes = new Map<string, string>();
  private readonly owners = new Map<string, string>();
  private readonly referrals = new Map<string, ReferralRecord>();

  async codeOf(personId: string): Promise<string | null> {
    return this.codes.get(personId) ?? null;
  }
  async ownerOf(code: string): Promise<string | null> {
    return this.owners.get(code) ?? null;
  }
  async saveCode(personId: string, code: string): Promise<boolean> {
    if (this.codes.has(personId) || this.owners.has(code)) return false;
    this.codes.set(personId, code);
    this.owners.set(code, personId);
    return true;
  }
  async referralOf(refereeId: string): Promise<ReferralRecord | null> {
    const r = this.referrals.get(refereeId);
    return r ? { ...r } : null;
  }
  async saveReferral(r: ReferralRecord): Promise<boolean> {
    if (this.referrals.has(r.refereeId)) return false;
    this.referrals.set(r.refereeId, { ...r });
    return true;
  }
  async countInvited(referrerId: string): Promise<number> {
    return [...this.referrals.values()].filter((r) => r.referrerId === referrerId).length;
  }
}

/** Prisma's unique-constraint failure (P2002). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

export class PrismaReferralsRepository implements ReferralsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Tx {
    return this.prisma.prisma as unknown as Tx;
  }

  async codeOf(personId: string): Promise<string | null> {
    return (await this.db.inviteCode.findUnique({ where: { personId } }))?.code ?? null;
  }
  async ownerOf(code: string): Promise<string | null> {
    return (await this.db.inviteCode.findUnique({ where: { code } }))?.personId ?? null;
  }
  async saveCode(personId: string, code: string, now: Date): Promise<boolean> {
    try {
      await this.db.inviteCode.create({ data: { personId, code, createdAt: now } });
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }
  async referralOf(refereeId: string): Promise<ReferralRecord | null> {
    const r = await this.db.referral.findUnique({ where: { refereeId } });
    return r ? { refereeId: r.refereeId, referrerId: r.referrerId, code: r.code, claimedAt: r.claimedAt } : null;
  }
  async saveReferral(r: ReferralRecord): Promise<boolean> {
    try {
      await this.db.referral.create({ data: { refereeId: r.refereeId, referrerId: r.referrerId, code: r.code, claimedAt: r.claimedAt } });
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }
  async countInvited(referrerId: string): Promise<number> {
    return this.db.referral.count({ where: { referrerId } });
  }
}
