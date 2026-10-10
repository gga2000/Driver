import { Inject, Injectable } from '@nestjs/common';
import type { AuditCategory, AuditEntry, AuditPage } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { IdentityService } from '../identity/index.js';
import { CONTROLS_REPOSITORY, type AuditRecord, type ControlsRepository } from './controls.repository.js';

const NAME_TTL_MS = 10 * 60_000;

/**
 * v10: the audit page's chips. A row belongs to a chip when its action starts with one of these
 * (actions are `<area>.<verb>`); rows that match none show only under «الكل». Kept here, not in
 * contracts: the Console's string subset reads contracts and would keep every key under `zone.` etc.
 */
export const AUDIT_CATEGORY_ACTIONS: Record<AuditCategory, readonly string[]> = {
  money: ['ticket.refund', 'order.refund', 'refund_approval.', 'finance.', 'order.ops_resolve_dispute', 'order.dispute_escalated'],
  approvals: ['approval.', 'store.dish_photo', 'store.pickup_spot'],
  pauses: ['driver.pause', 'driver.lift_pause', 'kill_switch.', 'capacity.'],
  safety: ['safety.', 'khat.', 'pin.'],
  orders: ['order.ops_cancel', 'ride.', 'departure.', 'ticket.open', 'ticket.resolve', 'ticket.escalate', 'ticket.fault'],
  settings: ['zone.', 'banner.', 'screen.', 'season.', 'quiet.', 'on_call.', 'handover.'],
};

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

  /** v10: one page of the audit page, newest first, with how many rows the chip matches. */
  async page(input: { cityId: string; category?: AuditCategory | undefined; cursor?: string | undefined; limit: number }): Promise<AuditPage> {
    const { rows, total } = await this.repo.auditPage({
      cityId: input.cityId,
      prefixes: input.category ? AUDIT_CATEGORY_ACTIONS[input.category] : undefined,
      after: parseAuditCursor(input.cursor),
      limit: input.limit,
    });
    const names = await this.names.of(rows.map((r) => r.actorId));
    const last = rows[rows.length - 1];
    return {
      rows: rows.map((r) => this.entry(r, names)),
      total,
      nextCursor: last && rows.length === input.limit ? auditCursor(last) : null,
    };
  }

  private entry(r: AuditRecord, names: Record<string, string | null>): AuditEntry {
    return { id: r.id, at: r.at, actorId: r.actorId, actorName: names[r.actorId] ?? null, action: r.action, subjectKind: r.subjectKind, subjectId: r.subjectId, summary_ar: r.summaryAr, detail: r.detail };
  }

  async list(filter: { cityId?: string | undefined; subjectKind?: string | undefined; subjectId?: string | undefined; limit: number }): Promise<AuditEntry[]> {
    const rows = await this.repo.audit(filter);
    const names = await this.names.of(rows.map((r) => r.actorId));
    return rows.map((r) => this.entry(r, names));
  }
}

/** The page cursor: the last row's time and id. Opaque to the Console. */
export function auditCursor(r: Pick<AuditRecord, 'at' | 'id'>): string {
  return `${r.at.toISOString()}~${r.id}`;
}

/** A cursor this service did not write reads as "from the newest row". */
export function parseAuditCursor(cursor: string | undefined): { at: Date; id: string } | undefined {
  if (!cursor) return undefined;
  const cut = cursor.indexOf('~');
  if (cut < 0) return undefined;
  const at = new Date(cursor.slice(0, cut));
  const id = cursor.slice(cut + 1);
  return Number.isNaN(at.getTime()) || !id ? undefined : { at, id };
}
