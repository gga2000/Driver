import { useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import type { StatementOrderLine, WeeklyStatement } from '@driver/contracts';
import { formatRange } from '@driver/i18n';
import { Button, IconButton, Skeleton, Text, useTheme } from '@driver/ui';
import { useCounterToast } from '@/lib/toast';
import { MIcon } from '@/components/MIcon';
import { ModalSheet } from '@driver/ui';
import { Panel, PanelRow, Tag } from '@/components/Panel';
import { useDates } from '@/lib/dates';
import { useLocale, useT, type TKey } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { clock12 } from '@/lib/time';
import { statementBridge, statementDays, ticketNumber, type BridgeTerm } from './logic';

const PAY_TONE = { cash: 'warning', wallet: 'neutral', prepaid: 'neutral' } as const;

/** الفلوس → كشف الأسبوع: per-order lines (Sunday-start week), totals, hand-overs and transfers, share. */
export function StatementView({
  statement,
  storeName,
  back,
  onBack,
  onForward,
  now,
  wide,
}: {
  statement: WeeklyStatement | undefined;
  storeName: string;
  back: number;
  onBack: () => void;
  onForward: () => void;
  now: number;
  wide: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const dates = useDates();
  const toast = useCounterToast();
  const range = statement ? formatRange(dates.dayMonth(statement.from), dates.dayMonth(new Date(statement.to.getTime() - 1)), locale, { spaced: true }) : '';

  const share = async () => {
    if (!statement) return;
    const tot = statement.totals;
    const message = t('merchant.statement.share_text', {
      store: storeName,
      range,
      orders: tot.orders,
      items: amountParam(tot.itemsIqd),
      commission: amountParam(tot.commissionIqd),
      net: amountParam(tot.netIqd),
    });
    try {
      await Share.share({ message });
    } catch {
      toast.show({ message: t('merchant.statement.share_failed'), tone: 'neutral' });
    }
  };

  const nav = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      <IconButton icon="chevron-back" variant="outline" accessibilityLabel={t('merchant.statement.prev')} onPress={onBack} testID="week-prev" />
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text variant="title" tabular testID="week-range">
          {range || ' '}
        </Text>
        <Text variant="caption" color="textMuted">
          {back === 0 ? t('merchant.statement.this_week') : ' '}
        </Text>
      </View>
      <IconButton icon="chevron-forward" variant="outline" accessibilityLabel={t('merchant.statement.next')} onPress={onForward} disabled={back === 0} testID="week-next" />
    </View>
  );

  if (!statement) {
    return (
      <View style={{ gap: theme.space[4] }}>
        {nav}
        <Skeleton height={160} radius={20} />
        <Skeleton height={360} radius={20} />
      </View>
    );
  }
  const tot = statement.totals;
  const days = statementDays(statement.lines);
  return (
    <View style={{ gap: theme.space[5] }}>
      {nav}
      <Panel testID="statement-summary">
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: theme.space[4], alignItems: wide ? 'center' : 'stretch' }}>
          <View style={{ flex: wide ? 1.2 : undefined, gap: 2 }}>
            <Text variant="label" color="textMuted">
              {t('merchant.statement.net')}
            </Text>
            <Text variant="numeralMd" color="successText" testID="statement-net">
              {iqd(tot.netIqd, { locale })}
            </Text>
            <Text variant="footnote" color="textMuted" tabular>
              {t('merchant.statement.day_total', { orders: tot.orders, net: iqd(tot.netIqd, { locale }) })}
            </Text>
          </View>
          <View style={{ flex: wide ? 2 : undefined, flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            <Cell label={t('merchant.statement.items')} value={iqd(tot.itemsIqd, { locale })} />
            <Cell label={t('merchant.statement.commission')} value={iqd(-tot.commissionIqd, { locale })} />
            <Cell label={t('merchant.statement.settled')} value={iqd(tot.settledIqd, { locale })} />
            <Cell label={t('merchant.statement.closing')} value={iqd(statement.closingIqd, { locale })} strong />
          </View>
        </View>
        <Bridge statement={statement} wide={wide} now={now} />
        <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'stretch', gap: theme.space[3], borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.space[4] }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <MIcon name="chat" size={16} color="textMuted" />
            <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
              {t('merchant.statement.pdf_note')}
            </Text>
          </View>
          <Button label={t('merchant.statement.share')} icon="share" variant="secondary" onPress={() => void share()} testID="statement-share" />
        </View>
      </Panel>

      <Panel title={t('merchant.statement.lines_title')} caption={t('merchant.statement.opening') + ' ' + iqd(statement.openingIqd, { locale })} icon="receipt" flush testID="statement-lines">
        {days.length === 0 ? (
          <Text variant="body" color="textMuted" style={{ paddingHorizontal: theme.space[5] }}>
            {t('merchant.statement.empty')}
          </Text>
        ) : wide ? (
          <Table days={days} now={now} />
        ) : (
          days.map((d) => (
            <View key={d.key}>
              <DayHeader label={dates.day(d.at, now)} orders={d.orders} netIqd={d.netIqd} />
              {d.lines.map((l, i) => (
                <PhoneLine key={l.orderId} line={l} first={i === 0} />
              ))}
            </View>
          ))
        )}
      </Panel>

      {statement.settlements.length > 0 ? (
        <Panel title={t('merchant.statement.settlements_title')} icon="wallet" flush testID="statement-settlements">
          {[...statement.settlements]
            .sort((a, b) => b.at.getTime() - a.at.getTime())
            .map((s, i) => (
              <PanelRow key={`${s.at.getTime()}-${i}`} first={i === 0}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: s.kind === 'payout' ? theme.colors.surfaceSunken : theme.colors.successTint, alignItems: 'center', justifyContent: 'center' }}>
                  <MIcon name={s.kind === 'payout' ? 'wallet' : 'cash'} size={20} color={s.kind === 'payout' ? 'text' : 'successText'} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{t(s.kind === 'payout' ? 'merchant.statement.payout' : 'merchant.statement.handover')}</Text>
                  <Text variant="caption" color="textMuted" tabular>
                    {dates.when(s.at, now)}
                    {s.reference ? ` · ⁦${s.reference}⁩` : ''}
                  </Text>
                </View>
                <Text variant="bodyStrong" tabular color="successText">
                  {iqd(s.amountIqd, { locale })}
                </Text>
              </PanelRow>
            ))}
        </Panel>
      ) : null}
    </View>
  );
}

function Cell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexGrow: 1, flexBasis: '45%', backgroundColor: strong ? theme.colors.accentTint : theme.colors.surfaceSunken, borderRadius: theme.radius.lg, paddingVertical: theme.space[3], paddingHorizontal: theme.space[3], gap: 2 }}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <Text variant="bodyStrong" weight={700} tabular>
        {value}
      </Text>
    </View>
  );
}

function DayHeader({ label, orders, netIqd }: { label: string; orders: number; netIqd: number }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space[5], paddingVertical: theme.space[2], backgroundColor: theme.colors.surfaceSunken, gap: theme.space[3] }}>
      <Text variant="label" weight={700} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="caption" color="textMuted" tabular>
        {t('merchant.statement.day_total', { orders, net: iqd(netIqd, { locale }) })}
      </Text>
    </View>
  );
}

function PayTag({ line }: { line: StatementOrderLine }) {
  const t = useT();
  return <Tag label={t(`merchant.statement.pay_${line.payment}` as TKey)} tone={PAY_TONE[line.payment]} />;
}

/**
 * "الخصم 3,000 عرضك · تقريب +250": the deal at its exact promised saving, who funded it, and what
 * rounding the customer's total up to the step gave back (the net already counts only the cost).
 */
function discountText(line: StatementOrderLine, t: ReturnType<typeof useT>): string {
  const who = t(line.discountFunder === 'merchant' ? 'merchant.statement.discount_merchant' : 'merchant.statement.discount_platform');
  const head = `${t('merchant.statement.discount')} ${amountParam(line.dealIqd || line.discountIqd)} ${who}`;
  return line.roundingIqd > 0 ? `${head} · ${t('merchant.statement.rounding_back', { amount: amountParam(line.roundingIqd) })}` : head;
}

function PhoneLine({ line, first }: { line: StatementOrderLine; first: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  return (
    <PanelRow first={first} testID={`line-${line.orderId}`}>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Text variant="bodyStrong" tabular>
            {t('merchant.statement.order_ref', { ref: ticketNumber(line.orderId) })}
          </Text>
          <Text variant="caption" color="textMuted" tabular>
            {clock12(line.at)}
          </Text>
          <PayTag line={line} />
        </View>
        <Text variant="caption" color="textMuted" tabular>
          {[
            iqd(line.itemsIqd, { locale }),
            line.commissionPct !== null ? `${t('merchant.statement.commission_line', { pct: line.commissionPct })} ${iqd(-line.commissionIqd, { locale })}` : null,
            line.discountIqd > 0 ? discountText(line, t) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <Text variant="bodyStrong" tabular>
        {iqd(line.netIqd, { locale })}
      </Text>
    </PanelRow>
  );
}

/** Tablet: one table, a header row, day bands, right-aligned figures. */
function Table({ days, now }: { days: ReturnType<typeof statementDays>; now: number }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const dates = useDates();
  const col = { order: 1.5, pay: 1, items: 1.2, discount: 1.2, rate: 0.7, commission: 1.1, net: 1.2 };
  const head = (label: string, flex: number, end?: boolean) => (
    <Text variant="caption" weight={600} color="textMuted" align={end ? 'end' : 'start'} style={{ flex }}>
      {label}
    </Text>
  );
  return (
    <View>
      <View style={{ flexDirection: 'row', paddingHorizontal: theme.space[5], paddingBottom: theme.space[2], gap: theme.space[3] }}>
        {head(t('merchant.statement.col_order'), col.order)}
        {head(t('merchant.statement.col_payment'), col.pay)}
        {head(t('merchant.statement.items'), col.items, true)}
        {head(t('merchant.statement.discount'), col.discount, true)}
        {head(t('merchant.statement.col_rate'), col.rate, true)}
        {head(t('merchant.statement.commission'), col.commission, true)}
        {head(t('merchant.statement.net'), col.net, true)}
      </View>
      {days.map((d) => (
        <View key={d.key}>
          <DayHeader label={dates.day(d.at, now)} orders={d.orders} netIqd={d.netIqd} />
          {d.lines.map((l, i) => (
            <View
              key={l.orderId}
              testID={`line-${l.orderId}`}
              style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: theme.space[5], gap: theme.space[3], borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.colors.border }}
            >
              <View style={{ flex: col.order, flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
                <Text variant="bodyStrong" tabular>
                  {t('merchant.statement.order_ref', { ref: ticketNumber(l.orderId) })}
                </Text>
                <Text variant="caption" color="textMuted" tabular>
                  {clock12(l.at)}
                </Text>
              </View>
              <View style={{ flex: col.pay }}>
                <PayTag line={l} />
              </View>
              <Text variant="body" tabular align="end" style={{ flex: col.items }}>
                {amountParam(l.itemsIqd)}
              </Text>
              <View style={{ flex: col.discount, alignItems: 'flex-end' }}>
                {l.discountIqd > 0 ? (
                  <>
                    <Text variant="body" tabular color="textMuted">
                      {amountParam(-(l.dealIqd || l.discountIqd))}
                    </Text>
                    <Text variant="caption" color="textMuted">
                      {t(l.discountFunder === 'merchant' ? 'merchant.statement.discount_merchant' : 'merchant.statement.discount_platform')}
                    </Text>
                    {l.roundingIqd > 0 ? (
                      <Text variant="caption" color="textMuted" tabular testID={`line-${l.orderId}-rounding`}>
                        {t('merchant.statement.rounding_back', { amount: amountParam(l.roundingIqd) })}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text variant="body" color="textMuted">
                    —
                  </Text>
                )}
              </View>
              <Text variant="body" tabular color="textMuted" align="end" style={{ flex: col.rate }}>
                {l.commissionPct !== null ? `${l.commissionPct}%` : '—'}
              </Text>
              <Text variant="body" tabular align="end" style={{ flex: col.commission }}>
                {amountParam(-l.commissionIqd)}
              </Text>
              <Text variant="bodyStrong" tabular align="end" style={{ flex: col.net }}>
                {amountParam(l.netIqd)}
              </Text>
            </View>
          ))}
        </View>
      ))}
      <View style={{ flexDirection: 'row', paddingHorizontal: theme.space[5], paddingTop: theme.space[3], borderTopWidth: 2, borderTopColor: theme.colors.text, gap: theme.space[3] }}>
        <Text variant="bodyStrong" style={{ flex: col.order + col.pay }}>
          {t('merchant.statement.net')}
        </Text>
        <Text variant="bodyStrong" tabular align="end" style={{ flex: col.items }}>
          {amountParam(days.reduce((s, d) => s + d.itemsIqd, 0))}
        </Text>
        <View style={{ flex: col.discount + col.rate }} />
        <Text variant="bodyStrong" tabular align="end" style={{ flex: col.commission }}>
          {amountParam(-days.reduce((s, d) => s + d.commissionIqd, 0))}
        </Text>
        <Text variant="bodyStrong" tabular align="end" color="successText" style={{ flex: col.net }}>
          {iqd(days.reduce((s, d) => s + d.netIqd, 0), { locale })}
        </Text>
      </View>
    </View>
  );
}

/**
 * M-17 · the bridge: "رصيد أول الأسبوع + الصافي − اللي استلمته (+ تعديلات) = رصيد آخر الأسبوع", the
 * four numbers that never added up on screen now reconcile in one row. "اللي استلمته" opens its lines.
 */
function Bridge({ statement, wide, now }: { statement: WeeklyStatement; wide: boolean; now: number }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const dates = useDates();
  const [open, setOpen] = useState(false);
  const { terms } = statementBridge(statement);
  const byKey = Object.fromEntries(terms.map((x) => [x.key, iqd(x.amountIqd, { locale })]));
  const cell = (term: BridgeTerm) => {
    const last = term.key === 'closing';
    const body = (
      <View style={{ gap: 2, alignItems: 'flex-start' }}>
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          {t(term.label)}
        </Text>
        <Text variant={last ? 'bodyStrong' : 'label'} weight={last ? 700 : 600} tabular color={term.key === 'settled' ? 'accentText' : 'text'}>
          {iqd(term.amountIqd, { locale })}
        </Text>
      </View>
    );
    // On a phone the terms wrap, so every term (the opening too, blank) keeps a fixed operator gutter:
    // the rows share one start edge and «−» / «=» sit inside the box, not out past «رصيد أول الأسبوع».
    const gutter = wide ? undefined : { width: theme.space[4], alignItems: 'center' as const };
    return (
      <View key={term.key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexShrink: 1 }}>
        {term.op ? (
          <Text variant="title" weight={700} color="textMuted" align="center" accessibilityElementsHidden importantForAccessibility="no" style={gutter}>
            {term.op}
          </Text>
        ) : gutter ? (
          <View style={gutter} />
        ) : null}
        {term.key === 'settled' ? (
          <Pressable testID="bridge-settled" accessibilityRole="button" accessibilityLabel={`${t(term.label)} ${iqd(term.amountIqd, { locale })}`} onPress={() => setOpen(true)} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.space[2], borderRadius: theme.radius.md, backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.accentTint })}>
            {body}
          </Pressable>
        ) : (
          <View style={{ minHeight: 44, justifyContent: 'center' }}>{body}</View>
        )}
      </View>
    );
  };
  return (
    <View
      testID="statement-bridge"
      accessible={false}
      accessibilityLabel={t('merchant.bridge.a11y', { opening: byKey['opening'] ?? '', net: byKey['net'] ?? '', settled: byKey['settled'] ?? '', closing: byKey['closing'] ?? '' })}
      style={{ gap: theme.space[2], borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.space[4] }}
    >
      <Text variant="label" weight={700}>
        {t('merchant.bridge.title')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: wide ? theme.space[4] : theme.space[3], rowGap: theme.space[2] }}>{terms.map(cell)}</View>
      <ModalSheet visible={open} onClose={() => setOpen(false)} title={t('merchant.bridge.settled_sheet')} testID="bridge-settled-sheet">
        {statement.settlements.length === 0 ? (
          <Text variant="body" color="textMuted">
            {t('merchant.bridge.settled_empty')}
          </Text>
        ) : (
          statement.settlements.map((x, i) => (
            <View key={`${x.at.getTime()}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 56, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.colors.border }}>
              <MIcon name={x.kind === 'courier_handover' ? 'cash' : 'swap'} size={20} color="textMuted" />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" weight={600}>
                  {t(x.kind === 'courier_handover' ? 'merchant.bridge.settled_row_handover' : 'merchant.bridge.settled_row_payout')}
                </Text>
                <Text variant="caption" color="textMuted" tabular>
                  {`${dates.day(x.at, now)} · ${clock12(x.at)}${x.reference ? ` · ${x.reference}` : ''}`}
                </Text>
              </View>
              <Text variant="label" weight={700} tabular>
                {iqd(x.amountIqd, { locale })}
              </Text>
            </View>
          ))
        )}
      </ModalSheet>
    </View>
  );
}
