import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Text, TextField, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { AuthHeader } from '@/features/auth/AuthHeader';
import { apiErrorCode, apiErrorMessage, useApi } from '@/lib/api';
import { getDeviceInfo } from '@/lib/device';
import { useLocale, useT } from '@/lib/i18n';
import { signInReason } from '@/lib/guard';
import { formatPhoneInput, normalizeIraqiPhone } from '@/lib/phone';
import { useProfile } from '@/lib/profile';

export default function PhoneEntry() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const requestOtp = useMutation(api.identity.requestOtp.mutationOptions());
  // A guest stopped at "كمّل الطلب" / "احجز" hears why the number is needed now.
  const reason = signInReason(useProfile().returnTo);
  const hint = reason === 'order' ? t('onboarding.phone_hint_order') : reason === 'book' ? t('onboarding.phone_hint_book') : t('onboarding.phone_hint');

  const e164 = normalizeIraqiPhone(value);
  const digits = value.replace(/\D/g, '').length;
  const showInvalid = touched && !e164 && digits > 0;
  const serverError = requestOtp.error
    ? apiErrorCode(requestOtp.error) === 'phone_invalid'
      ? t('error.phone_invalid')
      : apiErrorMessage(requestOtp.error, t('error.network'), locale)
    : undefined;

  const submit = async () => {
    setTouched(true);
    if (!e164 || requestOtp.isPending) return;
    try {
      const res = await requestOtp.mutateAsync({ phone: e164, purpose: 'login', device: await getDeviceInfo() });
      router.push({ pathname: '/otp', params: { phone: e164, masked: res.phoneMasked, resendAfter: String(res.resendAfterSec) } });
    } catch {
      /* shown under the field */
    }
  };

  return (
    <Screen
      footer={
        <View style={{ gap: theme.space[3] }}>
          <Button
            testID="phone-submit"
            label={t('onboarding.send_otp')}
            size="lg"
            fullWidth
            disabled={!e164}
            loading={requestOtp.isPending}
            onPress={() => void submit()}
          />
          <Text variant="caption" color="textMuted" align="center">
            {t('onboarding.terms_phone')}
          </Text>
        </View>
      }
    >
      <AuthHeader title={t('onboarding.phone_label')} subtitle={hint} />
      <View style={{ gap: theme.space[2] }}>
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
          error={showInvalid ? t('error.phone_invalid') : serverError}
        />
      </View>
    </Screen>
  );
}
