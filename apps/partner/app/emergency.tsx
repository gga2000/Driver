import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { EmergencyRelation } from '@driver/contracts';
import { Button, Card, ChipGroup, Icon, RetryState, retryKindFor, Skeleton, Text, TextField, useNetwork, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useUpdateEmergencyContact } from '@/features/account/queries';
import { useMe } from '@/features/work/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { formatPhoneInput, isValidIraqiPhone } from '@/lib/phone';

const RELATIONS = EmergencyRelation.options;

/**
 * رقم للطوارئ (follow-up of the SOS work, scoring & safety §3): who gets a WhatsApp with his live
 * location — then a text if it doesn't arrive — when he holds "طوارئ" on a job. Name, who they are to
 * him and their number go to the identity vault through `identity.updateProfile` (the customer app's
 * own path); only the masked number ever comes back. The SOS sheet names this contact once it is set.
 */
export default function EmergencyContactScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const net = useNetwork();
  const me = useMe();
  const update = useUpdateEmergencyContact();
  const current = me.data?.emergencyContact ?? null;
  const [name, setName] = useState('');
  const [relation, setRelation] = useState<EmergencyRelation | null>(null);
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!current) return;
    setName((n) => n || current.name);
    setRelation((r) => r ?? current.relation ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.name, current?.relation]);
  const phoneOk = isValidIraqiPhone(phone);
  const valid = name.trim().length > 0 && phoneOk;

  const run = async (emergencyContact: { name: string; phone: string; relation?: EmergencyRelation } | null) => {
    try {
      await update.mutateAsync({ emergencyContact });
      toast.show({ message: t(emergencyContact ? 'partner.ec_saved' : 'partner.ec_removed'), tone: 'success', icon: 'check' });
      if (emergencyContact) router.back();
      else {
        setName('');
        setRelation(null);
        setPhone('');
      }
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  return (
    <Screen
      testID="emergency"
      edges={['bottom']}
      footer={
        me.data ? (
          <Button
            testID="emergency-save"
            label={t('partner.ec_save')}
            size="lg"
            fullWidth
            disabled={!valid}
            loading={update.isPending}
            onPress={() => void run({ name: name.trim(), phone, ...(relation ? { relation } : {}) })}
          />
        ) : undefined
      }
    >
      <Stack.Screen options={{ title: t('partner.ec_title') }} />
      <Card padding={4} tone="sunken">
        <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
          <Icon name="shield" size={22} color="accentText" />
          <Text variant="footnote" style={{ flex: 1 }}>
            {t('partner.ec_body')}
          </Text>
        </View>
      </Card>

      {!me.data ? (
        me.isError ? (
          <RetryState kind={retryKindFor({ net, error: me.error })} locale={locale} title={t('partner.ec_failed')} onRetry={() => void me.refetch()} />
        ) : (
          <View testID="emergency-loading" style={{ gap: theme.space[3] }}>
            <Skeleton height={56} />
            <Skeleton height={56} />
          </View>
        )
      ) : (
        <>
          {current ? (
            <Card elevation={0} padding={4} testID="emergency-current">
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3] }}>
                <View style={{ gap: 2, flexShrink: 1 }}>
                  <Text variant="caption" color="textMuted">
                    {t('partner.ec_current')}
                  </Text>
                  <Text variant="label" weight={600}>
                    {current.relation ? `${current.name} · ${t(`partner.ec_rel_${current.relation}`)}` : current.name}
                  </Text>
                  <Text variant="footnote" color="textMuted" tabular>{`⁦${current.phoneMasked}⁩`}</Text>
                </View>
                <Button testID="emergency-delete" size="sm" variant="ghost" label={t('partner.ec_delete')} disabled={update.isPending} onPress={() => void run(null)} style={{ minHeight: 44 }} />
              </View>
            </Card>
          ) : null}
          <TextField testID="emergency-name" label={t('partner.ec_name')} value={name} onChangeText={setName} placeholder={t('partner.ec_name_placeholder')} leadingIcon="user" maxLength={60} />
          <View style={{ gap: theme.space[2] }}>
            <Text variant="label">{t('partner.ec_relation')}</Text>
            <ChipGroup
              mode="single"
              accessibilityLabel={t('partner.ec_relation')}
              items={RELATIONS.map((r) => ({ id: r, label: t(`partner.ec_rel_${r}`) }))}
              value={relation ? [relation] : []}
              onChange={(next) => setRelation((next[0] as EmergencyRelation | undefined) ?? null)}
            />
          </View>
          <TextField
            testID="emergency-phone"
            label={t('partner.ec_phone')}
            value={phone}
            onChangeText={(v) => setPhone(formatPhoneInput(v))}
            onBlur={() => setTouched(true)}
            placeholder="07XX XXX XXXX"
            keyboardType="phone-pad"
            leadingIcon="phone"
            error={touched && phone.length > 0 && !phoneOk ? t('partner.ec_phone_invalid') : undefined}
            hint={current ? t('partner.ec_replace_hint') : undefined}
            maxLength={13}
          />
        </>
      )}
    </Screen>
  );
}
