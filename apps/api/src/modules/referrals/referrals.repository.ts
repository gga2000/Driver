import type { ReferralBlockReason } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** Who invited whom (joy g2): one row per friend, with the fingerprint marks and any block. */
export interface ReferralRecord {
  refereeId: string;
  referrerId: string;
  code: string;
  claimedAt: Date;
  /** One-way marks (`p:`/`d:`/`h:`) of the friend and of the inviter (decisions §1). */
  refereeMarks: string[];
  referrerMarks: string[];
  blockedReason: ReferralBlockReason | null;
  blockedAt: Date | null;
}

export type NewReferral = Pick<ReferralRecord, 'refereeId' | 'referrerId' | 'code' | 'claimedAt'>;

/**
 * `invite_codes` and `referrals` (public schema; ids, codes and one-way marks only). Writes that lose
 * a race return false instead of throwing, so the service can read what won.
 */
export interface ReferralsRepository {
  codeOf(personId: string): Promise<string | null>;
  ownerOf(code: string): Promise<string | null>;
  /** False when the person already has a code or the code is taken. */
  saveCode(personId: string, code: string, now: Date): Promise<boolean>;
  referralOf(refereeId: string): Promise<ReferralRecord | null>;
  /** False when the friend already accepted an invitation. */
  saveReferral(r: NewReferral): Promise<boolean>;
  /** Fresh marks, and a block the first time one is found (a block is never cleared). */
  updateFingerprint(refereeId: string, patch: { refereeMarks: string[]; referrerMarks: string[]; block: { reason: ReferralBlockReason; at: Date } | null }): Promise<ReferralRecord>;
  /** Other friends' rows that share any of these marks, on either side. */
  sharingAny(marks: readonly string[], exceptRefereeId: string): Promise<ReferralRecord[]>;
  /** An inviter's friends, newest first. */
  byReferrer(referrerId: string): Promise<ReferralRecord[]>;
  countInvited(referrerId: string): Promise<number>;
  /** W7 account deletion: his invite code (the referrals made with it stay: they carry only hashes). Idempotent. */
  eraseCode(personId: string): Promise<void>;
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
    return r ? copy(r) : null;
  }
  async saveReferral(r: NewReferral): Promise<boolean> {
    if (this.referrals.has(r.refereeId)) return false;
    this.referrals.set(r.refereeId, { ...r, refereeMarks: [], referrerMarks: [], blockedReason: null, blockedAt: null });
    return true;
  }
  async updateFingerprint(refereeId: string, patch: { refereeMarks: string[]; referrerMarks: string[]; block: { reason: ReferralBlockReason; at: Date } | null }): Promise<ReferralRecord> {
    const r = this.referrals.get(refereeId);
    if (!r) throw new Error(`no referral for ${refereeId}`);
    r.refereeMarks = [...patch.refereeMarks];
    r.referrerMarks = [...patch.referrerMarks];
    if (patch.block && !r.blockedReason) {
      r.blockedReason = patch.block.reason;
      r.blockedAt = patch.block.at;
    }
    return copy(r);
  }
  async sharingAny(marks: readonly string[], exceptRefereeId: string): Promise<ReferralRecord[]> {
    const set = new Set(marks);
    return [...this.referrals.values()].filter((r) => r.refereeId !== exceptRefereeId && [...r.refereeMarks, ...r.referrerMarks].some((m) => set.has(m))).map(copy);
  }
  async byReferrer(referrerId: string): Promise<ReferralRecord[]> {
    return [...this.referrals.values()]
      .filter((r) => r.referrerId === referrerId)
      .sort((a, b) => b.claimedAt.getTime() - a.claimedAt.getTime())
      .map(copy);
  }
  async countInvited(referrerId: string): Promise<number> {
    return [...this.referrals.values()].filter((r) => r.referrerId === referrerId).length;
  }
  async eraseCode(personId: string): Promise<void> {
    const code = this.codes.get(personId);
    this.codes.delete(personId);
    if (code !== undefined) this.owners.delete(code);
  }
}

function copy(r: ReferralRecord): ReferralRecord {
  return { ...r, refereeMarks: [...r.refereeMarks], referrerMarks: [...r.referrerMarks] };
}

/** Prisma's unique-constraint failure (P2002). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

type ReferralRow = { refereeId: string; referrerId: string; code: string; claimedAt: Date; refereeMarks: string[]; referrerMarks: string[]; blockedReason: string | null; blockedAt: Date | null };
const recordOf = (r: ReferralRow): ReferralRecord => ({
  refereeId: r.refereeId,
  referrerId: r.referrerId,
  code: r.code,
  claimedAt: r.claimedAt,
  refereeMarks: r.refereeMarks,
  referrerMarks: r.referrerMarks,
  blockedReason: r.blockedReason as ReferralBlockReason | null,
  blockedAt: r.blockedAt,
});

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
    return r ? recordOf(r) : null;
  }
  async saveReferral(r: NewReferral): Promise<boolean> {
    try {
      await this.db.referral.create({ data: { refereeId: r.refereeId, referrerId: r.referrerId, code: r.code, claimedAt: r.claimedAt } });
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }
  async updateFingerprint(refereeId: string, patch: { refereeMarks: string[]; referrerMarks: string[]; block: { reason: ReferralBlockReason; at: Date } | null }): Promise<ReferralRecord> {
    await this.db.referral.update({ where: { refereeId }, data: { refereeMarks: patch.refereeMarks, referrerMarks: patch.referrerMarks } });
    // The first block wins and stays: only a row without a reason takes one.
    if (patch.block) await this.db.referral.updateMany({ where: { refereeId, blockedReason: null }, data: { blockedReason: patch.block.reason, blockedAt: patch.block.at } });
    return recordOf((await this.db.referral.findUnique({ where: { refereeId } }))!);
  }
  async sharingAny(marks: readonly string[], exceptRefereeId: string): Promise<ReferralRecord[]> {
    if (marks.length === 0) return [];
    const list = [...marks];
    const rows = await this.db.referral.findMany({ where: { refereeId: { not: exceptRefereeId }, OR: [{ refereeMarks: { hasSome: list } }, { referrerMarks: { hasSome: list } }] } });
    return rows.map(recordOf);
  }
  async byReferrer(referrerId: string): Promise<ReferralRecord[]> {
    return (await this.db.referral.findMany({ where: { referrerId }, orderBy: { claimedAt: 'desc' } })).map(recordOf);
  }
  async countInvited(referrerId: string): Promise<number> {
    return this.db.referral.count({ where: { referrerId } });
  }
  async eraseCode(personId: string): Promise<void> {
    await this.db.inviteCode.deleteMany({ where: { personId } });
  }
}
