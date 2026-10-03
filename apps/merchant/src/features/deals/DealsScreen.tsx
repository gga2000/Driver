import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { DealView } from '@driver/contracts';
import { Button, EmptyState, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { Page } from '@/components/Page';
import { Glyph } from '@/features/menu/Glyph';
import { useMenu } from '@/features/menu/queries';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { DealCard } from './DealCard';
import { dealDisplay, sortDeals } from './logic';
import { useDealActions, useDeals } from './queries';

/**
 * العروض: every deal with where it stands (waiting for Driver's approval, running, scheduled, paused,
 * over) and its projected cost; the owner proposes new ones and pauses or resumes them.
 */
export function DealsScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { wide } = useLayout();
  const { store, canSeeMoney } = useCurrentStore();
  const owner = canSeeMoney;
  const storeId = store?.orgId ?? null;
  const deals = useDeals(storeId);
  const menu = useMenu(storeId);
  const actions = useDealActions();
  const [busyId, setBusyId] = useState<string | null>(null);
  // States read against the moment the list arrived (it refreshes every minute).
  const now = deals.dataUpdatedAt || Date.now();

  const names = useMemo(() => new Map((menu.data?.categories ?? []).flatMap((c) => c.items.map((i) => [i.id, i.nameAr] as const))), [menu.data]);
  const sorted = useMemo(() => sortDeals(deals.data ?? [], now), [deals.data, now]);
  const current = sorted.filter((d) => !['ended', 'rejected'].includes(dealDisplay(d, now)));
  const past = sorted.filter((d) => ['ended', 'rejected'].includes(dealDisplay(d, now)));
  const running = current.filter((d) => dealDisplay(d, now) === 'active').length;
  const waiting = current.filter((d) => dealDisplay(d, now) === 'pending').length;

  const onToggle = (deal: DealView, active: boolean) => {
    if (!storeId) return;
    setBusyId(deal.dealId);
    actions.setActive.mutate(
      { merchantOrgId: storeId, dealId: deal.dealId, active },
      {
        onSuccess: () => toast.show({ message: active ? t('merchant.deals.resumed', { name: deal.nameAr }) : t('merchant.deals.paused', { name: deal.nameAr }), tone: active ? 'success' : 'neutral' }),
        onError: (err) => toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' }),
        onSettled: () => setBusyId(null),
      },
    );
  };

  const grid = (list: DealView[]) => (
    <View style={{ flexDirection: wide ? 'row' : 'column', flexWrap: 'wrap', gap: theme.space[4] }}>
      {list.map((d) => (
        <View key={d.dealId} style={wide ? { flexBasis: '48%', flexGrow: 1, maxWidth: '50%' } : undefined}>
          <DealCard deal={d} now={now} names={names} owner={owner} busy={busyId === d.dealId} onToggle={onToggle} />
        </View>
      ))}
    </View>
  );

  return (
    <Page
      title={t('merchant.more.deals')}
      subtitle={deals.data ? t('merchant.deals.subtitle', { running, waiting }) : store?.name}
      back
      testID="deals"
      maxWidth={1080}
      aside={owner ? <Button testID="deal-new" label={t('merchant.deals.new')} icon="plus" onPress={() => router.push('/deals/new')} size={wide ? 'md' : 'sm'} /> : null}
    >
      <View style={{ flexDirection: 'row', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.accentTint }}>
        <Glyph name="percent" size={22} color="accentText" strokeWidth={2} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{t('merchant.deals.how_title')}</Text>
          <Text variant="footnote" color="textMuted">
            {t('merchant.deals.how_body')}
          </Text>
        </View>
      </View>
      {!owner ? (
        <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center' }}>
          <Glyph name="info" size={18} color="textMuted" />
          <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {t('merchant.deals.staff_note')}
          </Text>
        </View>
      ) : null}

      {deals.isLoading ? (
        <View style={{ gap: theme.space[3] }}>
          <Skeleton height={220} radius={theme.radius.xl} />
          <Skeleton height={220} radius={theme.radius.xl} />
        </View>
      ) : deals.isError ? (
        <EmptyState icon="x" title={t('merchant.deals.load_failed')} action={{ label: t('merchant.menu.retry'), onPress: () => void deals.refetch() }} />
      ) : sorted.length === 0 ? (
        <View style={{ alignItems: 'center', gap: theme.space[4], paddingVertical: theme.space[10] }}>
          <View style={{ width: 88, height: 88, borderRadius: 28, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-6deg' }] }}>
            <Glyph name="tag" size={40} color="accentText" />
          </View>
          <Text variant="title" align="center">
            {t('merchant.deals.empty_title')}
          </Text>
          <Text variant="body" color="textMuted" align="center" style={{ maxWidth: 420 }}>
            {owner ? t('merchant.deals.empty_body') : t('merchant.deals.empty_staff')}
          </Text>
          {owner ? <Button label={t('merchant.deals.new_first')} icon="plus" onPress={() => router.push('/deals/new')} /> : null}
        </View>
      ) : (
        <>
          {current.length > 0 ? grid(current) : null}
          {past.length > 0 ? (
            <View style={{ gap: theme.space[3] }}>
              <Text variant="title" color="textMuted">
                {t('merchant.deals.past')}
              </Text>
              {grid(past)}
            </View>
          ) : null}
        </>
      )}
    </Page>
  );
}
