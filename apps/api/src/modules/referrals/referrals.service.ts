import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DriverError,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  INVITE_PREVIEW_RATE,
  invitePath,
  normalizeInviteCode,
  type Actor,
  type ClaimInviteInput,
  type ClaimInviteOutput,
  type InvitePreview,
  type InvitePreviewInput,
  type InviteFriend,
  type InviteRule,
  type InviteView,
  type MoneyRules,
  type ReferralsPort,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { InMemoryWindowCounter, WINDOW_COUNTER, type WindowCounter } from '../../shared/window-counter.js';
import { blockReason, marksOf, type FingerprintParts } from './fingerprint.js';
import { REFERRALS_REPOSITORY, type ReferralRecord, type ReferralsRepository } from './referrals.repository.js';

/** First names from the vault (identity's logged read; the inviter's own invitation is not logged). */
export interface ReferralNamesPort {
  firstNamesFor(personIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string | null>>;
}

/** The inviter's points lines (the ledger): his side of a referral is a `referral_bonus` memo'd `referrer_of:`. */
export interface ReferralLedgerPort {
  eventsFor(accountId: string): Promise<ReadonlyArray<{ type: string; toAccount: string; memo?: string | null }>>;
  /** Whether a posting group exists: `referral:<friend>` = that referral already paid. */
  hasGroup(groupId: string): Promise<boolean>;
}

/**
 * The fingerprint parts of a person (decisions §1), one-way values only: identity's peppered phone hash
 * and device marks, and peppered marks of the map cells of his saved home(s) (places).
 */
export interface ReferralFingerprintPort {
  partsOf(personId: string): Promise<FingerprintParts>;
}

/** Bound by the orders module (no import cycle): how many orders a person has placed. */
export interface ReferralOrdersPort {
  placedCount(personId: string): Promise<number>;
}

/** Random integers in [0, n) for invite codes; tests pass a seeded one. */
export type RandomInt = (n: number) => number;

export const REFERRAL_NAMES = Symbol('REFERRAL_NAMES');
export const REFERRAL_LEDGER = Symbol('REFERRAL_LEDGER');
export const REFERRAL_RULES = Symbol('REFERRAL_RULES');
export const REFERRAL_RANDOM = Symbol('REFERRAL_RANDOM');
export const REFERRAL_FINGERPRINT = Symbol('REFERRAL_FINGERPRINT');

/** Attempts at a fresh code before giving up (31^6 ≈ 887 million codes: a clash is rare). */
const CODE_ATTEMPTS = 8;

/** The referral rule as the apps say it, straight from the money rules (decisions §1). */
export function inviteRuleOf(rules: MoneyRules): InviteRule {
  return {
    rewardsOn: rules.referral.enabled,
    pointsPerSide: rules.referral.pointsPerSide,
    pointValueIqd: rules.points.pointValueIqd,
    minOrderIqd: rules.referral.minOrderIqd,
    unlockOnOrder: rules.referral.unlockOnQualifyingOrder,
    monthlyCap: rules.referral.monthlyCapPerReferrer,
  };
}

/** A new invite code: `INVITE_CODE_LENGTH` characters of the look-alike-free alphabet. */
export function newInviteCode(random: RandomInt): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) code += INVITE_CODE_ALPHABET[random(INVITE_CODE_ALPHABET.length)];
  return code;
}

/**
 * Invite as a gift (joy g2). Each person has one code (made on first ask); a friend who has not
 * ordered yet accepts it once; from then on the orders module sends the inviter with every closed
 * order and the ledger's existing referral rule decides when the points pay (the friend's 2nd cash
 * order ≥ 10,000, 200 points each, the inviter's monthly cap). No money is decided here.
 */
@Injectable()
export class ReferralsService implements ReferralsPort {
  private orders: ReferralOrdersPort | null = null;

  constructor(
    @Inject(REFERRALS_REPOSITORY) private readonly repo: ReferralsRepository,
    @Inject(REFERRAL_NAMES) private readonly names: ReferralNamesPort,
    @Inject(REFERRAL_LEDGER) private readonly ledger: ReferralLedgerPort,
    @Inject(REFERRAL_RULES) private readonly rules: MoneyRules,
    @Inject(REFERRAL_RANDOM) private readonly random: RandomInt,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(REFERRAL_FINGERPRINT) private readonly fingerprint: ReferralFingerprintPort,
    @Optional() @Inject(WINDOW_COUNTER) counter?: WindowCounter,
  ) {
    this.previews = counter ?? new InMemoryWindowCounter(clock);
  }

  /** FLOW-33: preview calls per caller (shared across machines when Redis is set). */
  private readonly previews: WindowCounter;

  bindOrders(port: ReferralOrdersPort): void {
    this.orders = port;
  }

  private get inviteRule(): InviteRule {
    return inviteRuleOf(this.rules);
  }

  /** The person's code, made the first time it is asked for. */
  async codeFor(personId: string): Promise<string> {
    const existing = await this.repo.codeOf(personId);
    if (existing) return existing;
    for (let i = 0; i < CODE_ATTEMPTS; i += 1) {
      if (await this.repo.saveCode(personId, newInviteCode(this.random), this.clock.now())) break;
      // A concurrent ask for the same person won: use its code.
      const won = await this.repo.codeOf(personId);
      if (won) return won;
    }
    const code = await this.repo.codeOf(personId);
    if (!code) throw new Error('invite code: no free code after several attempts');
    return code;
  }

  async mine(actor: Actor): Promise<InviteView> {
    const code = await this.codeFor(actor.personId);
    const [rows, lines] = await Promise.all([this.repo.byReferrer(actor.personId), this.ledger.eventsFor(`points:${actor.personId}`)]);
    const rewarded = lines.filter((e) => e.type === 'referral_bonus' && e.toAccount === `points:${actor.personId}` && (e.memo ?? '').startsWith('referrer_of:')).length;
    const names = rows.length ? await this.names.firstNamesFor(rows.map((r) => r.refereeId), actor.personId, 'invite_list') : {};
    const friends: InviteFriend[] = [];
    for (const r of rows) {
      const state: InviteFriend['state'] = r.blockedReason ? 'not_counted' : (await this.paid(r.refereeId)) ? 'counted' : 'waiting';
      friends.push({ firstName: names[r.refereeId] ?? null, state });
    }
    return { code, path: invitePath(code), rule: this.inviteRule, invited: rows.length, rewarded, friends };
  }

  rule(): Promise<InviteRule> {
    return Promise.resolve(this.inviteRule);
  }

  async preview(input: InvitePreviewInput, who?: { personId: string | null; ip: string | null }): Promise<InvitePreview> {
    const caller = who?.personId ? `p:${who.personId}` : who?.ip ? `ip:${who.ip}` : null;
    const rate = INVITE_PREVIEW_RATE;
    if (caller) {
      const misses = await this.previews.count(`invite:miss:${caller}`, rate.missWindowMs);
      if (misses >= rate.missesPerCaller) throw new DriverError('rate_limited', { retryAfterSec: Math.ceil(rate.missWindowMs / 1000) });
      const hit = await this.previews.hit(`invite:preview:${caller}`, rate.windowMs, rate.perCaller);
      if (!hit.allowed) throw new DriverError('rate_limited', { retryAfterSec: hit.retryAfterSec });
    }
    const code = normalizeInviteCode(input.code);
    const owner = code ? await this.repo.ownerOf(code) : null;
    if (!owner) {
      if (caller) await this.previews.hit(`invite:miss:${caller}`, rate.missWindowMs, rate.missesPerCaller);
      return { valid: false, inviterFirstName: null, rule: this.inviteRule };
    }
    // The inviter sent his own link: his first name on it is his choice (read as himself, not logged).
    const name = (await this.names.firstNamesFor([owner], owner, 'invite_preview'))[owner] ?? null;
    return { valid: true, inviterFirstName: name, rule: this.inviteRule };
  }

  async claim(actor: Actor, input: ClaimInviteInput): Promise<ClaimInviteOutput> {
    const code = normalizeInviteCode(input.code);
    const referrerId = code ? await this.repo.ownerOf(code) : null;
    if (!code || !referrerId) throw new DriverError('invite_invalid');
    if (referrerId === actor.personId) throw new DriverError('invite_own');
    const prior = await this.repo.referralOf(actor.personId);
    if (prior) {
      // The same code again (a retry) answers like the first time.
      if (prior.referrerId !== referrerId) throw new DriverError('invite_already_claimed');
      return this.claimed(actor.personId, referrerId);
    }
    if (this.orders && (await this.orders.placedCount(actor.personId)) > 0) throw new DriverError('invite_not_new');
    if (!(await this.repo.saveReferral({ refereeId: actor.personId, referrerId, code, claimedAt: this.clock.now() }))) {
      const won = await this.repo.referralOf(actor.personId);
      if (won?.referrerId !== referrerId) throw new DriverError('invite_already_claimed');
    }
    // Decisions §1: the fingerprint is checked now and again at payout. A block is recorded, never shown
    // to the friend as an error (the inviter's list says «ما انحسبت»).
    const row = await this.repo.referralOf(actor.personId);
    if (row) await this.assess(row);
    return this.claimed(actor.personId, referrerId);
  }

  /** `referral:<friend>` exists in the ledger: this referral already paid. */
  private paid(refereeId: string): Promise<boolean> {
    return this.ledger.hasGroup(`referral:${refereeId}`);
  }

  /**
   * Refreshes both sides' marks and blocks the referral when the friend shares a device, phone or home
   * with the inviter, or with anyone on a referral that already paid (either side of it). Returns the
   * row as stored (a block, once set, stays).
   */
  private async assess(row: ReferralRecord): Promise<ReferralRecord> {
    const [friendParts, inviterParts] = await Promise.all([this.fingerprint.partsOf(row.refereeId), this.fingerprint.partsOf(row.referrerId)]);
    const friend = marksOf(friendParts);
    const inviter = marksOf(inviterParts);
    const earners: string[] = [];
    for (const other of await this.repo.sharingAny(friend, row.refereeId)) {
      if (await this.paid(other.refereeId)) earners.push(...other.refereeMarks, ...other.referrerMarks);
    }
    const reason = row.blockedReason ? null : blockReason({ friend, inviter, earners });
    return this.repo.updateFingerprint(row.refereeId, { refereeMarks: friend, referrerMarks: inviter, block: reason ? { reason, at: this.clock.now() } : null });
  }

  private async claimed(refereeId: string, referrerId: string): Promise<ClaimInviteOutput> {
    const name = (await this.names.firstNamesFor([referrerId], refereeId, 'invite_claim'))[referrerId] ?? null;
    return { ok: true, inviterFirstName: name, rule: this.inviteRule };
  }

  /**
   * Who invited this person, for the closed order's money fact — or null when there is none or the
   * referral is blocked. Until it has paid, the fingerprint is checked again here (payout), so a home or
   * device shared after the claim still stops it.
   */
  async referrerOf(personId: string): Promise<string | null> {
    const row = await this.repo.referralOf(personId);
    if (!row || row.blockedReason) return null;
    if (await this.paid(personId)) return row.referrerId;
    const now = await this.assess(row);
    return now.blockedReason ? null : now.referrerId;
  }
}
