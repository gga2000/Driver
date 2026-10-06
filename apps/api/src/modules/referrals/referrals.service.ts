import { Inject, Injectable } from '@nestjs/common';
import {
  DriverError,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  invitePath,
  normalizeInviteCode,
  type Actor,
  type ClaimInviteInput,
  type ClaimInviteOutput,
  type InvitePreview,
  type InvitePreviewInput,
  type InviteRule,
  type InviteView,
  type MoneyRules,
  type ReferralsPort,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { REFERRALS_REPOSITORY, type ReferralsRepository } from './referrals.repository.js';

/** First names from the vault (identity's logged read; the inviter's own invitation is not logged). */
export interface ReferralNamesPort {
  firstNamesFor(personIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string | null>>;
}

/** The inviter's points lines (the ledger): his side of a referral is a `referral_bonus` memo'd `referrer_of:`. */
export interface ReferralLedgerPort {
  eventsFor(accountId: string): Promise<ReadonlyArray<{ type: string; toAccount: string; memo?: string | null }>>;
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

/** Attempts at a fresh code before giving up (31^6 ≈ 887 million codes: a clash is rare). */
const CODE_ATTEMPTS = 8;

/** The referral rule as the apps say it, straight from the money rules (decisions §1). */
export function inviteRuleOf(rules: MoneyRules): InviteRule {
  return {
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
  ) {}

  bindOrders(port: ReferralOrdersPort): void {
    this.orders = port;
  }

  private get rule(): InviteRule {
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
    const [invited, lines] = await Promise.all([this.repo.countInvited(actor.personId), this.ledger.eventsFor(`points:${actor.personId}`)]);
    const rewarded = lines.filter((e) => e.type === 'referral_bonus' && e.toAccount === `points:${actor.personId}` && (e.memo ?? '').startsWith('referrer_of:')).length;
    return { code, path: invitePath(code), rule: this.rule, invited, rewarded };
  }

  async preview(input: InvitePreviewInput): Promise<InvitePreview> {
    const code = normalizeInviteCode(input.code);
    const owner = code ? await this.repo.ownerOf(code) : null;
    if (!owner) return { valid: false, inviterFirstName: null, rule: this.rule };
    // The inviter sent his own link: his first name on it is his choice (read as himself, not logged).
    const name = (await this.names.firstNamesFor([owner], owner, 'invite_preview'))[owner] ?? null;
    return { valid: true, inviterFirstName: name, rule: this.rule };
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
    return this.claimed(actor.personId, referrerId);
  }

  private async claimed(refereeId: string, referrerId: string): Promise<ClaimInviteOutput> {
    const name = (await this.names.firstNamesFor([referrerId], refereeId, 'invite_claim'))[referrerId] ?? null;
    return { ok: true, inviterFirstName: name, rule: this.rule };
  }

  /** Who invited this person (the orders module sends it with the closed order), or null. */
  async referrerOf(personId: string): Promise<string | null> {
    return (await this.repo.referralOf(personId))?.referrerId ?? null;
  }
}
