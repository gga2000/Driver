import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import type { WalletLine, WalletLineKind } from '@driver/contracts';
import type { IconName } from '@driver/ui';
import { Button, Card, EmptyState, Icon, ListRow, Skeleton, StatusPill, Text, useTheme, useToast, withAlpha } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { ApprovalCard } from '@/features/account/ApprovalCard';
import { useClaimPoints, useHousehold, useTopUpStatus, useTopupOptions, useWalletBalance, useWalletLines } from '@/features/account/queries';
import { balanceText, lineAmount, lineWhen, pointsWorthText } from '@/features/account/wallet-format';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { color } from '@driver/design-tokens';
import { GuestGate } from '@/components/GuestGate';
import { useSignedIn } from '@/lib/session';

const KIND_ICON: Record<WalletLineKind, IconName> = {
  food: 'bag',
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
  const b = balance.data;

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
          {b ? (
            <Text testID="wallet-balance" variant="display" color={b.moneyIqd < 0 ? theme.colors.warning : theme.colors.bg} tabular>
              {balanceText(b.moneyIqd, locale, t)}
            </Text>
          ) : (
            <Skeleton height={40} width="60%" />
          )}
          <Text variant="footnote" color={theme.colors.border}>
            {b && b.moneyIqd < 0 ? t('wallet.owe_body') : t('wallet.balance_body')}
          </Text>
          <Button testID="wallet-topup" icon="plus" label={t('wallet.topup_cta')} onPress={() => router.push('/topup')} style={{ marginTop: theme.space[2] }} />
          {pendingTopUp?.state === 'pending' ? (
            <Pressable
              testID="wallet-topup-pending"
              accessibilityRole="button"
              onPress={() => router.push('/topup')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: 'rgba(255,255,255,0.10)' }}
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

      <Card padding={5} tone="tint" testID="wallet-points">
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
          <Text variant="footnote" color="textMuted">
            {t('points.redeem_rule')}
          </Text>
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
        ) : (lines.data?.lines ?? []).length === 0 ? (
          <EmptyState icon="receipt" title={t('empty.wallet')} body={t('empty.points')} />
        ) : (
          <Card elevation={0} padding={0} testID="wallet-lines">
            {lines.data!.lines.map((l, i, list) => (
              <LineRow key={l.id} line={l} divider={i < list.length - 1} />
            ))}
          </Card>
        )}
      </View>
    </Screen>
  );
}

function LineRow({ line, divider }: { line: WalletLine; divider: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const detail = locale === 'en' ? line.detail_en : line.detail_ar;
  const positive = line.amount > 0;
  return (
    <ListRow
      leading={KIND_ICON[line.kind]}
      title={locale === 'en' ? line.title_en : line.title_ar}
      subtitle={[detail, lineWhen(line.occurredAt, new Date(), t)].filter(Boolean).join(' · ')}
      trailing={
        <Text variant="label" tabular color={positive ? (line.unit === 'points' ? theme.colors.accentText : theme.colors.successText) : theme.colors.text}>
          {lineAmount(line, locale, t)}
        </Text>
      }
      chevron={false}
      divider={divider}
    />
  );
}
