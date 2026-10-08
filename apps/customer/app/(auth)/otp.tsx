import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import type { OtpChannel } from '@driver/contracts';
import { View } from 'react-native';
import { Button, Card, Icon, Text, useTheme } from '@driver/ui';
import { OtpInput } from '@/components/OtpInput';
import { Screen } from '@/components/Screen';
import { AuthHeader } from '@/features/auth/AuthHeader';
import { apiErrorCode, apiErrorMessage, apiRetryAfter, useApi } from '@/lib/api';
import { getDeviceInfo } from '@/lib/device';
import { DEV_TOOLS } from '@/lib/env';
import { useLocale, useT } from '@/lib/i18n';
import { displayPhone } from '@/lib/phone';
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

export default function OtpEntry() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const params = useLocalSearchParams<{ phone: string; masked?: string; resendAfter?: string; channel?: string }>();
  const phone = params.phone ?? '';
  const [code, setCode] = useState('');
  const [resendUntil, setResendUntil] = useState(() => Date.now() + Number(params.resendAfter ?? 30) * 1000);
  // SMS first; after 30 s "ما وصلك؟ دزلي على واتساب" sends the next code over WhatsApp (audit C-18).
  const [channel, setChannel] = useState<OtpChannel>(params.channel === 'whatsapp' ? 'whatsapp' : 'sms');
  const [resending, setResending] = useState<OtpChannel | null>(null);
  const secondsLeft = useSecondsLeft(resendUntil);
  const submitted = useRef<string | null>(null);

  const verify = useMutation(api.identity.verifyOtp.mutationOptions());
  const resend = useMutation(api.identity.requestOtp.mutationOptions());
  const devCode = useQuery({ ...api.identity.devLastOtp.queryOptions({ phone }), enabled: DEV_TOOLS && !!phone, retry: false, staleTime: 0 });

  useEffect(() => {
    if (!phone) router.replace('/phone');
  }, [phone]);

  const submit = async (value: string) => {
    if (value.length !== CODE_LENGTH || verify.isPending || submitted.current === value) return;
    submitted.current = value;
    try {
      const res = await verify.mutateAsync({ phone, code: value, device: await getDeviceInfo() });
      // Ask for a name (and first place) when the account is new or we don't know the name yet.
      // Set before signing in so the guard sends the person straight to /setup.
      await profile.setSetupPending(res.isNew || !profile.getSnapshot().name);
      await session.signIn(res.tokens, res.personId);
    } catch {
      setCode('');
      submitted.current = null;
    }
  };

  const onChange = (v: string) => {
    setCode(v);
    if (verify.error) verify.reset();
    if (v.length === CODE_LENGTH) void submit(v);
  };

  const onResend = async (via: OtpChannel) => {
    setResending(via);
    try {
      const res = await resend.mutateAsync({ phone, purpose: 'login', channel: via, device: await getDeviceInfo() });
      setResendUntil(Date.now() + res.resendAfterSec * 1000);
      setChannel(res.channel ?? via);
      setCode('');
      if (verify.error) verify.reset();
      if (DEV_TOOLS) void devCode.refetch();
    } catch (err) {
      const after = apiRetryAfter(err);
      if (after) setResendUntil(Date.now() + after * 1000);
    } finally {
      setResending(null);
    }
  };

  const errorText = verify.error
    ? apiErrorCode(verify.error) === 'otp_invalid'
      ? t('error.otp_invalid')
      : apiErrorMessage(verify.error, t('error.network'), locale)
    : resend.error
      ? apiErrorMessage(resend.error, t('error.network'), locale)
      : null;

  const shownPhone = phone ? displayPhone(phone) : (params.masked ?? '');

  return (
    <Screen>
      <AuthHeader
        title={t('onboarding.otp_title')}
        subtitle={t(channel === 'whatsapp' ? 'onboarding.otp_sent_whatsapp' : 'onboarding.otp_sent_to', { phone: `⁦${shownPhone}⁩` })}
      />

      <View style={{ gap: theme.space[3] }}>
        <OtpInput
          value={code}
          onChange={onChange}
          length={CODE_LENGTH}
          error={!!verify.error}
          disabled={verify.isPending}
          accessibilityLabel={t('onboarding.otp_title')}
          autoFocus
        />
        {verify.isPending ? (
          <Text variant="footnote" color="textMuted" align="center" accessibilityLiveRegion="polite">
            {t('onboarding.verifying')}
          </Text>
        ) : errorText ? (
          <Text variant="footnote" color="dangerText" align="center" accessibilityLiveRegion="polite">
            {errorText}
          </Text>
        ) : null}
      </View>

      <View style={{ alignItems: 'center', gap: theme.space[2] }}>
        {secondsLeft > 0 ? (
          <Text variant="label" color="textMuted" tabular>
            {t('onboarding.otp_resend_in', { seconds: secondsLeft })}
          </Text>
        ) : (
          <View style={{ alignSelf: 'stretch', gap: theme.space[2] }} testID="otp-not-received">
            {/* A code that already came on WhatsApp (the SMS budget was spent) offers SMS only. */}
            {channel === 'whatsapp' ? null : (
              <Button
                testID="otp-whatsapp"
                variant="secondary"
                icon="chat"
                fullWidth
                label={t('onboarding.otp_whatsapp_offer')}
                loading={resending === 'whatsapp'}
                disabled={resending !== null}
                onPress={() => void onResend('whatsapp')}
              />
            )}
            <Button
              testID="otp-resend"
              variant={channel === 'whatsapp' ? 'secondary' : 'ghost'}
              label={t('onboarding.otp_resend_sms')}
              loading={resending === 'sms'}
              disabled={resending !== null}
              onPress={() => void onResend('sms')}
              style={channel === 'whatsapp' ? undefined : { alignSelf: 'center' }}
              fullWidth={channel === 'whatsapp'}
            />
          </View>
        )}
        <Button variant="ghost" size="sm" label={t('onboarding.otp_change_number')} onPress={() => router.back()} style={{ alignSelf: 'center' }} />
      </View>

      {DEV_TOOLS && devCode.data?.code ? (
        <Card elevation={0} tone="sunken" padding={3} testID="otp-dev-strip">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <Icon name="shield" size={20} color="textMuted" />
            <Text variant="label" color="textMuted" tabular style={{ flex: 1 }}>
              {t('onboarding.dev_code', { code: devCode.data.code })}
            </Text>
            <Button size="sm" variant="secondary" label={t('onboarding.dev_fill')} onPress={() => onChange(devCode.data?.code ?? '')} />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
