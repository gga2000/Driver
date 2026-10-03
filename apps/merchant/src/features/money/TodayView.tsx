import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { CashHandover, MerchantCashAccount, MoneyToday, SettlementRequestView } from '@driver/contracts';
import { Avatar, Button, Skeleton, Text, usePulse, useTheme, useToast } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { ModalSheet } from '@/components/ModalSheet';
import { Meter, Panel, PanelRow, Tag } from '@/components/Panel';
import { apiErrorMessage } from '@/lib/api';
import { useDates } from '@/lib/dates';
import { useLocale, useT, type TKey } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { amountParam, iqd } from '@/lib/money';
import { clock12 } from '@/lib/time';
import { canRequest, exposure, holderRows, requestProgress } from './logic';
import { useRequestMoney } from './queries';

const TONE_COLOR = { success: 'success', warning: 'warning', danger: 'danger', neutral: 'textMuted' } as const;

/** الفلوس → اليوم: the cash account (balance, cap, who holds it, "اطلب فلوسك"), today's sales, hand-overs. */
export function TodayView({
  merchantOrgId,
  today,
  cash,
  now,
  wide,
  onStatement,
}: {
  merchantOrgId: string;
  today: MoneyToday | undefined;
  cash: MerchantCashAccount | undefined;
  now: number;
  wide: boolean;
  onStatement: () => void;
}) {
  const theme = useTheme();
  const [receipt, setReceipt] = useState<CashHandover | null>(null);
  const start = (
    <>
      {cash ? <CashHero account={cash} merchantOrgId={merchantOrgId} onReceipt={setReceipt} /> : <Skeleton height={300} radius={20} />}
      {cash ? <HoldersPanel account={cash} /> : null}
    </>
  );
  const end = (
    <>
      {today ? <SalesPanel today={today} now={now} onStatement={onStatement} /> : <Skeleton height={320} radius={20} />}
      {cash ? <HandoversPanel handovers={cash.handovers} now={now} onOpen={setReceipt} /> : null}
    </>
  );
  return (
    <>
      {wide ? (
        <View style={{ flexDirection: 'row', gap: theme.space[5], alignItems: 'flex-start' }}>
          <View style={{ flex: 1.05, gap: theme.space[5] }}>{start}</View>
          <View style={{ flex: 1, gap: theme.space[5] }}>{end}</View>
        </View>
      ) : (
        <View style={{ gap: theme.space[4] }}>
          {start}
          {end}
        </View>
      )}
      <ReceiptSheet handover={receipt} onClose={() => setReceipt(null)} now={now} />
    </>
  );
}

// ───────────────────────── cash account ─────────────────────────

function CashHero({ account, merchantOrgId, onReceipt }: { account: MerchantCashAccount; merchantOrgId: string; onReceipt: (h: CashHandover) => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const request = useRequestMoney();
  const ex = exposure(account.balanceIqd, account.exposureCapIqd);
  const negative = account.balanceIqd < 0;
  const ask = async () => {
    try {
      await request.mutateAsync({ merchantId: merchantOrgId });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };
  const open = account.request && account.request.state !== 'handed_over' ? account.request : null;
  const justDone = account.request && account.request.state === 'handed_over' ? account.request : null;
  return (
    <View
      testID="cash-hero"
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius['2xl'],
        borderWidth: 1,
        borderColor: theme.colors.border,
        shadowColor: theme.colors.shadow,
        shadowOpacity: 0.08,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 6 },
        overflow: 'hidden',
      }}
    >
      <View style={{ padding: theme.space[5], gap: theme.space[4] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: theme.colors.successTint, alignItems: 'center', justifyContent: 'center' }}>
            <MIcon name="cash" size={24} color="successText" strokeWidth={1.9} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="title">{t('merchant.money.cash_title')}</Text>
            <Text variant="footnote" color="textMuted" numberOfLines={1}>
              {t(`merchant.money.mode_${account.mode}` as TKey)}
            </Text>
          </View>
        </View>

        <View style={{ gap: 2 }}>
          <Text variant="label" color="textMuted">
            {negative ? t('merchant.money.cash_negative', { amount: amountParam(-account.balanceIqd) }) : t('merchant.money.cash_caption')}
          </Text>
          <Text testID="cash-balance" weight={700} tabular color={negative ? 'dangerText' : 'text'} style={{ fontSize: 44, lineHeight: 58, letterSpacing: -0.5 }}>
            {iqd(account.balanceIqd, { locale })}
          </Text>
        </View>

        <View style={{ gap: theme.space[2] }}>
          <Meter value={ex.fill} color={theme.colors[TONE_COLOR[ex.tone]]} height={12} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[3] }}>
            <Text variant="footnote" weight={600} color={ex.tone === 'danger' ? 'dangerText' : ex.tone === 'warning' ? 'warningText' : 'successText'} tabular>
              {ex.over ? t('merchant.money.cap_over') : t('merchant.money.cap_left', { amount: amountParam(ex.leftIqd) })}
            </Text>
            <Text variant="footnote" color="textMuted" tabular>
              {t('merchant.money.cap_label', { amount: amountParam(account.exposureCapIqd) })}
            </Text>
          </View>
          {!ex.over ? (
            <Text variant="caption" color="textMuted">
              {t('merchant.money.cap_hint')}
            </Text>
          ) : null}
        </View>

        {open ? null : canRequest(account) ? (
          <View style={{ gap: theme.space[2] }}>
            <Button testID="money-request" label={t('merchant.request_money')} icon="wallet" size="lg" fullWidth loading={request.isPending} onPress={() => void ask()} />
            <Text variant="caption" color="textMuted" align="center">
              {t('merchant.money.request_hint')}
            </Text>
          </View>
        ) : null}
      </View>
      {open || justDone ? <RequestTrack request={(open ?? justDone)!} onReceipt={onReceipt} /> : null}
    </View>
  );
}

/** "اطلب فلوسك" as it moves: requested → courier on the way → handed over with the PIN. */
function RequestTrack({ request, onReceipt }: { request: SettlementRequestView; onReceipt: (h: CashHandover) => void }) {
  const theme = useTheme();
  const t = useT();
  const { current, done } = requestProgress(request);
  const viaCourier = request.channel === 'courier';
  const steps: Array<{ key: string; label: string; time: string | null }> = [
    { key: 'requested', label: t('merchant.money.step_requested'), time: clock12(request.requestedAt) },
    {
      key: 'on_the_way',
      label:
        request.channel === 'ops_round'
          ? t('merchant.money.step_ops')
          : request.channel === 'zaincash' || request.channel === 'bank'
            ? t('merchant.money.step_zaincash')
            : viaCourier && request.courierName
              ? t('merchant.money.step_on_the_way', { name: request.courierName })
              : t('merchant.money.step_on_the_way_generic'),
      time: request.handover ? clock12(request.handover.at) : request.targetBy ? t('merchant.money.step_target', { time: clock12(request.targetBy) }) : null,
    },
    {
      key: 'handed_over',
      label: request.handover
        ? request.handover.confirmedBy === 'tablet'
          ? t('merchant.money.step_handed_over_tablet')
          : t('merchant.money.step_handed_over')
        : t('merchant.money.step_handed_over_todo'),
      time: request.handover ? clock12(request.handover.at) : null,
    },
  ];
  return (
    <View testID={`request-${request.state}`} style={{ backgroundColor: done ? theme.colors.successTint : theme.colors.accentTint, padding: theme.space[5], gap: theme.space[4] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title" color={done ? 'successText' : 'accentText'}>
            {done ? t('merchant.money.request_done') : t('merchant.money.request_live')}
          </Text>
          <Text variant="footnote" color="textMuted" tabular>
            {request.reason === 'exposure_cap' ? t('merchant.money.request_auto') : t('merchant.money.request_amount', { amount: amountParam(request.amountIqd) })}
          </Text>
        </View>
        <Text variant="caption" color="textMuted" tabular>
          {t('merchant.money.reference', { reference: request.reference })}
        </Text>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {steps.map((s, i) => {
          const state = done || i < current ? 'done' : i === current ? 'current' : 'todo';
          return <Step key={s.key} index={i} count={steps.length} state={state} label={s.label} time={s.time} />;
        })}
      </View>
      {done && request.handover ? (
        <Button
          testID="request-receipt"
          label={t('merchant.money.received', { amount: amountParam(request.handover.amountIqd) })}
          icon="receipt"
          variant="secondary"
          onPress={() => onReceipt(request.handover!)}
        />
      ) : viaCourier ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
          <MIcon name="shield" size={18} color="accentText" />
          <Text variant="footnote" style={{ flex: 1 }}>
            {t('merchant.money.pin_hint')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Step({ index, count, state, label, time }: { index: number; count: number; state: 'done' | 'current' | 'todo'; label: string; time: string | null }) {
  const theme = useTheme();
  const pulse = usePulse(state === 'current');
  const color = state === 'done' ? theme.colors.success : state === 'current' ? theme.colors.accent : theme.colors.borderStrong;
  const line = (on: boolean) => <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: on ? theme.colors.success : theme.colors.border }} />;
  return (
    <View testID={`step-${index}-${state}`} style={{ flex: 1, alignItems: 'center', gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' }}>
        {index === 0 ? <View style={{ flex: 1 }} /> : line(state !== 'todo')}
        <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
          {state === 'current' ? <Animated.View style={[{ position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: color }, pulse]} /> : null}
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: state === 'todo' ? theme.colors.surface : color,
              borderWidth: state === 'todo' ? 2 : 0,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {state === 'done' ? <MIcon name="check" size={16} color="surface" strokeWidth={3} /> : state === 'current' ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.onAccent }} /> : null}
          </View>
        </View>
        {index === count - 1 ? <View style={{ flex: 1 }} /> : line(state === 'done')}
      </View>
      <View style={{ alignItems: 'center', paddingHorizontal: theme.space[1], gap: 0 }}>
        <Text variant="footnote" weight={state === 'current' ? 700 : 600} color={state === 'todo' ? 'textMuted' : 'text'} align="center" numberOfLines={2}>
          {label}
        </Text>
        {time ? (
          <Text variant="caption" color={state === 'current' ? 'accentText' : 'textMuted'} weight={state === 'current' ? 600 : 400} align="center" tabular>
            {time}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ───────────────────────── who holds the money ─────────────────────────

function HoldersPanel({ account }: { account: MerchantCashAccount }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const rows = holderRows(account);
  return (
    <Panel title={t('merchant.money.holders_title')} icon="people" flush testID="holders">
      {rows.length === 0 ? (
        <Text variant="body" color="textMuted" style={{ paddingHorizontal: theme.space[5] }}>
          {t('merchant.money.holders_none')}
        </Text>
      ) : (
        rows.map((r, i) => (
          <PanelRow key={r.key} first={i === 0}>
            {r.kind === 'courier' ? (
              <Avatar name={r.name ?? undefined} icon={r.name ? undefined : 'bike'} size={40} tone="warning" />
            ) : (
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.text, alignItems: 'center', justifyContent: 'center' }}>
                <MIcon name="wallet" size={20} color={theme.colors.accent} strokeWidth={2} />
              </View>
            )}
            <View style={{ flex: 1, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
                <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {r.kind === 'courier' ? (r.name ?? t('merchant.money.holder_courier')) : t('merchant.money.holder_platform')}
                </Text>
                <Text variant="caption" color="textMuted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {r.kind === 'courier' ? t('merchant.money.holder_courier') : t('merchant.money.holder_platform_hint')}
                </Text>
              </View>
              <Meter value={r.share} color={r.kind === 'courier' ? theme.colors.warning : theme.colors.text} height={6} />
            </View>
            <Text variant="bodyStrong" tabular align="end" style={{ minWidth: 96 }}>
              {iqd(r.amountIqd, { locale })}
            </Text>
          </PanelRow>
        ))
      )}
    </Panel>
  );
}

// ───────────────────────── today's sales ─────────────────────────

function SalesPanel({ today, now, onStatement }: { today: MoneyToday; now: number; onStatement: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const dates = useDates();
  const commissionShare = today.salesIqd > 0 ? today.commissionIqd / today.salesIqd : 0;
  return (
    <Panel
      title={t('merchant.money.sales_title')}
      caption={`${dates.day(now, now)} · ${t('merchant.money.sales_orders', { count: today.orders })}`}
      icon="chart"
      testID="sales"
      aside={<Button label={t('merchant.money.tab_statement')} variant="ghost" size="sm" onPress={onStatement} testID="sales-statement" />}
    >
      {today.salesIqd === 0 ? (
        <Text variant="body" color="textMuted">
          {t('merchant.money.no_sales')}
        </Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
            <Figure label={t('merchant.money.sales')} value={iqd(today.salesIqd, { locale })} />
            <Figure label={t('merchant.money.commission')} value={iqd(-today.commissionIqd, { locale })} muted />
          </View>
          <View style={{ backgroundColor: theme.colors.successTint, borderRadius: theme.radius.lg, padding: theme.space[4], gap: theme.space[2] }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text variant="label" weight={600} color="successText">
                {t('merchant.money.net')}
              </Text>
              <Text testID="sales-net" weight={700} color="successText" tabular style={{ fontSize: 28, lineHeight: 38 }}>
                {iqd(today.netIqd, { locale })}
              </Text>
            </View>
            {/* Net vs commission out of every dinar sold. */}
            <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: theme.colors.surface }}>
              <View style={{ flex: 1 - commissionShare, backgroundColor: theme.colors.success }} />
              <View style={{ flex: commissionShare, backgroundColor: theme.colors.accent }} />
            </View>
          </View>
          {today.commissionByTier.length > 0 ? (
            <View style={{ gap: theme.space[1] }}>
              <Text variant="label" color="textMuted">
                {t('merchant.money.tiers_title')}
              </Text>
              {today.commissionByTier.map((tier) => (
                <View key={tier.tier} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[2] }}>
                  <View style={{ minWidth: 52, height: 32, paddingHorizontal: theme.space[2], borderRadius: 10, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
                    <Text variant="label" weight={700} color="accentText" tabular>
                      {`${tier.pct}%`}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{t(`merchant.money.tier_${tier.tier}` as TKey)}</Text>
                    <Text variant="caption" color="textMuted" tabular>
                      {t('merchant.money.tier_line', { orders: tier.orders, base: iqd(tier.baseIqd, { locale }) })}
                    </Text>
                  </View>
                  <Text variant="bodyStrong" tabular>
                    {iqd(-tier.commissionIqd, { locale })}
                  </Text>
                </View>
              ))}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingTop: theme.space[1] }}>
                <MIcon name="tag" size={16} color="textMuted" />
                <Text variant="caption" color="textMuted">
                  {t('merchant.price_parity_note')}
                </Text>
              </View>
            </View>
          ) : null}
        </>
      )}
    </Panel>
  );
}

function Figure({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3], gap: 2 }}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <Text variant="title" weight={700} color={muted ? 'textMuted' : 'text'} tabular numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

// ───────────────────────── hand-overs and the receipt ─────────────────────────

function HandoversPanel({ handovers, now, onOpen }: { handovers: CashHandover[]; now: number; onOpen: (h: CashHandover) => void }) {
  const theme = useTheme();
  const { wide } = useLayout();
  const t = useT();
  const locale = useLocale();
  const dates = useDates();
  return (
    <Panel title={t('merchant.money.handovers_title')} icon="receipt" flush testID="handovers">
      {handovers.length === 0 ? (
        <Text variant="body" color="textMuted" style={{ paddingHorizontal: theme.space[5] }}>
          {t('merchant.money.handovers_none')}
        </Text>
      ) : (
        handovers.slice(0, 6).map((h, i) => (
          <PanelRow key={h.handoverId} first={i === 0} onPress={() => onOpen(h)} testID={`handover-${i}`}>
            <Avatar name={h.courierName ?? undefined} icon={h.courierName ? undefined : 'bike'} size={40} tone="warning" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {h.courierName ?? t('merchant.money.holder_courier')}
              </Text>
              <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
                {wide || !h.confirmedBy ? dates.when(h.at, now) : `${dates.day(h.at, now)} ${clock12(h.at)} · ${t(h.confirmedBy === 'pin' ? 'merchant.money.confirmed_pin' : 'merchant.money.confirmed_tablet')}`}
              </Text>
            </View>
            {h.confirmedBy && wide ? <Tag label={t(h.confirmedBy === 'pin' ? 'merchant.money.confirmed_pin' : 'merchant.money.confirmed_tablet')} tone="success" icon="check" /> : null}
            <Text variant="bodyStrong" tabular align="end" style={{ minWidth: 92 }}>
              {iqd(h.amountIqd, { locale })}
            </Text>
            <MIcon name="chevron-forward" size={18} color="textMuted" />
          </PanelRow>
        ))
      )}
    </Panel>
  );
}

function ReceiptSheet({ handover, onClose, now }: { handover: CashHandover | null; onClose: () => void; now: number }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const dates = useDates();
  if (!handover) return null;
  const rows: Array<[string, string]> = [
    [t('merchant.money.receipt_number'), `⁦${handover.handoverId.toUpperCase().slice(-10)}⁩`],
    [t('merchant.money.receipt_courier'), handover.courierName ?? t('merchant.money.holder_courier')],
    [t('merchant.money.receipt_time'), dates.when(handover.at, now)],
    [t('merchant.money.receipt_confirmed'), handover.confirmedBy === 'tablet' ? t('merchant.money.receipt_confirmed_tablet') : t('merchant.money.receipt_confirmed_pin')],
    [t('merchant.money.receipt_balance_after'), iqd(handover.balanceAfterIqd, { locale })],
  ];
  return (
    <ModalSheet visible onClose={onClose} title={t('merchant.money.receipt_title')} testID="receipt-sheet">
      <View style={{ backgroundColor: theme.colors.bg, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' }}>
        <View style={{ alignItems: 'center', gap: theme.space[1], paddingVertical: theme.space[5], backgroundColor: theme.colors.successTint }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center' }}>
            <MIcon name="check" size={26} color="surface" strokeWidth={3} />
          </View>
          <Text variant="label" color="successText">
            {t('merchant.money.receipt_amount')}
          </Text>
          <Text weight={700} tabular color="successText" style={{ fontSize: 36, lineHeight: 48 }}>
            {iqd(handover.amountIqd, { locale })}
          </Text>
        </View>
        <View style={{ height: 0, borderTopWidth: 2, borderStyle: 'dashed', borderColor: theme.colors.border }} />
        <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
          {rows.map(([k, v]) => (
            <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[3] }}>
              <Text variant="body" color="textMuted">
                {k}
              </Text>
              <Text variant="bodyStrong" tabular align="end" style={{ flexShrink: 1 }}>
                {v}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <MIcon name="chat" size={18} color="textMuted" />
        <Text variant="footnote" color="textMuted">
          {t('merchant.money.receipt_whatsapp')}
        </Text>
      </View>
    </ModalSheet>
  );
}
