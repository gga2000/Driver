import { Inject, Injectable } from '@nestjs/common';
import type { AuditEntry } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { IdentityService } from '../identity/index.js';
import { CONTROLS_REPOSITORY, type AuditRecord, type ControlsRepository } from './controls.repository.js';

const NAME_TTL_MS = 10 * 60_000;

/**
 * Staff first names for console screens (who flipped a switch, who answered a ticket). Read through
 * identity's logged vault path (purpose `console_staff`) and kept for ten minutes, so a page polling
 * every few seconds does not write a vault-access row per poll.
 */
@Injectable()
export class StaffNames {
  private readonly cache = new Map<string, { name: string | null; at: number }>();

  constructor(
    private readonly identity: IdentityService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async of(ids: readonly string[], accessorId = 'system:console', purpose = 'console_staff'): Promise<Record<string, string | null>> {
    const now = this.clock.now().getTime();
    const out: Record<string, string | null> = {};
    const missing: string[] = [];
    for (const id of new Set(ids)) {
      if (id.startsWith('system')) {
        out[id] = 'النظام';
        continue;
      }
      const hit = this.cache.get(id);
      if (hit && now - hit.at < NAME_TTL_MS) out[id] = hit.name;
      else missing.push(id);
    }
    if (missing.length > 0) {
      const names = await this.identity.firstNamesFor(missing, accessorId, purpose).catch(() => ({}) as Record<string, string | null>);
      for (const id of missing) {
        const name = names[id] ?? null;
        this.cache.set(id, { name, at: now });
        out[id] = name;
      }
    }
    return out;
  }
}

/**
 * The console audit log (console spec, system/admin: "audit log of every console action"). Every
 * control-room mutation writes one row in the same unit of work as the change it describes.
 */
@Injectable()
export class AuditLogService {
  constructor(
    @Inject(CONTROLS_REPOSITORY) private readonly repo: ControlsRepository,
    private readonly names: StaffNames,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  record(input: { cityId: string | null; actorId: string; action: string; subjectKind: string; subjectId: string; summaryAr: string; detail?: Record<string, unknown> }, tx?: Tx): Promise<AuditRecord> {
    return this.repo.addAudit({ ...input, detail: input.detail ?? {}, at: this.clock.now() }, tx);
  }

  async list(filter: { cityId?: string | undefined; subjectKind?: string | undefined; limit: number }): Promise<AuditEntry[]> {
    const rows = await this.repo.audit(filter);
    const names = await this.names.of(rows.map((r) => r.actorId));
    return rows.map((r) => ({ id: r.id, at: r.at, actorId: r.actorId, actorName: names[r.actorId] ?? null, action: r.action, subjectKind: r.subjectKind, subjectId: r.subjectId, summary_ar: r.summaryAr, detail: r.detail }));
  }
}
