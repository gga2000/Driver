import type { SettlementMode } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** Per-merchant cash-account settings (`merchant_settlements`, owned by the ledger). The balance itself is derived from the ledger. */
export interface MerchantSettings {
  merchantId: string;
  mode: SettlementMode;
  exposureCapIqd: number;
  /** sha256 of the hand-over PIN; null = tablet tap only. */
  pinHash: string | null;
  lastSettledAt: Date | null;
  lastRequestedAt: Date | null;
}

export interface MerchantSettingsRepository {
  find(merchantId: string, tx?: Tx): Promise<MerchantSettings | null>;
  upsert(settings: MerchantSettings, tx?: Tx): Promise<MerchantSettings>;
}

export class InMemoryMerchantSettingsRepository implements MerchantSettingsRepository {
  private readonly rows = new Map<string, MerchantSettings>();

  async find(merchantId: string): Promise<MerchantSettings | null> {
    const row = this.rows.get(merchantId);
    return row ? { ...row } : null;
  }

  async upsert(settings: MerchantSettings): Promise<MerchantSettings> {
    this.rows.set(settings.merchantId, { ...settings });
    return { ...settings };
  }
}

interface MerchantSettlementRow {
  orgId: string;
  mode: SettlementMode;
  exposureCapIqd: number;
  pinHash: string | null;
  lastSettledAt: Date | null;
  lastRequestedAt: Date | null;
}

interface MerchantSettlementDelegate {
  findUnique(args: { where: { orgId: string } }): Promise<MerchantSettlementRow | null>;
  upsert(args: { where: { orgId: string }; create: MerchantSettlementRow; update: Omit<MerchantSettlementRow, 'orgId'> }): Promise<MerchantSettlementRow>;
}

export class PrismaMerchantSettingsRepository implements MerchantSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): MerchantSettlementDelegate {
    return ((tx ?? this.prisma.prisma) as unknown as { merchantSettlement: MerchantSettlementDelegate }).merchantSettlement;
  }

  async find(merchantId: string, tx?: Tx): Promise<MerchantSettings | null> {
    const row = await this.db(tx).findUnique({ where: { orgId: merchantId } });
    return row ? fromRow(row) : null;
  }

  async upsert(s: MerchantSettings, tx?: Tx): Promise<MerchantSettings> {
    const data = { mode: s.mode, exposureCapIqd: s.exposureCapIqd, pinHash: s.pinHash, lastSettledAt: s.lastSettledAt, lastRequestedAt: s.lastRequestedAt };
    return fromRow(await this.db(tx).upsert({ where: { orgId: s.merchantId }, create: { orgId: s.merchantId, ...data }, update: data }));
  }
}

function fromRow(r: MerchantSettlementRow): MerchantSettings {
  return { merchantId: r.orgId, mode: r.mode, exposureCapIqd: r.exposureCapIqd, pinHash: r.pinHash, lastSettledAt: r.lastSettledAt, lastRequestedAt: r.lastRequestedAt };
}
