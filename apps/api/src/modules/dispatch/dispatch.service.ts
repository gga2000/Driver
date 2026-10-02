import { Inject, Injectable, Optional } from '@nestjs/common';
import type { DispatchConfig, DispatchPolicyKind, Vertical } from '@driver/contracts';
import { ConfigService } from '../config/index.js';
import { AutoAssignPolicy, PreAssignedPolicy, ScheduledPolicy, SmartBroadcastPolicy } from './policies.js';
import type { DispatchJob, DispatchPlan, DriverCandidate, Policy } from './policy.js';
import { DriverRanker } from './ranker.js';

export const DISPATCH_POLICIES = Symbol('DISPATCH_POLICIES');

export function defaultPolicies(): Policy[] {
  return [new SmartBroadcastPolicy(), new AutoAssignPolicy(), new ScheduledPolicy(), new PreAssignedPolicy()];
}

export class DispatchError extends Error {
  constructor(
    readonly code: 'no_policy_for_city_vertical' | 'unknown_policy',
    message: string,
  ) {
    super(message);
    this.name = 'DispatchError';
  }
}

/**
 * Selects the policy by (cityId, vertical) from config and asks it for a plan over
 * ranked candidates. In "suggest only" mode the plan is wrapped so the console decides.
 */
@Injectable()
export class DispatchService {
  private readonly policies: ReadonlyMap<DispatchPolicyKind, Policy>;

  private readonly ranker: DriverRanker;

  constructor(
    private readonly config: ConfigService,
    @Optional() ranker?: DriverRanker,
    @Optional() @Inject(DISPATCH_POLICIES) policies?: Policy[],
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
    const plan = policy.plan(job, this.ranker.rank(candidates), cfg);
    return cfg.suggestOnly ? { kind: 'suggest', suggestion: plan } : plan;
  }
}
