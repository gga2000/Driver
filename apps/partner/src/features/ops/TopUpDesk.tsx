import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import type { PartnerCash, TopUpConfirmation, TopUpLookupView } from '@driver/contracts';
import { Avatar, Button, Card, Icon, Skeleton, SlideToConfirm, StatusPill, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { maskedPhone } from '@/features/fleet/logic';
import { capShare, topUpCapEffect } from '@/features/work/logic';
import { apiErrorMessage, useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { useSignedIn } from '@/lib/session';
import { baghdadClock, baghdadDate, type PadKey } from './logic';
import { CodePad } from './OpsParts';

const TOPUP_CODE_LENGTH = 6;

export type TopUpDeskMode = 'ops' | 'courier';

/**
 * The cash top-up desk (money §4 channel 3), shared by Ops mode (`ops.*`, cash to the company) and a
 * courier on a job (`partner.*`, only for the customer whose order he carries; the cash counts on his
 * cap until he settles). Key in the customer's 6-digit code, see who and how much, count the cash,
 * confirm once (single-use code): the customer's code screen turns into his receipt.
 */
export function TopUpDesk({
  mode,
  title,
  cash,
  backLabel,
  onBack,
}: {
  mode: TopUpDeskMode;
  title: string;
  cash?: PartnerCash | null;
  backLabel: string;
  onBack: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  const [code, setCode] = useState('');
  const [done, setDone] = useState<TopUpConfirmation | null>(null);
  // His cash as it was when he confirmed: the status refetch afterwards already includes this top-up.
  const [cashBefore, setCashBefore] = useState<PartnerCash | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const nonce = useRef(Math.random().toString(36).slice(2, 12));
  const complete = code.length === TOPUP_CODE_LENGTH;
  const desk = mode === 'ops' ? api.ops : api.partner;
  const lookup = useQuery({
    ...desk.topUpLookup.queryOptions({ code }),
    enabled: signedIn && complete && !done,
    retry: false,
  });
  const confirm = useMutation(desk.confirmTopUp.mutationOptions());
  const found: TopUpLookupView | undefined = complete ? lookup.data : undefined;
  const testPrefix = mode === 'ops' ? 'ops-topup' : 'job-topup';

  const onKey = (k: PadKey) => {
    setProblem(null);
    setCode((c) => (k === 'del' ? c.slice(0, -1) : c.length >= TOPUP_CODE_LENGTH ? c : `${c}${k}`));
  };

  const onConfirm = async () => {
    if (!found || found.state !== 'pending') return;
    setProblem(null);
    try {
      setCashBefore(cash ?? null);
      const r = await confirm.mutateAsync({
        code,
        amountIqd: found.amountIqd,
        idempotencyKey: `topup-${found.topUpId}-${nonce.current}`,
      });
      setDone(r);
      theme.haptic('success');
      void qc.invalidateQueries({ queryKey: desk.topUpLookup.queryKey() });
      // The courier's cash in hand just grew: the home bar and the cap follow.
      if (mode === 'courier')
        void qc.invalidateQueries({ queryKey: api.partner.status.queryKey() });
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
    const after = cashBefore ? topUpCapEffect(cashBefore, done.amountIqd) : null;
    return (
      <Screen
        edges={['bottom']}
        testID={`${testPrefix}-done`}
        footer={
          <View style={{ gap: theme.space[2] }}>
            {mode === 'ops' ? (
              <Button
                testID="ops-topup-another"
                label={t('partner.ops_topup_another')}
                fullWidth
                size="lg"
                onPress={again}
              />
            ) : null}
            <Button
              testID={`${testPrefix}-back`}
              label={backLabel}
              variant={mode === 'ops' ? 'ghost' : 'primary'}
              size={mode === 'ops' ? 'md' : 'lg'}
              fullWidth
              onPress={onBack}
            />
          </View>
        }
      >
        <Stack.Screen options={{ title }} />
        <View style={{ alignItems: 'center', gap: theme.space[2], paddingTop: theme.space[4] }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: theme.colors.successTint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="check" size={34} color="successText" strokeWidth={2.6} />
          </View>
          <Text variant="heading" align="center" tabular testID={`${testPrefix}-done-title`}>
            {t('partner.ops_topup_done', { amount: amountParam(done.amountIqd) })}
          </Text>
        </View>
        <Card elevation={1} padding={4}>
          <View style={{ gap: theme.space[3] }}>
            <Row
              label={t('partner.ops_topup_customer')}
              value={done.customerName ?? maskedPhone(done.customerPhoneMasked)}
            />
            {done.customerName && done.customerPhoneMasked ? (
              <Row label="" value={maskedPhone(done.customerPhoneMasked)} />
            ) : null}
            <Row label={t('partner.ops_topup_ref')} value={`⁦${done.reference}⁩`} />
            <Row
              label={t('partner.ops_rcpt_time')}
              value={`${baghdadDate(done.confirmedAt)} · ${baghdadClock(done.confirmedAt, locale)}`}
            />
            {/* The customer's balance is his own business: the field-ops desk may read it back to him, a
                courier at the door never sees it. */}
            {mode === 'ops' ? (
              <>
                <View style={{ height: 1, backgroundColor: theme.colors.border }} />
                <Row label={t('partner.ops_topup_balance')} value={iqd(done.walletBalanceIqd, { locale })} strong />
              </>
            ) : null}
          </View>
        </Card>
        {after ? (
          <CapNote
            testID="job-topup-cap-done"
            tone={after.overCap ? 'danger' : 'info'}
            text={t('partner.job_topup_done_cap', {
              held: amountParam(after.afterIqd),
              cap: amountParam(after.capIqd),
            })}
            share={capShare(after.afterIqd, after.capIqd)}
          />
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[3],
            backgroundColor: theme.colors.successTint,
            borderRadius: theme.radius.lg,
            padding: theme.space[3],
          }}
        >
          <Icon name="chat" size={20} color="successText" />
          <Text variant="footnote" color="successText" style={{ flex: 1 }}>
            {t('partner.ops_topup_whatsapp')}
          </Text>
        </View>
      </Screen>
    );
  }

  const lookupError =
    complete && lookup.isError ? apiErrorMessage(lookup.error, t('error.network'), locale) : null;
  const stateNote =
    found && found.state !== 'pending'
      ? t(
          found.state === 'confirmed'
            ? 'partner.ops_topup_state_used'
            : 'partner.ops_topup_state_expired',
        )
      : null;
  const effect = cash && found?.state === 'pending' ? topUpCapEffect(cash, found.amountIqd) : null;

  return (
    <Screen
      edges={['bottom']}
      testID={testPrefix}
      contentStyle={{ gap: theme.space[4] }}
      footer={
        found && found.state === 'pending' ? (
          <View style={{ gap: theme.space[2] }}>
            {problem ? (
              <Text variant="footnote" color="dangerText" testID={`${testPrefix}-problem`}>
                {problem}
              </Text>
            ) : null}
            {/* Partner redesign f3: money moves, so it is a slide, never a pocket tap. */}
            <SlideToConfirm
              testID={`${testPrefix}-confirm`}
              label={t('partner.ops_topup_confirm', { amount: amountParam(found.amountIqd) })}
              icon="wallet"
              loading={confirm.isPending}
              onConfirm={() => void onConfirm()}
            />
            <Text variant="caption" color="textMuted" align="center">
              {t('partner.ops_topup_count')}
            </Text>
          </View>
        ) : undefined
      }
    >
      <Stack.Screen options={{ title }} />
      <Text variant="body" color="textMuted">
        {t('partner.ops_topup_intro')}
      </Text>

      {cash && !effect ? (
        <CapNote
          testID="job-topup-cap"
          tone={cash.overCap ? 'danger' : cash.nearCap ? 'warning' : 'info'}
          text={t('partner.job_topup_cap', {
            held: amountParam(cash.owedIqd),
            cap: amountParam(cash.capIqd),
          })}
          share={capShare(cash.owedIqd, cash.capIqd)}
        />
      ) : null}

      <View style={{ gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="shield" size={18} color="textMuted" />
          <Text variant="label" weight={600}>
            {t('partner.ops_topup_code')}
          </Text>
        </View>
        <SixBoxes
          code={code}
          error={Boolean(lookupError || stateNote)}
          testID={`${testPrefix}-boxes`}
        />
        {lookupError || stateNote ? (
          <Text variant="footnote" color="dangerText" testID={`${testPrefix}-error`}>
            {lookupError ?? stateNote}
          </Text>
        ) : null}
      </View>

      {complete && lookup.isPending ? <Skeleton lines={3} /> : null}
      {found ? (
        <Card elevation={1} padding={4} testID={`${testPrefix}-found`}>
          <View style={{ gap: theme.space[3] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <Avatar
                name={found.customerName ?? undefined}
                {...(found.customerName ? {} : { icon: 'user' as const })}
                size={44}
              />
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
              <StatusPill
                size="sm"
                tone={found.state === 'pending' ? 'accent' : 'neutral'}
                icon="clock"
                label={t('partner.ops_topup_valid', {
                  time: baghdadClock(found.expiresAt, locale),
                })}
              />
            </View>
            <View
              style={{
                alignItems: 'center',
                paddingVertical: theme.space[2],
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.accentTint,
              }}
            >
              <Text variant="display" tabular testID={`${testPrefix}-amount`}>
                {amountParam(found.amountIqd)}
              </Text>
              <Text variant="label" color="accentText">
                {t('quote.currency')}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      {effect ? (
        <CapNote
          testID="job-topup-cap-after"
          tone={effect.overCap ? 'danger' : 'warning'}
          text={`${t('partner.job_topup_cap_after', { after: amountParam(effect.afterIqd), cap: amountParam(effect.capIqd) })}${effect.overCap ? `. ${t('partner.job_topup_over_cap')}` : ''}`}
          share={capShare(effect.afterIqd, effect.capIqd)}
        />
      ) : null}

      {found?.state === 'pending' ? null : <CodePad onKey={onKey} disabled={confirm.isPending} />}
    </Screen>
  );
}

/** One line about the courier's cash cap with a thin bar (how much of it this cash takes). */
function CapNote({
  text,
  share,
  tone,
  testID,
}: {
  text: string;
  share: number;
  tone: 'info' | 'warning' | 'danger';
  testID: string;
}) {
  const theme = useTheme();
  const bg =
    tone === 'danger'
      ? theme.colors.dangerTint
      : tone === 'warning'
        ? theme.colors.warningTint
        : theme.colors.infoTint;
  const fg = tone === 'danger' ? 'dangerText' : tone === 'warning' ? 'warningText' : 'infoText';
  const bar =
    tone === 'danger'
      ? theme.colors.danger
      : tone === 'warning'
        ? theme.colors.warning
        : theme.colors.info;
  return (
    <View
      testID={testID}
      style={{
        gap: theme.space[2],
        padding: theme.space[3],
        borderRadius: theme.radius.lg,
        backgroundColor: bg,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name="wallet" size={18} color={fg} />
        <Text variant="footnote" color={fg} tabular style={{ flex: 1 }}>
          {text}
        </Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: theme.colors.surface,
          overflow: 'hidden',
        }}
      >
        {share > 0 ? (
          <View
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: bar,
              width: `${Math.max(share * 100, 3)}%`,
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

/** Six digit boxes, the next one outlined (same look as the 4-digit hand-over code). */
function SixBoxes({ code, error, testID }: { code: string; error?: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        gap: theme.space[2],
        justifyContent: 'center',
        direction: 'ltr',
      }}
    >
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
              borderColor: error
                ? theme.colors.danger
                : current
                  ? theme.colors.accent
                  : theme.colors.border,
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
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 12,
      }}
    >
      <Text variant="label" color="textMuted">
        {label}
      </Text>
      <Text
        variant="label"
        weight={strong ? 700 : 600}
        tabular
        numberOfLines={1}
        style={{ flexShrink: 1 }}
      >
        {value}
      </Text>
    </View>
  );
}
