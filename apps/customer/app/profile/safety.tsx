import { useState } from 'react';
import { View } from 'react-native';
import { TRUSTED_CONTACTS_MAX, type SafetyPrefs, type UpdateProfileInput } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Avatar, Button, Card, EmptyState, Icon, Skeleton, StatusPill, Text, TextField, Toggle, useTheme, useToast, type IconName } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { useMe, useUpdateProfile } from '@/features/account/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { isValidIraqiPhone } from '@/lib/phone';

type TrustedEdit = NonNullable<UpdateProfileInput['trustedContacts']>[number];

const SWITCHES: { key: keyof SafetyPrefs; title: MessageKey; body: MessageKey; icon: IconName }[] = [
  { key: 'notifyOnArrival', title: 'safety.switch_arrival', body: 'safety.switch_arrival_body', icon: 'check' },
  { key: 'autoShareRajaa', title: 'safety.switch_rajaa', body: 'safety.switch_rajaa_body', icon: 'rajaa' },
  { key: 'autoShareNight', title: 'safety.switch_night', body: 'safety.switch_night_body', icon: 'taxi' },
];

const PROTECT: { icon: IconName; key: MessageKey }[] = [
  { icon: 'shield', key: 'safety.protect_verified' },
  { icon: 'car', key: 'safety.protect_plate' },
  { icon: 'seat', key: 'safety.protect_seat_rule' },
  { icon: 'check-double', key: 'safety.protect_pin' },
  { icon: 'sos', key: 'safety.protect_sos' },
];

/**
 * الأمان (joy w9, audit A-01): a place, not a field. (1) «ناس نثق بيهم»: up to three people, the first
 * is the emergency contact (SOS calls them). (2) Switches: tell them when I arrive, share الرجعة trips,
 * share night rides. (3) «شلون نحميك»: what already protects every trip. Names and numbers live in the
 * identity vault; numbers come back masked, so a kept person is sent back by position, never re-typed.
 */
export default function Safety() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const me = useMe();
  const update = useUpdateProfile();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const contacts = me.data?.trustedContacts ?? [];
  const prefs = me.data?.safety;
  const valid = name.trim().length > 0 && isValidIraqiPhone(phone);

  const save = async (input: UpdateProfileInput, done: MessageKey) => {
    try {
      await update.mutateAsync(input);
      toast.show({ message: t(done), tone: 'success' });
      return true;
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
      return false;
    }
  };
  const kept = (skip?: number): TrustedEdit[] => contacts.map((_, i) => ({ keep: i })).filter((_, i) => i !== skip);

  const add = async () => {
    if (await save({ trustedContacts: [...kept(), { name: name.trim(), phone }] }, 'safety.contact_added')) {
      setName('');
      setPhone('');
      setAdding(false);
    }
  };

  if (me.isPending) {
    return (
      <Screen edges={['bottom']} testID="safety">
        <Skeleton height={120} radius={20} />
        <Skeleton height={180} radius={20} />
      </Screen>
    );
  }
  if (me.isError || !me.data) {
    return (
      <Screen edges={['bottom']} testID="safety">
        <EmptyState icon="shield" title={apiErrorMessage(me.error, t('error.network'), locale)} action={{ label: t('action.retry'), onPress: () => void me.refetch() }} />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']} testID="safety" contentStyle={{ gap: theme.space[6] }}>
      {/* 1 · the people */}
      <View style={{ gap: theme.space[3] }}>
        <View style={{ gap: 2 }}>
          <SectionHeader title={t('safety.people_title')} />
          <Text variant="footnote" color="textMuted">
            {t('safety.people_body')}
          </Text>
        </View>
        <Card elevation={0} padding={0} testID="safety-people">
          {contacts.length === 0 && !adding ? (
            <View style={{ padding: theme.space[4], gap: theme.space[2] }}>
              <Text variant="body">{t('safety.people_empty')}</Text>
            </View>
          ) : null}
          {contacts.map((c, i) => (
            <View
              key={`${c.phoneMasked}-${i}`}
              testID={`safety-contact-${i}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[4], borderBottomWidth: i < contacts.length - 1 || adding ? 1 : 0, borderBottomColor: theme.colors.border }}
            >
              <Avatar name={c.name} size={44} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" weight={600} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text variant="footnote" color="textMuted" tabular>{`⁦${c.phoneMasked}⁩`}</Text>
                {i === 0 ? (
                  <View style={{ flexDirection: 'row' }}>
                    <StatusPill size="sm" tone="neutral" icon="sos" label={t('safety.first_is_emergency')} />
                  </View>
                ) : null}
              </View>
              <Button testID={`safety-remove-${i}`} size="sm" variant="ghost" label={t('safety.remove')} disabled={update.isPending} onPress={() => void save({ trustedContacts: kept(i) }, 'safety.contact_removed')} />
            </View>
          ))}
          {adding ? (
            <View style={{ padding: theme.space[4], gap: theme.space[3] }} testID="safety-add-form">
              <TextField testID="emergency-name" label={t('profile.emergency_name')} value={name} onChangeText={setName} placeholder={t('profile.emergency_name_placeholder')} leadingIcon="user" maxLength={60} />
              <TextField testID="emergency-phone" label={t('profile.emergency_phone')} value={phone} onChangeText={setPhone} placeholder="07XX XXX XXXX" keyboardType="phone-pad" leadingIcon="phone" maxLength={16} />
              <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
                <Button testID="emergency-save" style={{ flex: 1 }} label={t('action.save')} disabled={!valid} loading={update.isPending} onPress={() => void add()} />
                <Button style={{ flex: 1 }} variant="secondary" label={t('action.cancel')} onPress={() => setAdding(false)} />
              </View>
            </View>
          ) : null}
        </Card>
        {!adding && contacts.length < TRUSTED_CONTACTS_MAX ? (
          <Button testID="safety-add" variant="secondary" icon="plus" label={contacts.length === 0 ? t('safety.add_first') : t('safety.add_more')} onPress={() => setAdding(true)} />
        ) : null}
      </View>

      {/* 2 · the switches */}
      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('safety.switches_title')} />
        <Card elevation={0} padding={0}>
          {SWITCHES.map((s, i) => {
            const on = prefs?.[s.key] ?? false;
            const needsPeople = contacts.length === 0;
            return (
              <View
                key={s.key}
                style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 64, padding: theme.space[4], borderBottomWidth: i < SWITCHES.length - 1 ? 1 : 0, borderBottomColor: theme.colors.border, opacity: needsPeople ? 0.55 : 1 }}
              >
                <Icon name={s.icon} size={22} color="textMuted" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label" weight={600}>
                    {t(s.title)}
                  </Text>
                  <Text variant="footnote" color="textMuted">
                    {t(s.body)}
                  </Text>
                </View>
                <Toggle
                  testID={`safety-switch-${s.key}`}
                  accessibilityLabel={t(s.title)}
                  value={on}
                  disabled={needsPeople || update.isPending}
                  onValueChange={(v) => void save({ safety: { [s.key]: v } }, v ? 'safety.switch_on' : 'safety.switch_off')}
                />
              </View>
            );
          })}
        </Card>
        {contacts.length === 0 ? (
          <Text variant="caption" color="textMuted">
            {t('safety.switches_need_people')}
          </Text>
        ) : null}
      </View>

      {/* 3 · how we protect you */}
      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('safety.protect_title')} />
        <Card elevation={0} padding={4} tone="sunken">
          <View style={{ gap: theme.space[3] }}>
            {PROTECT.map((p) => (
              <View key={p.key} style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'flex-start' }}>
                <Icon name={p.icon} size={18} color="text" />
                <Text variant="footnote" style={{ flex: 1 }}>
                  {t(p.key)}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      </View>
    </Screen>
  );
}
