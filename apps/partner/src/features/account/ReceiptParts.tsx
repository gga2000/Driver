import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import type { JobReceipt } from '@driver/contracts';
import { Button, Card, ChipGroup, formatWhen, Icon, Rule, Text, TextField, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { ModalSheet } from './ModalSheet';
import { usePayQuery } from './queries';
import { disputePrefill, receiptRows, receiptTitle } from './receipt-logic';

/** Which job, when (Baghdad clock), and what he kept: the one big number. */
export function ReceiptHead({ r }: { r: JobReceipt }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Card elevation={1} padding={5} testID="receipt-head">
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[3], paddingVertical: theme.space[1] }}>
            <Icon name="receipt" size={16} color="textMuted" />
            <Text testID="receipt-ticket" variant="label" weight={700} tabular>
              {receiptTitle(r, t)}
            </Text>
          </View>
          <Text testID="receipt-when" variant="footnote" color="textMuted" tabular>
            {formatWhen(r.at, new Date())}
          </Text>
        </View>
        <View style={{ gap: 0 }}>
          <Text variant="label" color="textMuted">
            {t('partner.receipt_net')}
          </Text>
          <View accessible accessibilityLabel={`${t('partner.receipt_net')}: ${amountParam(r.netIqd)} ${t('quote.currency')}`} style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
            <Text testID="receipt-net" variant="numeralSm" tabular color={r.netIqd < 0 ? 'dangerText' : 'text'}>
              {amountParam(r.netIqd)}
            </Text>
            <Text variant="title" color="textMuted">
              {t('quote.currency')}
            </Text>
          </View>
        </View>
      </View>
    </Card>
  );
}

/** Every line with what it is and why, the take apart with its rate, then the net. */
export function ReceiptLines({ r }: { r: JobReceipt }) {
  const theme = useTheme();
  const t = useT();
  const rows = receiptRows(r, t);
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="title" style={{ paddingHorizontal: theme.space[1] }}>
        {t('partner.receipt_lines_title')}
      </Text>
      <Card elevation={0} padding={4} testID="receipt-lines">
        <View style={{ gap: theme.space[3] }}>
          {rows.map((row) => (
            <View key={row.key} accessible accessibilityLabel={`${row.label} ${amountParam(row.amountIqd, { sign: true })} ${t('quote.currency')}${row.reason ? `، ${row.reason}` : ''}`} style={{ gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.space[3] }}>
                <Text variant="label" weight={600} style={{ flexShrink: 1 }}>
                  {row.label}
                </Text>
                <Text variant="label" weight={700} tabular color={row.amountIqd < 0 ? 'dangerText' : row.take ? 'text' : 'successText'}>
                  {amountParam(row.amountIqd, { sign: true })}
                </Text>
              </View>
              {row.reason ? (
                <Text variant="footnote" color="textMuted">
                  {row.reason}
                </Text>
              ) : null}
            </View>
          ))}
          <Rule kind="dotted" />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="label" weight={700}>
              {t('partner.receipt_net')}
            </Text>
            <Text variant="label" weight={700} tabular>
              {`${amountParam(r.netIqd)} ${t('quote.currency')}`}
            </Text>
          </View>
        </View>
      </Card>
    </View>
  );
}

/** Cash he took at the door and where it went: the restaurant at pickup, the rest to the company. */
export function ReceiptCash({ r }: { r: JobReceipt }) {
  const theme = useTheme();
  const t = useT();
  if (!r.cash) return null;
  const rows: Array<{ key: string; icon: 'cash' | 'bag' | 'wallet'; label: string; amount: number; strong?: boolean }> = [
    { key: 'collected', icon: 'cash', label: t('partner.receipt_cash_collected'), amount: r.cash.collectedIqd, strong: true },
    ...(r.cash.toMerchantIqd > 0 ? [{ key: 'merchant', icon: 'bag' as const, label: t('partner.receipt_cash_merchant'), amount: r.cash.toMerchantIqd }] : []),
    { key: 'company', icon: 'wallet', label: t('partner.receipt_cash_company'), amount: r.cash.toCompanyIqd },
  ];
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="title" style={{ paddingHorizontal: theme.space[1] }}>
        {t('partner.receipt_cash_title')}
      </Text>
      <Card elevation={0} padding={4} tone="sunken" testID="receipt-cash">
        <View style={{ gap: theme.space[3] }}>
          {rows.map((x, i) => (
            <View key={x.key} accessible accessibilityLabel={`${x.label}: ${amountParam(x.amount)} ${t('quote.currency')}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingStart: i > 0 ? theme.space[4] : 0 }}>
              <Icon name={i > 0 ? 'arrow-forward' : x.icon} size={18} color={i > 0 ? 'textMuted' : 'warningText'} />
              <Text variant="label" weight={x.strong ? 600 : 400} style={{ flex: 1 }}>
                {x.label}
              </Text>
              <Text variant="label" weight={700} tabular color={x.strong ? 'warningText' : 'text'}>
                {`${amountParam(x.amount)} ${t('quote.currency')}`}
              </Text>
            </View>
          ))}
          <Text variant="caption" color="textMuted">
            {t('partner.earn_job_cash_note')}
          </Text>
        </View>
      </Card>
    </View>
  );
}

const REASONS = ['low', 'tip', 'take', 'cash'] as const;

/**
 * "عندي اعتراض" (S-7): a message to support with the job attached — the chat composer's shape, the
 * job card on top, his words prefilled with the job's number, quick reasons to add. Sending opens
 * one support ticket (`driverAccount.payQuery`); a second send for the same job returns the same one.
 */
export function DisputeSheet({ r, visible, onClose }: { r: JobReceipt; visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const send = usePayQuery();
  const prefill = disputePrefill(r, t);
  const [text, setText] = useState(prefill);
  const [picked, setPicked] = useState<string[]>([]);
  const [sent, setSent] = useState<{ already: boolean } | null>(null);
  useEffect(() => {
    if (!visible) return;
    setText(prefill);
    setPicked([]);
    setSent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const reasonLabel = (k: (typeof REASONS)[number]) => t(`partner.receipt_dispute_reason_${k}`);
  const onPick = (next: string[]) => {
    setPicked(next);
    const added = next.find((k) => !picked.includes(k)) as (typeof REASONS)[number] | undefined;
    if (added) setText((cur) => (cur.endsWith(': ') || cur.endsWith(' ') ? `${cur}${reasonLabel(added)}` : `${cur}، ${reasonLabel(added)}`));
  };
  const message = text.trim();
  const ready = message.length > prefill.trim().length + 2;
  const submit = () =>
    send.mutate(
      { key: r.key, at: r.at, message },
      {
        onSuccess: (res) => setSent({ already: res.alreadyOpen }),
        onError: (e) => toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' }),
      },
    );
  return (
    <ModalSheet visible={visible} onClose={onClose} title={t('partner.receipt_dispute_title')} locked={send.isPending} testID="dispute-sheet">
      {sent ? (
        <View testID="dispute-sent" style={{ alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[4] }}>
          <Animated.View entering={theme.reduceMotion ? undefined : ZoomIn.springify().damping(14)} style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={32} color="surface" strokeWidth={2.6} />
          </Animated.View>
          <Text variant="title" align="center" accessibilityLiveRegion="polite">
            {t('partner.receipt_dispute_sent')}
          </Text>
          <Text variant="footnote" color="textMuted" align="center">
            {sent.already ? t('partner.receipt_dispute_already') : t('partner.receipt_dispute_sent_body')}
          </Text>
          <Button testID="dispute-done" label={t('partner.ready_fix_ok')} fullWidth onPress={onClose} />
        </View>
      ) : (
        <View style={{ gap: theme.space[4] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="chat" size={18} color="textMuted" />
            <Text variant="footnote" color="textMuted">
              {t('partner.receipt_dispute_to')}
            </Text>
          </View>
          <View testID="dispute-attachment" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken, borderWidth: 1, borderColor: theme.colors.border }}>
            <Icon name="receipt" size={22} color="accentText" />
            <View style={{ flex: 1, gap: 0 }}>
              <Text variant="label" weight={700} tabular>
                {receiptTitle(r, t)}
              </Text>
              <Text variant="caption" color="textMuted" tabular>
                {`${formatWhen(r.at, new Date())} · ${t('partner.receipt_net')} ${amountParam(r.netIqd)} ${t('quote.currency')}`}
              </Text>
            </View>
          </View>
          <ChipGroup
            mode="multi"
            accessibilityLabel={t('partner.receipt_dispute_title')}
            items={REASONS.map((k) => ({ id: k, label: reasonLabel(k) }))}
            value={picked}
            onChange={onPick}
          />
          <TextField
            testID="dispute-text"
            label={t('partner.receipt_dispute_label')}
            value={text}
            onChangeText={setText}
            placeholder={t('partner.receipt_dispute_placeholder')}
            multiline
            maxLength={1000}
            style={{ minHeight: 120 }}
          />
          <Button testID="dispute-send" label={t('partner.receipt_dispute_send')} icon="send" size="lg" fullWidth disabled={!ready} loading={send.isPending} onPress={submit} />
        </View>
      )}
    </ModalSheet>
  );
}
