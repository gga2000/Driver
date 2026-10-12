import { router } from 'expo-router';
import type { HeaderAlert } from '@/features/store/StoreHeader';
import { useT } from '@/lib/i18n';
import { useShopMode, useStallPrices } from './queries';

/**
 * The board's header chip for a produce stall (merchant thread OK, 2026-10-12): until all of today's
 * prices are posted it says «أسعار اليوم 2 من 7» and opens the screen. A bakery needs none: the board's
 * own open/closed pill already shows a pause or a close from «الفرن» (same switch).
 */
export function useMarketChip(merchantOrgId: string | null): HeaderAlert | null {
  const t = useT();
  const stallMode = useShopMode(merchantOrgId).data?.kind === 'produce_stall';
  const stall = useStallPrices(merchantOrgId, stallMode).data;
  if (!stallMode || !stall) return null;
  const posted = stall.rows.filter((r) => r.postedToday).length;
  if (stall.rows.length === 0 || posted === stall.rows.length) return null;
  return { key: 'market', testID: 'market-chip', icon: 'camera', tone: 'warning', label: t('merchant.market.chip.prices', { n: posted, total: stall.rows.length }), onPress: () => router.push('/market/prices') };
}
