import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { DeletionBlocker } from '@driver/contracts';
import {
  Button,
  Card,
  Icon,
  RetryState,
  retryKindFor,
  SketchScene,
  Skeleton,
  Text,
  useLoadTimeout,
  useNetwork,
  useTheme,
  useToast,
  type IconName,
} from '@driver/ui';
import { OtpInput } from '@/components/OtpInput';
import { Screen } from '@/components/Screen';
import { apiErrorCode, apiErrorMessage, apiRetryAfter, useApi } from '@/lib/api';
import { DEV_TOOLS } from '@/lib/env';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { profile } from '@/lib/profile';
import { session } from '@/lib/session';

const CODE_LENGTH = 6;

/** Seconds left until `until` (epoch ms), ticking once a second. */
function useSecondsLeft(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * حذف الحساب (W7, store rule REL-01; docs/api/account-deletion.md). What goes and what stays (without
 * the name), then what stands in the way if anything does, then a code to his own number and one
 * deliberate tap. After it the phone forgets everything and goes back to the start.
 */
export default function DeleteAccount() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const api = useApi();
  const net = useNetwork();
  const check = useQuery({ ...api.identity.deleteAccount.check.queryOptions(), staleTime: 0 });
  const [slow, restartSlow] = useLoadTimeout(check.isPending);
  const start = useMutation(api.identity.deleteAccount.start.mutationOptions());
  const confirm = useMutation(api.identity.deleteAccount.confirm.mutationOptions());
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendUntil, setResendUntil] = useState(0);
  const secondsLeft = useSecondsLeft(resendUntil);
  const devCode = useQuery({
    ...api.identity.deleteAccount.devCode.queryOptions(),
    enabled: DEV_TOOLS && sentTo !== null,
    retry: false,
    staleTime: 0,
  });

  const send = async () => {
    try {
      const res = await start.mutateAsync();
      setSentTo(res.phoneMasked);
      setResendUntil(Date.now() + res.resendAfterSec * 1000);
      setCode('');
      if (confirm.error) confirm.reset();
      if (DEV_TOOLS) void devCode.refetch();
    } catch (err) {
      const after = apiRetryAfter(err);
      if (after) setResendUntil(Date.now() + after * 1000);
      // A blocker that appeared since the screen loaded (an order just placed): show it.
      if (apiErrorCode(err) === 'account_delete_blocked') void check.refetch();
    }
  };

  const remove = async () => {
    try {
      await confirm.mutateAsync({ code });
    } catch (err) {
      setCode('');
      if (apiErrorCode(err) === 'account_delete_blocked') {
        setSentTo(null);
        void check.refetch();
      }
      return;
    }
    toast.show({ message: t('delete.done'), tone: 'success', icon: 'check' });
    // The server already closed every session and push token; forget everything on this phone too.
    await profile.reset();
    await session.signOut();
  };

  if ((check.isError || slow) && !check.data) {
    const kind = retryKindFor({ net, error: check.error, slow });
    return (
      <Screen edges={['bottom']} testID="delete-error">
        <RetryState
          kind={kind}
          locale={locale}
          art={
            kind === 'offline' || kind === 'unreachable' ? (
              <SketchScene name="offline" />
            ) : undefined
          }
          onRetry={() => {
            restartSlow();
            void check.refetch();
          }}
        />
      </Screen>
    );
  }

  if (!check.data) {
    return (
      <Screen edges={['bottom']} testID="delete-loading">
        <Skeleton height={20} width="80%" />
        <Skeleton height={180} />
        <Skeleton height={120} />
      </Screen>
    );
  }

  const { available, blockers, points } = check.data;
  const support = (
    <Button
      testID="delete-support"
      variant="secondary"
      icon="chat"
      fullWidth
      label={t('delete.support')}
      onPress={() => router.push('/help')}
    />
  );

  if (!available) {
    return (
      <Screen edges={['bottom']} testID="delete-off">
        <Card elevation={0} tone="sunken">
          <View style={{ gap: theme.space[2] }}>
            <Text variant="heading">{t('delete.off_title')}</Text>
            <Text variant="body" color="textMuted">
              {t('delete.off_body')}
            </Text>
          </View>
        </Card>
        {support}
      </Screen>
    );
  }

  const blocked = blockers.length > 0;
  const confirmError = confirm.error
    ? apiErrorCode(confirm.error) === 'otp_invalid'
      ? t('error.otp_invalid')
      : apiErrorMessage(confirm.error, t('error.network'), locale)
    : null;
  const startError =
    start.error && apiErrorCode(start.error) !== 'account_delete_blocked'
      ? apiErrorMessage(start.error, t('error.network'), locale)
      : null;

  const footer = blocked ? null : sentTo ? (
    <View style={{ gap: theme.space[2] }}>
      <Button
        testID="delete-confirm"
        variant="destructive"
        size="lg"
        fullWidth
        icon="trash"
        label={confirm.isPending ? t('delete.deleting') : t('delete.confirm')}
        disabled={code.length !== CODE_LENGTH}
        loading={confirm.isPending}
        onPress={() => void remove()}
      />
      <Button
        testID="delete-keep"
        variant="ghost"
        fullWidth
        label={t('delete.keep')}
        onPress={() => router.back()}
      />
    </View>
  ) : (
    <View style={{ gap: theme.space[2] }}>
      <Button
        testID="delete-send"
        variant="destructive"
        size="lg"
        fullWidth
        icon="lock"
        label={t('delete.send_code')}
        loading={start.isPending}
        onPress={() => void send()}
      />
      <Button
        testID="delete-keep"
        variant="ghost"
        fullWidth
        label={t('delete.keep')}
        onPress={() => router.back()}
      />
    </View>
  );

  return (
    <Screen edges={['bottom']} testID="delete-account" footer={footer}>
      <Text variant="body">{t('delete.lead')}</Text>

      {/* What stands in the way comes first: nothing below can happen until it is sorted. */}
      {blocked ? (
        <Card elevation={0} tone="tint" testID="delete-blocked">
          <View style={{ gap: theme.space[3] }}>
            <View style={{ gap: theme.space[1] }}>
              <Text variant="heading">{t('delete.blocked_title')}</Text>
              <Text variant="footnote" color="textMuted">
                {t('delete.blocked_body')}
              </Text>
            </View>
            {blockers.map((b, i) => (
              <Line key={`${b.kind}-${i}`} icon={BLOCKER_ICON[b.kind]} text={blockerText(b, t)} />
            ))}
            {support}
          </View>
        </Card>
      ) : null}

      <Card elevation={0} testID="delete-goes">
        <View style={{ gap: theme.space[3] }}>
          <Text variant="heading">{t('delete.goes_title')}</Text>
          <Line icon="user" text={t('delete.goes_identity')} />
          <Line icon="map-pin" text={t('delete.goes_places')} />
          <Line icon="family" text={t('delete.goes_people')} />
          <Line icon="chat" text={t('delete.goes_chats')} />
          <Line icon="gift" text={t('delete.goes_invite')} />
          {points > 0 ? (
            <Line icon="star" text={t('delete.goes_points', { points: amountParam(points) })} />
          ) : null}
        </View>
      </Card>

      <Card elevation={0} tone="sunken" testID="delete-stays">
        <View style={{ gap: theme.space[2] }}>
          <Text variant="heading">{t('delete.stays_title')}</Text>
          <Text variant="footnote" color="textMuted">
            {t('delete.stays_body')}
          </Text>
        </View>
      </Card>

      {blocked ? null : sentTo ? (
        <View style={{ gap: theme.space[3] }} testID="delete-code">
          <View style={{ gap: theme.space[1] }}>
            <Text variant="heading">{t('delete.code_title')}</Text>
            <Text variant="footnote" color="textMuted">
              {t('onboarding.otp_sent_to', { phone: `⁦${sentTo}⁩` })}
            </Text>
          </View>
          <OtpInput
            value={code}
            onChange={(v) => {
              setCode(v);
              if (confirm.error) confirm.reset();
            }}
            length={CODE_LENGTH}
            error={!!confirm.error}
            disabled={confirm.isPending}
            accessibilityLabel={t('delete.code_title')}
            autoFocus
          />
          {confirmError ? (
            <Text
              variant="footnote"
              color="dangerText"
              align="center"
              accessibilityLiveRegion="polite"
            >
              {confirmError}
            </Text>
          ) : null}
          {secondsLeft > 0 ? (
            <Text variant="label" color="textMuted" align="center" tabular>
              {t('onboarding.otp_resend_in', { seconds: secondsLeft })}
            </Text>
          ) : (
            <Button
              testID="delete-resend"
              variant="ghost"
              label={t('onboarding.otp_resend_sms')}
              loading={start.isPending}
              onPress={() => void send()}
              style={{ alignSelf: 'center' }}
            />
          )}
          {DEV_TOOLS && !devCode.isError && devCode.data?.code ? (
            <Card elevation={0} tone="sunken" padding={3} testID="delete-dev-strip">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                <Icon name="shield" size={20} color="textMuted" />
                <Text variant="label" color="textMuted" tabular style={{ flex: 1 }}>
                  {t('onboarding.dev_code', { code: devCode.data.code })}
                </Text>
                <Button
                  size="sm"
                  variant="secondary"
                  label={t('onboarding.dev_fill')}
                  onPress={() => setCode(devCode.data?.code ?? '')}
                />
              </View>
            </Card>
          ) : null}
        </View>
      ) : startError ? (
        <Text variant="footnote" color="dangerText" align="center" accessibilityLiveRegion="polite">
          {startError}
        </Text>
      ) : null}
    </Screen>
  );
}

const BLOCKER_ICON: Record<DeletionBlocker['kind'], IconName> = {
  open_order: 'bag',
  open_booking: 'car',
  active_subscription: 'clock',
  wallet_balance: 'wallet',
  wallet_owes: 'cash',
  household: 'family',
  work_role: 'briefcase',
};

function blockerText(b: DeletionBlocker, t: ReturnType<typeof useT>): string {
  const amount = amountParam(b.amountIqd ?? 0);
  switch (b.kind) {
    case 'open_order':
      return t('delete.block_open_order');
    case 'open_booking':
      return t('delete.block_open_booking');
    case 'active_subscription':
      return t('delete.block_active_subscription');
    case 'wallet_balance':
      return t('delete.block_wallet_balance', { amount });
    case 'wallet_owes':
      return t('delete.block_wallet_owes', { amount });
    case 'household':
      return b.amountIqd
        ? t('delete.block_household_money', { amount })
        : t('delete.block_household');
    case 'work_role':
      return t('delete.block_work_role');
  }
}

function Line({ icon, text }: { icon: IconName; text: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
      <Icon name={icon} size={20} color="textMuted" />
      <Text variant="body" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
