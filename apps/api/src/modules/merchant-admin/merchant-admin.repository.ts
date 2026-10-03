import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** `merchant_dispute_responses`: the merchant's one answer per disputed order (re-answering replaces it). */
export interface DisputeResponseRecord {
  id: string;
  orderId: string;
  merchantOrgId: string;
  decision: 'accept_default' | 'contest';
  note: string | null;
  evidenceRefs: string[];
  respondedById: string;
  at: Date;
}

export interface MerchantAdminRepository {
  upsertResponse(input: Omit<DisputeResponseRecord, 'id'>, tx?: Tx): Promise<DisputeResponseRecord>;
  responses(orderIds: readonly string[], tx?: Tx): Promise<DisputeResponseRecord[]>;
}

export const MERCHANT_ADMIN_REPOSITORY = Symbol('MERCHANT_ADMIN_REPOSITORY');

export class InMemoryMerchantAdminRepository implements MerchantAdminRepository {
  readonly rows = new Map<string, DisputeResponseRecord>();
  private seq = 0;

  async upsertResponse(input: Omit<DisputeResponseRecord, 'id'>): Promise<DisputeResponseRecord> {
    const existing = this.rows.get(input.orderId);
    this.seq += 1;
    const row = { id: existing?.id ?? `mdr_${this.seq}`, ...input, evidenceRefs: [...input.evidenceRefs] };
    this.rows.set(input.orderId, row);
    return { ...row };
  }

  async responses(orderIds: readonly string[]): Promise<DisputeResponseRecord[]> {
    return orderIds.map((id) => this.rows.get(id)).filter((r): r is DisputeResponseRecord => Boolean(r)).map((r) => ({ ...r }));
  }
}

function fromRow(r: { id: string; orderId: string; merchantOrgId: string; decision: string; note: string | null; evidenceRefs: string[]; respondedById: string; updatedAt: Date }): DisputeResponseRecord {
  return { id: r.id, orderId: r.orderId, merchantOrgId: r.merchantOrgId, decision: r.decision === 'contest' ? 'contest' : 'accept_default', note: r.note, evidenceRefs: [...r.evidenceRefs], respondedById: r.respondedById, at: r.updatedAt };
}

export class PrismaMerchantAdminRepository implements MerchantAdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async upsertResponse(input: Omit<DisputeResponseRecord, 'id'>, tx?: Tx): Promise<DisputeResponseRecord> {
    const data = { merchantOrgId: input.merchantOrgId, decision: input.decision, note: input.note, evidenceRefs: input.evidenceRefs, respondedById: input.respondedById, updatedAt: input.at };
    const row = await this.db(tx).merchantDisputeResponse.upsert({ where: { orderId: input.orderId }, create: { orderId: input.orderId, ...data, createdAt: input.at }, update: data });
    return fromRow(row);
  }

  async responses(orderIds: readonly string[], tx?: Tx): Promise<DisputeResponseRecord[]> {
    if (orderIds.length === 0) return [];
    return (await this.db(tx).merchantDisputeResponse.findMany({ where: { orderId: { in: [...orderIds] } } })).map(fromRow);
  }
}
