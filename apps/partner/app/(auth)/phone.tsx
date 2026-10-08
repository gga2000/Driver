import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Icon, Text, TextField, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { AuthHeader } from '@/features/auth/AuthHeader';
import { apiErrorCode, apiErrorMessage, useApi } from '@/lib/api';
import { getDeviceInfo } from '@/lib/device';
import { useLocale, useT } from '@/lib/i18n';
import { formatPhoneInput, normalizeIraqiPhone } from '@/lib/phone';

export default function PhoneEntry() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const requestOtp = useMutation(api.identity.requestOtp.mutationOptions());

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
      const res = await requestOtp.mutateAsync({ phone: e164, purpose: 'login', channel: 'sms', device: await getDeviceInfo() });
      router.push({ pathname: '/otp', params: { phone: e164, masked: res.phoneMasked, resendAfter: String(res.resendAfterSec), channel: res.channel ?? 'sms' } });
    } catch {
      /* shown under the field */
    }
  };

  return (
    <Screen
      footer={
        <Button
          testID="phone-submit"
          label={t('onboarding.send_otp')}
          size="lg"
          fullWidth
          disabled={!e164}
          loading={requestOtp.isPending}
          onPress={() => void submit()}
        />
      }
    >
      <AuthHeader step={1} title={t('onboarding.phone_label')} subtitle={t('onboarding.phone_hint')} />
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
        {/* G0-10 "Chat first": numbers stay hidden both ways. */}
        <View testID="phone-private" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[1] }}>
          <Icon name="shield" size={16} color="successText" strokeWidth={2.2} />
          <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
            {t('partner.f4_private')}
          </Text>
        </View>
      </View>
    </Screen>
  );
}
