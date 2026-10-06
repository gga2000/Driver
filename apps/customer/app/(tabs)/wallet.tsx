import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import type { WalletLine, WalletLineKind } from '@driver/contracts';
import type { IconName } from '@driver/ui';
import { Button, Card, Chip, EmptyState, Icon, ListRow, Skeleton, StatusPill, Text, useTheme, useToast, withAlpha } from '@driver/ui';
import type { MessageKey } from '@driver/i18n';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { ApprovalCard } from '@/features/account/ApprovalCard';
import { useClaimPoints, useHousehold, useTopUpStatus, useTopupOptions, useWalletBalance, useWalletLines } from '@/features/account/queries';
import { balanceText, lineAmount, paidOutsideWallet, pointsWorthText } from '@/features/account/wallet-format';
import { MoneyIn } from '@/features/account/MoneyIn';
import { MonthCard } from '@/features/account/MonthCard';
import { lineHref, WALLET_FILTERS, walletDays, type WalletFilter } from '@/features/account/wallet-lines';
import { dayLabel } from '@/features/orders/OrderRow';
import { formatClock } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { color } from '@driver/design-tokens';
import { GuestGate } from '@/components/GuestGate';
import { useSignedIn } from '@/lib/session';

/** w1: pending points this close to lapsing get the warning strip. */
const EXPIRY_WARN_DAYS = 14;

const KIND_ICON: Record<WalletLineKind, IconName> = {
  food: 'food',
  grocery: 'cart',
  errand: 'cart',
  ride: 'car',
  seat: 'seat',
  subscription: 'clock',
  parcel: 'parcel',
  purchase: 'receipt',
  topup: 'wallet',
  credit: 'gift',
  refund: 'arrow-back',
  penalty: 'x',
  cash_change: 'wallet',
  change_to_wallet: 'cash',
  late_credit: 'gift',
  tip: 'gift',
  debt: 'wallet',
  adjustment: 'receipt',
  points: 'star',
};

/**
 * المحفظة (customer spec §9): money balance, points and their IQD worth, pending points to claim,
 * the household (approvals first), top-up channels and readable transactions.
 */
/** Guests see what lives here and add their number (audit C-18). */
export default function WalletTab() {
  return useSignedIn() ? <Wallet /> : <GuestGate kind="wallet" />;
}

function Wallet() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const balance = useWalletBalance();
  const lines = useWalletLines();
  const topup = useTopupOptions();
  const household = useHousehold();
  const claim = useClaimPoints();
  const pendingTopUp = useTopUpStatus().data;
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<WalletFilter>('all');
  const b = balance.data;
  const allLines = lines.data?.lines ?? [];
  // w7: a brand-new wallet says so in words — no lone «0» in display type (it reads like ٥).
  const fresh = !!b && b.moneyIqd === 0 && lines.isSuccess && allLines.length === 0;
  const noPoints = !!b && b.points === 0 && b.pendingPoints === 0;
  const now = new Date();
  const days = walletDays(allLines, filter, now);
  const open = (l: WalletLine) => {
    const href = lineHref(l);
    if (href) router.push(href as never);
  };
  const expiresSoon = b?.pendingExpiresAt && b.pendingPoints > 0 && b.pendingExpiresAt.getTime() - now.getTime() <= EXPIRY_WARN_DAYS * 86_400_000 ? b.pendingExpiresAt : null;

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([balance.refetch(), lines.refetch(), household.refetch()]);
    setRefreshing(false);
  };

  const claimPoints = async () => {
    try {
      const res = await claim.mutateAsync();
      toast.show({ message: t('points.claimed', { n: amountParam(res.claimed) }), tone: 'success' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  const approvals = household.data?.pendingApprovals.filter((a) => a.canResolve) ?? [];

  return (
    <Screen testID="wallet" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      <Text variant="heading" accessibilityRole="header">
        {t('nav.wallet_short')}
      </Text>

      <Card padding={5} style={{ backgroundColor: theme.colors.text }}>
        <View style={{ gap: theme.space[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="wallet" size={22} color={theme.colors.accentTint} />
            <Text variant="label" color={theme.colors.accentTint}>
              {t('wallet.balance')}
            </Text>
          </View>
          {!b ? (
            <Skeleton height={40} width="60%" />
          ) : fresh ? (
            <Text testID="wallet-new" variant="heading" color={theme.colors.bg}>
              {t('wallet.new_title')}
            </Text>
          ) : (
            <Text testID="wallet-balance" variant="display" color={b.moneyIqd < 0 ? theme.colors.warning : theme.colors.bg} tabular>
              {balanceText(b.moneyIqd, locale, t)}
            </Text>
          )}
          <Text variant="footnote" color={theme.colors.border}>
            {b && b.moneyIqd < 0 ? t('wallet.owe_body') : fresh ? t('wallet.new_body') : t('wallet.balance_body')}
          </Text>
          <Button testID="wallet-topup" icon="plus" label={t('wallet.topup_cta')} onPress={() => router.push('/topup')} style={{ marginTop: theme.space[2] }} />
          {pendingTopUp?.state === 'pending' ? (
            <Pressable
              testID="wallet-topup-pending"
              accessibilityRole="button"
              onPress={() => router.push('/topup')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: withAlpha(color.neutral[0], 0.1) }}
            >
              <Icon name="clock" size={18} color={theme.colors.accentTint} />
              <Text variant="footnote" color={theme.colors.bg} style={{ flex: 1 }}>
                {t('wallet.topup_pending', { amount: amountParam(pendingTopUp.amountIqd) })}
              </Text>
              <Text variant="label" weight={700} color={theme.colors.accentTint} tabular>
                {`⁦${pendingTopUp.code.slice(0, 3)} ${pendingTopUp.code.slice(3)}⁩`}
              </Text>
            </Pressable>
          ) : null}
          {b?.household ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingTop: theme.space[2], borderTopWidth: 1, borderTopColor: withAlpha(color.neutral[0], 0.12) }}>
              <Icon name="user" size={16} color={theme.colors.accentTint} />
              <Text variant="footnote" color={theme.colors.bg}>
                {t('wallet.household_balance', { name: b.household.name, amount: amountParam(b.household.balanceIqd) })}
              </Text>
            </View>
          ) : null}
        </View>
      </Card>

      <MoneyIn lines={allLines} onOpen={open} />

      {/* Joy w6: the month-start card (1st–3rd), then «شهرك» any day. */}
      <MonthCard testID="wallet-month-card" />
      <Card elevation={0} padding={0}>
        <ListRow testID="wallet-month" leading="star" title={t('month.row_title')} subtitle={t('month.row_sub')} onPress={() => router.push('/month')} />
      </Card>

      <Card padding={5} tone="tint" testID="wallet-points">
        {noPoints ? (
          // w7/w1: before the first points, what they are — not «0 نقطة = 0 دينار».
          <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'flex-start' }} testID="wallet-points-first">
            <Icon name="star" size={22} color="starOutline" filled fillColor="star" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" weight={700}>
                {t('points.first_title')}
              </Text>
              <Text variant="footnote" color="textMuted">
                {t('points.redeem_rule')}
              </Text>
            </View>
          </View>
        ) : (
        <View style={{ gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="star" size={20} color="accentText" />
            <Text variant="label" color="accentText">
              {t('wallet.points_title')}
            </Text>
          </View>
          {b ? (
            <Text variant="amount" tabular>
              {pointsWorthText(b.points, b.pointValueIqd, t)}
            </Text>
          ) : (
            <Skeleton height={32} width="70%" />
          )}
          {/* w1: how points come and go, from the city's rules (no threshold exists: any number of points pays). */}
          <View style={{ gap: theme.space[1] }} testID="wallet-points-rules">
            {b ? (
              <Text variant="footnote">
                {t('points.earn_rules', { max: amountParam(b.pointsMaxPerOrder) })}
              </Text>
            ) : null}
            <Text variant="footnote" color="textMuted">
              {t('points.redeem_rule')}
            </Text>
          </View>
          {expiresSoon && b ? (
            <View testID="wallet-points-expiry" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: theme.colors.text }}>
              <Icon name="clock" size={18} color="deal" />
              <Text variant="footnote" weight={600} color={theme.colors.bg} style={{ flex: 1 }}>
                {t('points.expiring_soon', { n: amountParam(b.pendingPoints), date: `${expiresSoon.getDate()}/${expiresSoon.getMonth() + 1}` })}
              </Text>
            </View>
          ) : null}
          {b && b.pendingPoints > 0 ? (
            <Card padding={4} elevation={0} testID="wallet-pending">
              <View style={{ gap: theme.space[3] }}>
                <Text variant="bodyStrong">{t('wallet.pending_title', { n: amountParam(b.pendingPoints), amount: amountParam(b.pendingWorthIqd) })}</Text>
                <Text variant="footnote" color="textMuted">
                  {b.pendingExpiresAt ? t('wallet.pending_body_expiry', { date: `${b.pendingExpiresAt.getDate()}/${b.pendingExpiresAt.getMonth() + 1}` }) : t('wallet.pending_body')}
                </Text>
                <Button testID="wallet-claim" icon="gift" label={t('wallet.claim')} loading={claim.isPending} onPress={() => void claimPoints()} />
              </View>
            </Card>
          ) : null}
        </View>
        )}
      </Card>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('household.title')} action={household.data ? { label: t('action.see_all'), onPress: () => router.push('/household') } : undefined} />
        {household.isPending ? (
          <Skeleton height={72} />
        ) : !household.data ? (
          <Card padding={4}>
            <View style={{ gap: theme.space[3] }}>
              <Text variant="body">{t('wallet.household_intro')}</Text>
              <Button testID="wallet-household-start" variant="secondary" icon="plus" label={t('household.create')} onPress={() => router.push('/household')} />
            </View>
          </Card>
        ) : approvals.length > 0 ? (
          approvals.map((a) => <ApprovalCard key={a.id} approval={a} />)
        ) : (
          <Card elevation={0} padding={0}>
            <ListRow
              testID="wallet-household"
              leading="user"
              title={household.data.name}
              subtitle={t('account.household_members', { n: household.data.members.length })}
              trailing={<StatusPill size="sm" tone="success" label={t('wallet.no_requests')} />}
              onPress={() => router.push('/household')}
            />
          </Card>
        )}
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('wallet.topup_title')} />
        <Card elevation={0} padding={0}>
          {(topup.data?.channels ?? []).map((c, i, list) => (
            <ListRow
              key={c.id}
              leading={c.id === 'agent' ? 'garage' : c.id === 'driver' ? 'car' : 'phone'}
              title={locale === 'en' ? c.title_en : c.title_ar}
              subtitle={c.available ? (locale === 'en' ? c.body_en : c.body_ar) : undefined}
              trailing={c.available ? undefined : <StatusPill size="sm" label={t('wallet.soon_badge')} />}
              chevron={false}
              divider={i < list.length - 1}
            />
          ))}
        </Card>
        {topup.data && topup.data.agents.length > 0 ? (
          <View style={{ gap: theme.space[2] }}>
            <Text variant="label" color="textMuted">
              {t('wallet.agents_near')}
            </Text>
            <Card elevation={0} padding={0}>
              {topup.data.agents.map((a, i, list) => (
                <ListRow
                  key={a.id}
                  leading="map-pin"
                  title={locale === 'en' ? a.name_en : a.name_ar}
                  subtitle={`${locale === 'en' ? a.zoneName_en : a.zoneName_ar} · ${locale === 'en' ? a.hours_en : a.hours_ar}`}
                  chevron={false}
                  divider={i < list.length - 1}
                />
              ))}
            </Card>
            {topup.data.placeholder ? (
              <Text variant="caption" color="textMuted">
                {t('wallet.agents_placeholder')}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('wallet.history')} />
        {lines.isPending ? (
          <Skeleton height={120} />
        ) : lines.isError ? (
          <EmptyState icon="x" title={apiErrorMessage(lines.error, t('error.network'), locale)} action={{ label: t('action.retry'), onPress: () => void lines.refetch() }} />
        ) : allLines.length === 0 ? (
          <EmptyState icon="receipt" title={t('wallet.lines_empty_title')} body={t('wallet.lines_empty_body')} />
        ) : (
          <>
            {/* w8: filters, then one card per day; each line opens what it was. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2] }} testID="wallet-filters">
              {WALLET_FILTERS.map((f) => (
                <Chip key={f} testID={`wallet-filter-${f}`} role="radio" label={t(`wallet.filter_${f}` as MessageKey)} selected={filter === f} onPress={() => setFilter(f)} />
              ))}
            </ScrollView>
            {days.length === 0 ? (
              <Text variant="footnote" color="textMuted" testID="wallet-filter-empty">
                {t('wallet.filter_empty')}
              </Text>
            ) : (
              days.map((d) => (
                <View key={d.id} style={{ gap: theme.space[2] }} testID={`wallet-day-${d.id}`}>
                  <Text variant="label" weight={600} color="textMuted" accessibilityRole="header">
                    {dayLabel(t, d.day)}
                  </Text>
                  <Card elevation={0} padding={0} testID="wallet-lines">
                    {d.lines.map((l, i) => (
                      <LineRow key={l.id} line={l} divider={i < d.lines.length - 1} onPress={lineHref(l) ? () => open(l) : undefined} />
                    ))}
                  </Card>
                </View>
              ))
            )}
          </>
        )}
      </View>
    </Screen>
  );
}

function LineRow({ line, divider, onPress }: { line: WalletLine; divider: boolean; onPress?: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const detail = locale === 'en' ? line.detail_en : line.detail_ar;
  const positive = line.amount > 0;
  // Paid in cash at the door: the price for the record, muted, never a red-letter debit.
  const outside = paidOutsideWallet(line);
  return (
    <ListRow
      leading={KIND_ICON[line.kind]}
      title={locale === 'en' ? line.title_en : line.title_ar}
      subtitle={[detail, line.reference ? t('wallet.money_in_ref', { ref: line.reference }) : null, formatClock(line.occurredAt)].filter(Boolean).join(' · ')}
      trailing={
        <Text variant="label" tabular color={outside ? theme.colors.textMuted : positive ? (line.unit === 'points' ? theme.colors.accentText : theme.colors.successText) : theme.colors.text}>
          {lineAmount(line, locale, t)}
        </Text>
      }
      chevron={Boolean(onPress)}
      onPress={onPress}
      divider={divider}
    />
  );
}
