import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Icon, Text, useTheme } from '@driver/ui';
import { AuthStage } from '@/features/auth/AuthStage';
import { PhoneField } from '@/features/auth/PhoneField';
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
  const [title, accent] =
    reason === 'order'
      ? [t('auth.phone_title_order'), t('auth.phone_accent_order')]
      : reason === 'book'
        ? [t('auth.phone_title_book'), t('auth.phone_accent_book')]
        : [t('auth.phone_title'), t('auth.phone_accent')];

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
      // No channel: SMS, or WhatsApp on a day the SMS budget is spent; the code screen says which.
      const res = await requestOtp.mutateAsync({ phone: e164, purpose: 'login', device: await getDeviceInfo() });
      router.push({ pathname: '/otp', params: { phone: e164, masked: res.phoneMasked, resendAfter: String(res.resendAfterSec), channel: res.channel ?? 'sms' } });
    } catch {
      /* shown under the field */
    }
  };

  return (
    <AuthStage
      step={1}
      title={title}
      accent={accent}
      ticket={reason === 'order'}
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
      <PhoneField
        testID="phone-input"
        label={t('onboarding.phone_label')}
        value={value}
        onChangeText={(v) => {
          setValue(formatPhoneInput(v));
          if (requestOtp.error) requestOtp.reset();
        }}
        onBlur={() => setTouched(true)}
        onSubmitEditing={() => void submit()}
        placeholder={t('onboarding.phone_placeholder')}
        autoFocus
        error={showInvalid ? t('error.phone_invalid') : serverError}
      />
      {/* Why a number, and that it is the whole account: no password, no email. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 36, height: 36, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentTint }}>
          <Icon name="shield" size={18} color="accentText" />
        </View>
        <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
          {t('auth.phone_promise')}
        </Text>
      </View>
    </AuthStage>
  );
}
