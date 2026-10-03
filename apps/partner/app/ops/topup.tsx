import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import type { TopUpConfirmation, TopUpLookupView } from '@driver/contracts';
import { Avatar, Button, Card, Icon, Skeleton, StatusPill, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { maskedPhone } from '@/features/fleet/logic';
import { baghdadClock, baghdadDate, type PadKey } from '@/features/ops/logic';
import { CodePad } from '@/features/ops/OpsParts';
import { apiErrorMessage, useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { useSignedIn } from '@/lib/session';

const TOPUP_CODE_LENGTH = 6;

/**
 * شحن محفظة زبون — the cash top-up desk of Ops mode (money §4 channel 3). The agent keys in the
 * customer's 6-digit code (from his app), sees who and how much, counts the cash and confirms:
 * `ops.confirmTopUp` credits the wallet once (single-use code, 24 h) and books the cash to the
 * company; the customer's code screen turns into his receipt.
 */
export default function OpsTopUp() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  const [code, setCode] = useState('');
  const [done, setDone] = useState<TopUpConfirmation | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const nonce = useRef(Math.random().toString(36).slice(2, 12));
  const complete = code.length === TOPUP_CODE_LENGTH;
  const lookup = useQuery({ ...api.ops.topUpLookup.queryOptions({ code }), enabled: signedIn && complete && !done, retry: false });
  const confirm = useMutation(api.ops.confirmTopUp.mutationOptions());
  const found: TopUpLookupView | undefined = complete ? lookup.data : undefined;

  const onKey = (k: PadKey) => {
    setProblem(null);
    setCode((c) => (k === 'del' ? c.slice(0, -1) : c.length >= TOPUP_CODE_LENGTH ? c : `${c}${k}`));
  };

  const onConfirm = async () => {
    if (!found || found.state !== 'pending') return;
    setProblem(null);
    try {
      const r = await confirm.mutateAsync({ code, amountIqd: found.amountIqd, idempotencyKey: `topup-${found.topUpId}-${nonce.current}` });
      setDone(r);
      void qc.invalidateQueries({ queryKey: api.ops.topUpLookup.queryKey() });
    } catch (err) {
      setProblem(apiErrorMessage(err, t('error.network'), locale));
    }
  };

  const again = () => {
    setDone(null);
    setCode('');
    setProblem(null);
    nonce.current = Math.random().toString(36).slice(2, 12);
  };

  if (done) {
    return (
      <Screen
        edges={['bottom']}
        testID="ops-topup-done"
        footer={
          <View style={{ gap: theme.space[2] }}>
            <Button testID="ops-topup-another" label={t('partner.ops_topup_another')} fullWidth size="lg" onPress={again} />
            <Button label={t('partner.ops_back_home')} variant="ghost" fullWidth onPress={() => (router.canGoBack() ? router.back() : router.replace('/ops'))} />
          </View>
        }
      >
        <Stack.Screen options={{ title: t('partner.ops_topup_title') }} />
        <View style={{ alignItems: 'center', gap: theme.space[2], paddingTop: theme.space[4] }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.successTint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={34} color="successText" strokeWidth={2.6} />
          </View>
          <Text variant="heading" align="center" tabular testID="ops-topup-done-title">
            {t('partner.ops_topup_done', { amount: amountParam(done.amountIqd) })}
          </Text>
        </View>
        <Card elevation={1} padding={4}>
          <View style={{ gap: theme.space[3] }}>
            <Row label={t('partner.ops_topup_customer')} value={done.customerName ?? maskedPhone(done.customerPhoneMasked)} />
            {done.customerName && done.customerPhoneMasked ? <Row label="" value={maskedPhone(done.customerPhoneMasked)} /> : null}
            <Row label={t('partner.ops_topup_ref')} value={`⁦${done.reference}⁩`} />
            <Row label={t('partner.ops_rcpt_time')} value={`${baghdadDate(done.confirmedAt)} · ${baghdadClock(done.confirmedAt, locale)}`} />
            <View style={{ height: 1, backgroundColor: theme.colors.border }} />
            <Row label={t('partner.ops_topup_balance')} value={iqd(done.walletBalanceIqd, { locale })} strong />
          </View>
        </Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], backgroundColor: theme.colors.successTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
          <Icon name="chat" size={20} color="successText" />
          <Text variant="footnote" color="successText" style={{ flex: 1 }}>
            {t('partner.ops_topup_whatsapp')}
          </Text>
        </View>
      </Screen>
    );
  }

  const lookupError = complete && lookup.isError ? apiErrorMessage(lookup.error, t('error.network'), locale) : null;
  const stateNote = found && found.state !== 'pending' ? t(found.state === 'confirmed' ? 'partner.ops_topup_state_used' : 'partner.ops_topup_state_expired') : null;

  return (
    <Screen
      edges={['bottom']}
      testID="ops-topup"
      contentStyle={{ gap: theme.space[4] }}
      footer={
        found && found.state === 'pending' ? (
          <View style={{ gap: theme.space[2] }}>
            {problem ? (
              <Text variant="footnote" color="dangerText" testID="ops-topup-problem">
                {problem}
              </Text>
            ) : null}
            <Button testID="ops-topup-confirm" label={t('partner.ops_topup_confirm', { amount: amountParam(found.amountIqd) })} fullWidth size="lg" loading={confirm.isPending} onPress={() => void onConfirm()} />
            <Text variant="caption" color="textMuted" align="center">
              {t('partner.ops_topup_count')}
            </Text>
          </View>
        ) : undefined
      }
    >
      <Stack.Screen options={{ title: t('partner.ops_topup_title') }} />
      <Text variant="body" color="textMuted">
        {t('partner.ops_topup_intro')}
      </Text>

      <View style={{ gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="shield" size={18} color="textMuted" />
          <Text variant="label" weight={600}>
            {t('partner.ops_topup_code')}
          </Text>
        </View>
        <SixBoxes code={code} error={Boolean(lookupError || stateNote)} />
        {lookupError || stateNote ? (
          <Text variant="footnote" color="dangerText" testID="ops-topup-error">
            {lookupError ?? stateNote}
          </Text>
        ) : null}
      </View>

      {complete && lookup.isPending ? <Skeleton lines={3} /> : null}
      {found ? (
        <Card elevation={1} padding={4} testID="ops-topup-found">
          <View style={{ gap: theme.space[3] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <Avatar name={found.customerName ?? undefined} {...(found.customerName ? {} : { icon: 'user' as const })} size={44} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="caption" color="textMuted">
                  {t('partner.ops_topup_request')}
                </Text>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {found.customerName ?? maskedPhone(found.customerPhoneMasked)}
                </Text>
                {found.customerName && found.customerPhoneMasked ? (
                  <Text variant="caption" color="textMuted" tabular>
                    {maskedPhone(found.customerPhoneMasked)}
                  </Text>
                ) : null}
              </View>
              <StatusPill size="sm" tone={found.state === 'pending' ? 'accent' : 'neutral'} icon="clock" label={t('partner.ops_topup_valid', { time: baghdadClock(found.expiresAt, locale) })} />
            </View>
            <View style={{ alignItems: 'center', paddingVertical: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: theme.colors.accentTint }}>
              <Text variant="display" tabular testID="ops-topup-amount">
                {amountParam(found.amountIqd)}
              </Text>
              <Text variant="label" color="accentText">
                دينار
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      {found?.state === 'pending' ? null : <CodePad onKey={onKey} disabled={confirm.isPending} />}
    </Screen>
  );
}

/** Six digit boxes, the next one outlined (same look as the 4-digit hand-over code). */
function SixBoxes({ code, error }: { code: string; error?: boolean }) {
  const theme = useTheme();
  return (
    <View testID="ops-topup-boxes" style={{ flexDirection: 'row', gap: theme.space[2], justifyContent: 'center', direction: 'ltr' }}>
      {Array.from({ length: TOPUP_CODE_LENGTH }, (_, i) => {
        const current = i === code.length;
        return (
          <View
            key={i}
            style={{
              width: 46,
              height: 58,
              borderRadius: theme.radius.md,
              borderWidth: current || error ? 2 : 1,
              borderColor: error ? theme.colors.danger : current ? theme.colors.accent : theme.colors.border,
              backgroundColor: theme.colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="heading" tabular>
              {code[i] ?? ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
      <Text variant="label" color="textMuted">
        {label}
      </Text>
      <Text variant="label" weight={strong ? 700 : 600} tabular numberOfLines={1} style={{ flexShrink: 1 }}>
        {value}
      </Text>
    </View>
  );
}
