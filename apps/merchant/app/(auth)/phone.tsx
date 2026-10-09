import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Button, TextField, useTheme } from '@driver/ui';
import { AuthFrame } from '@/features/auth/AuthFrame';
import { phoneReason } from '@/features/auth/phone-reason';
import { apiErrorCode, apiErrorMessage, useApi } from '@/lib/api';
import { getDeviceInfo } from '@/lib/device';
import { useLocale, useT } from '@/lib/i18n';
import { formatPhoneInput, normalizeIraqiPhone } from '@/lib/phone';

/**
 * Staff and owners sign in with their own number: the owner's is the one the shop was registered with,
 * staff use the one the owner added them with (day-one d08: the hint speaks to both).
 */
export default function PhoneEntry() {
  const t = useT();
  const theme = useTheme();
  const locale = useLocale();
  const api = useApi();
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const requestOtp = useMutation(api.identity.requestOtp.mutationOptions());

  const e164 = normalizeIraqiPhone(value);
  // d08: why the number is wrong, under the field, as soon as it is clear (not just a pale button).
  const showInvalid = phoneReason(value, touched) !== null;
  const serverError = requestOtp.error
    ? apiErrorCode(requestOtp.error) === 'phone_invalid'
      ? t('error.phone_invalid')
      : apiErrorMessage(requestOtp.error, t('error.network'), locale)
    : undefined;

  const submit = async () => {
    setTouched(true);
    if (!e164 || requestOtp.isPending) return;
    try {
      const res = await requestOtp.mutateAsync({ phone: e164, purpose: 'login', channel: 'sms', device: await getDeviceInfo() });
      router.push({ pathname: '/otp', params: { phone: e164, masked: res.phoneMasked, resendAfter: String(res.resendAfterSec), channel: res.channel ?? 'sms' } });
    } catch {
      /* shown under the field */
    }
  };

  return (
    <AuthFrame
      testID="phone-screen"
      title={t('onboarding.phone_label')}
      subtitle={t('merchant.auth.phone_hint_all')}
      footer={<Button testID="phone-submit" label={t('onboarding.send_otp')} size="lg" fullWidth disabled={!e164} loading={requestOtp.isPending} onPress={() => void submit()} style={e164 ? undefined : { opacity: 1, backgroundColor: theme.colors.accentTint }} />}
    >
      <TextField
        testID="phone-input"
        value={value}
        onChangeText={(v) => {
          setValue(formatPhoneInput(v));
          if (requestOtp.error) requestOtp.reset();
        }}
        onBlur={() => setTouched(true)}
        onSubmitEditing={() => void submit()}
        placeholder={t('onboarding.phone_placeholder')}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        autoFocus
        leadingIcon="phone"
        accessibilityLabel={t('onboarding.phone_label')}
        error={showInvalid ? t('merchant.auth.phone_rule') : serverError}
      />
    </AuthFrame>
  );
}
