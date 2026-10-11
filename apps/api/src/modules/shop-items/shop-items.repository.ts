import type { SoldBy } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** How a stall or bakery item sells (`shop_items`): by the kilo, the piece or the lot. */
export interface ShopItemRecord {
  itemId: string;
  orgId: string;
  soldBy: SoldBy;
  piecesMin: number | null;
  piecesMax: number | null;
  piecesWord: string | null;
  /** Bakery lots: pieces for one lot's price. */
  perLot: number | null;
}

export interface ShopItemsRepository {
  saveItem(item: ShopItemRecord, tx?: Tx): Promise<ShopItemRecord>;
  itemsOf(orgId: string, tx?: Tx): Promise<ShopItemRecord[]>;
  itemsByIds(orgId: string, itemIds: readonly string[], tx?: Tx): Promise<ShopItemRecord[]>;
}

export const SHOP_ITEMS_REPOSITORY = Symbol('SHOP_ITEMS_REPOSITORY');

export class InMemoryShopItemsRepository implements ShopItemsRepository {
  private readonly items = new Map<string, ShopItemRecord>();

  async saveItem(item: ShopItemRecord): Promise<ShopItemRecord> {
    this.items.set(item.itemId, { ...item });
    return { ...item };
  }

  async itemsOf(orgId: string): Promise<ShopItemRecord[]> {
    return [...this.items.values()].filter((i) => i.orgId === orgId).map((i) => ({ ...i }));
  }

  async itemsByIds(orgId: string, itemIds: readonly string[]): Promise<ShopItemRecord[]> {
    return itemIds.flatMap((id) => {
      const i = this.items.get(id);
      return i && i.orgId === orgId ? [{ ...i }] : [];
    });
  }
}

type ItemRow = Omit<ShopItemRecord, 'soldBy'> & { soldBy: string };
const itemOf = ({
  itemId,
  orgId,
  soldBy,
  piecesMin,
  piecesMax,
  piecesWord,
  perLot,
}: ItemRow): ShopItemRecord => ({
  itemId,
  orgId,
  soldBy: soldBy as SoldBy,
  piecesMin,
  piecesMax,
  piecesWord,
  perLot,
});

export class PrismaShopItemsRepository implements ShopItemsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? this.prisma.prisma;
  }

  async saveItem(item: ShopItemRecord, tx?: Tx): Promise<ShopItemRecord> {
    const { itemId, ...rest } = item;
    return itemOf(
      await this.db(tx).shopItem.upsert({ where: { itemId }, create: item, update: rest }),
    );
  }

  async itemsOf(orgId: string, tx?: Tx): Promise<ShopItemRecord[]> {
    return (await this.db(tx).shopItem.findMany({ where: { orgId } })).map(itemOf);
  }

  async itemsByIds(orgId: string, itemIds: readonly string[], tx?: Tx): Promise<ShopItemRecord[]> {
    if (itemIds.length === 0) return [];
    return (
      await this.db(tx).shopItem.findMany({ where: { orgId, itemId: { in: [...itemIds] } } })
    ).map(itemOf);
  }
}
