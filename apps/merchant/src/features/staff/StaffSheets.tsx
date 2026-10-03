import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { MerchantStaffRole, StaffMember } from '@driver/contracts';
import { Avatar, Button, Text, TextField, useTheme, useToast } from '@driver/ui';
import { MIcon, type MIconName } from '@/components/MIcon';
import { ModalSheet } from '@/components/ModalSheet';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { formatPhoneInput, normalizeIraqiPhone } from '@/lib/phone';
import { isLastOwner } from './logic';
import { useStaffActions } from './queries';

const ROLES: ReadonlyArray<{ role: MerchantStaffRole; icon: MIconName; title: 'merchant.staff.role_owner' | 'merchant.staff.role_staff'; hint: 'merchant.staff.role_owner_hint' | 'merchant.staff.role_staff_hint' }> = [
  { role: 'merchant_staff', icon: 'receipt', title: 'merchant.staff.role_staff', hint: 'merchant.staff.role_staff_hint' },
  { role: 'merchant_owner', icon: 'shield', title: 'merchant.staff.role_owner', hint: 'merchant.staff.role_owner_hint' },
];

/** Role cards (radio): موظف — orders and menu only; مالك — sees money and staff. */
export function RolePicker({ value, onChange, disabled }: { value: MerchantStaffRole; onChange: (r: MerchantStaffRole) => void; disabled?: boolean }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ gap: theme.space[2] }} accessibilityRole="radiogroup">
      {ROLES.map((r) => {
        const selected = value === r.role;
        return (
          <Pressable
            key={r.role}
            testID={`role-${r.role}`}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(r.role)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[3],
              padding: theme.space[4],
              borderRadius: theme.radius.lg,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? theme.colors.text : theme.colors.border,
              backgroundColor: selected ? theme.colors.surfaceSunken : theme.colors.surface,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: r.role === 'merchant_owner' ? theme.colors.accentTint : theme.colors.infoTint, alignItems: 'center', justifyContent: 'center' }}>
              <MIcon name={r.icon} size={20} color={r.role === 'merchant_owner' ? 'accentText' : 'infoText'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{t(r.title)}</Text>
              <Text variant="footnote" color="textMuted">
                {t(r.hint)}
              </Text>
            </View>
            <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? theme.colors.text : theme.colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
              {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.text }} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** "ضيف موظف": phone + role. The person signs in with that number and finds the store. */
export function InviteSheet({ merchantOrgId, visible, onClose }: { merchantOrgId: string; visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { invite } = useStaffActions();
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<MerchantStaffRole>('merchant_staff');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (visible) {
      setPhone('');
      setRole('merchant_staff');
      setTouched(false);
    }
  }, [visible]);
  if (!visible) return null;
  const e164 = normalizeIraqiPhone(phone);
  const submit = async () => {
    setTouched(true);
    if (!e164) return;
    try {
      await invite.mutateAsync({ merchantOrgId, phone: e164, role });
      toast.show({ message: t('merchant.staff.invited'), tone: 'success' });
      onClose();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };
  return (
    <ModalSheet
      visible
      onClose={onClose}
      testID="invite-sheet"
      title={t('merchant.staff.invite_title')}
      subtitle={t('merchant.staff.invite_body')}
      footer={<Button testID="invite-confirm" label={t('merchant.staff.invite_confirm')} icon="plus" size="lg" fullWidth loading={invite.isPending} disabled={!e164} onPress={() => void submit()} />}
    >
      <TextField
        testID="invite-phone"
        label={t('merchant.staff.phone_label')}
        value={phone}
        onChangeText={(v) => setPhone(formatPhoneInput(v))}
        onBlur={() => setTouched(true)}
        placeholder="0770 123 4567"
        keyboardType="phone-pad"
        leadingIcon="phone"
        error={touched && phone.length > 0 && !e164 ? t('merchant.staff.phone_invalid') : undefined}
        style={{ direction: 'ltr' } as object}
      />
      <View style={{ gap: theme.space[2] }}>
        <Text variant="title">{t('merchant.staff.role_q')}</Text>
        <RolePicker value={role} onChange={setRole} />
      </View>
    </ModalSheet>
  );
}

/** One person: change the role, or remove from the store (with a confirm step). */
export function MemberSheet({ merchantOrgId, member, all, onClose }: { merchantOrgId: string; member: StaffMember | null; all: readonly StaffMember[]; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { setRole, remove } = useStaffActions();
  const [role, setRoleState] = useState<MerchantStaffRole>('merchant_staff');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (member) {
      setRoleState(member.role);
      setConfirm(false);
    }
  }, [member]);
  if (!member) return null;
  const name = member.name ?? t('merchant.staff.no_name');
  const last = isLastOwner(all, member.personId);
  const fail = (err: unknown) =>
    toast.show({ message: apiErrorCode(err) === 'staff_last_owner' ? t('merchant.staff.last_owner') : apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
  const save = async () => {
    try {
      await setRole.mutateAsync({ merchantOrgId, personId: member.personId, role });
      toast.show({ message: t('merchant.staff.role_saved'), tone: 'success' });
      onClose();
    } catch (err) {
      fail(err);
    }
  };
  const doRemove = async () => {
    try {
      await remove.mutateAsync({ merchantOrgId, personId: member.personId });
      toast.show({ message: t('merchant.staff.removed'), tone: 'neutral' });
      onClose();
    } catch (err) {
      fail(err);
    }
  };
  if (confirm) {
    return (
      <ModalSheet
        visible
        onClose={() => setConfirm(false)}
        testID="remove-sheet"
        title={t('merchant.staff.remove_title', { name })}
        footer={
          <View style={{ gap: theme.space[2] }}>
            <Button testID="remove-confirm" label={t('merchant.staff.remove_confirm')} variant="destructive" size="lg" fullWidth loading={remove.isPending} onPress={() => void doRemove()} />
            <Button label={t('merchant.common.cancel')} variant="ghost" fullWidth onPress={() => setConfirm(false)} />
          </View>
        }
      >
        <View style={{ alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[2] }}>
          <Avatar name={member.name ?? undefined} size={64} tone="warning" />
          <Text variant="body" color="textMuted" align="center" style={{ maxWidth: 420 }}>
            {t('merchant.staff.remove_body')}
          </Text>
        </View>
      </ModalSheet>
    );
  }
  return (
    <ModalSheet
      visible
      onClose={onClose}
      testID="member-sheet"
      title={name}
      subtitle={member.phoneMasked ? `⁦${member.phoneMasked}⁩` : undefined}
      footer={
        member.you ? undefined : (
          <View style={{ gap: theme.space[2] }}>
            <Button testID="role-save" label={t('merchant.staff.save_role')} size="lg" fullWidth disabled={role === member.role} loading={setRole.isPending} onPress={() => void save()} />
            <Button testID="member-remove" label={member.pending ? t('merchant.staff.cancel_invite') : t('merchant.staff.remove')} variant="ghost" fullWidth disabled={last} onPress={() => setConfirm(true)} />
          </View>
        )
      }
    >
      {member.you ? (
        <Text variant="body" color="textMuted">
          {t('merchant.staff.you_note')}
        </Text>
      ) : null}
      <Text variant="title">{t('merchant.staff.change_role')}</Text>
      <RolePicker value={role} onChange={setRoleState} disabled={member.you || last} />
      {last ? (
        <Text variant="footnote" color="warningText">
          {t('merchant.staff.last_owner')}
        </Text>
      ) : null}
    </ModalSheet>
  );
}
