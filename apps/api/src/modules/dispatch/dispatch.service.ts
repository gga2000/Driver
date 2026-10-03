import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  Actor,
  BoardPolicy,
  DispatchBoard,
  DispatchConfig,
  DispatchPolicyKind,
  DispatchPort,
  OverrideInput,
  OverrideOutput,
  RespondInput,
  RespondOutput,
  SetPolicyInput,
  Vertical,
} from '@driver/contracts';
import { ConfigService } from '../config/index.js';
import type { DispatchRequest } from './dispatch.store.js';
import { liveDriver, type LiveDriver } from './driver-pins.js';
import { OfferOrchestrator, type DispatchRequestInput } from './offer.orchestrator.js';
import { AutoAssignPolicy, PreAssignedPolicy, ScheduledPolicy, SmartBroadcastPolicy } from './policies.js';
import type { DispatchJob, DispatchPlan, DriverCandidate, Policy } from './policy.js';
import { PresenceService } from './presence.service.js';
import { DriverRanker } from './ranker.js';

export const DISPATCH_POLICIES = Symbol('DISPATCH_POLICIES');

export function defaultPolicies(): Policy[] {
  return [new SmartBroadcastPolicy(), new AutoAssignPolicy(), new ScheduledPolicy(), new PreAssignedPolicy()];
}

export class DispatchError extends Error {
  constructor(
    readonly code: 'no_policy_for_city_vertical' | 'unknown_policy' | 'not_wired',
    message: string,
  ) {
    super(message);
    this.name = 'DispatchError';
  }
}

/**
 * Dispatch façade. `plan()` is the pure M1 planner (policy by city × vertical over ranked
 * candidates). The Step 5 lifecycle — presence, waves, first-accept lock, re-broadcast,
 * passes, auctions, overrides and the board — lives in `OfferOrchestrator` and is reached
 * through the methods below, which also implement the transport's `DispatchPort`.
 */
@Injectable()
export class DispatchService implements DispatchPort {
  private readonly policies: ReadonlyMap<DispatchPolicyKind, Policy>;

  private readonly ranker: DriverRanker;

  constructor(
    private readonly config: ConfigService,
    @Optional() ranker?: DriverRanker,
    @Optional() @Inject(DISPATCH_POLICIES) policies?: Policy[],
    @Optional() private readonly orchestrator?: OfferOrchestrator,
    @Optional() private readonly presenceService?: PresenceService,
  ) {
    this.ranker = ranker ?? new DriverRanker();
    this.policies = new Map((policies ?? defaultPolicies()).map((p) => [p.kind, p]));
  }

  configFor(cityId: string, vertical: Vertical): DispatchConfig {
    const cfg = this.config.dispatchFor(cityId, vertical);
    if (!cfg) throw new DispatchError('no_policy_for_city_vertical', `no dispatch config for ${cityId}/${vertical}`);
    return cfg;
  }

  policyFor(cityId: string, vertical: Vertical): Policy {
    const cfg = this.configFor(cityId, vertical);
    const policy = this.policies.get(cfg.policy);
    if (!policy) throw new DispatchError('unknown_policy', `policy ${cfg.policy} is not registered`);
    return policy;
  }

  plan(job: DispatchJob, candidates: DriverCandidate[]): DispatchPlan {
    const cfg = this.configFor(job.cityId, job.vertical);
    const policy = this.policyFor(job.cityId, job.vertical);
    const plan = policy.plan(job, this.ranker.withWeights(cfg.rankWeights).rank(candidates), cfg);
    return cfg.suggestOnly ? { kind: 'suggest', suggestion: plan } : plan;
  }

  // ───────────────────────── Step 5 lifecycle ─────────────────────────

  private get o(): OfferOrchestrator {
    if (!this.orchestrator) throw new DispatchError('not_wired', 'dispatch orchestrator is not wired');
    return this.orchestrator;
  }

  get presence(): PresenceService {
    if (!this.presenceService) throw new DispatchError('not_wired', 'presence is not wired');
    return this.presenceService;
  }

  /** Starts dispatch for a trip (auto-assign on `order.merchant_accepted`, broadcast on ride request…). */
  request(job: DispatchRequestInput): Promise<DispatchRequest> {
    return this.o.request(job);
  }

  cancel(tripId: string, actorId?: string): Promise<void> {
    return this.o.cancel(tripId, actorId);
  }

  markPickedUp(tripId: string): Promise<void> {
    return this.o.markPickedUp(tripId);
  }

  jobFinished(tripId: string): Promise<void> {
    return this.o.jobFinished(tripId);
  }

  getRequest(tripId: string): Promise<DispatchRequest | null> {
    return this.o.getRequest(tripId);
  }

  board(cityId: string): Promise<DispatchBoard> {
    return this.o.board(cityId);
  }

  override(actor: Actor, input: OverrideInput): Promise<OverrideOutput> {
    return this.o.override(actor.personId, input);
  }

  setPolicy(actor: Actor, input: SetPolicyInput): Promise<BoardPolicy> {
    return this.o.setPolicy(actor.personId, input);
  }

  respond(actor: Actor, input: RespondInput): Promise<RespondOutput> {
    return this.o.respond(actor.personId, input.offerId, input.accept);
  }

  async offerSeen(actor: Actor, input: { offerId: string; foregroundMs: number }): Promise<{ seen: boolean }> {
    return { seen: await this.o.offerSeen(actor.personId, input.offerId, input.foregroundMs) };
  }

  // ───────────────────────── Console reads ─────────────────────────

  /** Every live driver in the city with his board state (free / offered / on job / recently offline). */
  async liveDrivers(cityId: string, now: Date): Promise<LiveDriver[]> {
    const [present, jobs] = await Promise.all([this.presence.list(cityId), this.o.liveJobs(cityId)]);
    return present.map((p) => liveDriver(p, jobs, now.getTime()));
  }

  /** Offers accepted since `since` and the mean seconds from send to accept. */
  acceptStats(since: Date): Promise<{ accepted: number; avgSec: number | null }> {
    return this.o.acceptStats(since);
  }
}
