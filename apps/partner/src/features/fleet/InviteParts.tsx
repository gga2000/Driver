import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { FleetInvite } from '@driver/contracts';
import { Avatar, Button, Card, Icon, Text, useTheme, useToast, withAlpha } from '@driver/ui';
import { Glyph } from '@/features/account/Glyph';
import { ModalSheet } from '@/features/account/ModalSheet';
import { baghdadDate } from '@/features/ops/logic';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { INVITE_SEES, inviteNames } from './logic';
import { useRespondInvite } from './queries';

/**
 * A fleet owner's invite, from the driver's side (consent, review 2026-10-04 #2): who asks, which
 * fleet, and exactly what the owner will see once he says yes — earnings from that day on, the cash
 * he holds against his cap, his documents, whether he is online or on a job. Accept or decline;
 * nothing about him reaches the owner before he accepts.
 */
export function FleetInviteCard({
  invite,
  onAnswered,
  flat = false,
}: {
  invite: FleetInvite;
  onAnswered?: (accepted: boolean) => void;
  flat?: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const respond = useRespondInvite();
  const [answer, setAnswer] = useState<boolean | null>(null);
  const { owner, fleet, ownerKnown } = inviteNames(invite, t);

  const send = async (accept: boolean) => {
    setAnswer(accept);
    try {
      await respond.mutateAsync({ fleetOrgId: invite.fleetOrgId, accept });
      theme.haptic(accept ? 'success' : 'light');
      toast.show({
        message: accept
          ? t('partner.fleet_invite_accepted', { fleet })
          : t('partner.fleet_invite_declined'),
        tone: accept ? 'success' : 'neutral',
      });
      onAnswered?.(accept);
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    } finally {
      setAnswer(null);
    }
  };

  const body = (
    <View style={{ gap: theme.space[4] }} testID={`fleet-invite-${invite.fleetOrgId}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Avatar
          name={ownerKnown ? owner : undefined}
          {...(ownerKnown ? {} : { icon: 'car' as const })}
          size={48}
          tone="accent"
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title" testID="fleet-invite-title">
            {ownerKnown
              ? t('partner.fleet_invite_title', { owner, fleet })
              : t('partner.fleet_invite_title_noname', { fleet })}
          </Text>
          <Text variant="caption" color="textMuted" tabular>
            {t('partner.fleet_invite_sent_on', { date: baghdadDate(invite.invitedAt) })}
          </Text>
        </View>
      </View>

      <View
        style={{
          gap: theme.space[2],
          padding: theme.space[4],
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.surfaceSunken,
        }}
      >
        <Text variant="label" weight={700}>
          {t('partner.fleet_invite_sees', { owner })}
        </Text>
        {INVITE_SEES.map((s) => (
          <View
            key={s.key}
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}
          >
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: theme.colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {s.icon === 'trend-up' || s.icon === 'id-card' ? (
                <Glyph name={s.icon} size={16} color="accentText" />
              ) : (
                <Icon name={s.icon} size={16} color="accentText" strokeWidth={2.2} />
              )}
            </View>
            <Text variant="label" style={{ flex: 1 }}>
              {t(s.key)}
            </Text>
          </View>
        ))}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[3],
            paddingTop: theme.space[1],
          }}
        >
          <View style={{ width: 30, alignItems: 'center' }}>
            <Icon name="shield" size={16} color="successText" strokeWidth={2.2} />
          </View>
          <Text variant="footnote" color="successText" style={{ flex: 1 }}>
            {t('partner.fleet_invite_not_see')}
          </Text>
        </View>
      </View>

      <Text variant="footnote" color="textMuted">
        {t('partner.fleet_invite_leave_any')}
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
        <Button
          testID="fleet-invite-decline"
          label={t('partner.fleet_invite_decline')}
          variant="secondary"
          style={{ flex: 1 }}
          loading={respond.isPending && answer === false}
          disabled={respond.isPending}
          onPress={() => void send(false)}
        />
        <Button
          testID="fleet-invite-accept"
          label={t('partner.fleet_invite_accept')}
          icon="check"
          style={{ flex: 1.4 }}
          loading={respond.isPending && answer === true}
          disabled={respond.isPending}
          onPress={() => void send(true)}
        />
      </View>
    </View>
  );
  if (flat) return body;
  return (
    <Card
      elevation={1}
      padding={4}
      style={{ borderWidth: 1, borderColor: withAlpha(theme.colors.accent, 0.35) }}
    >
      {body}
    </Card>
  );
}

/**
 * Home: one line about the newest invite ("دعوة من سجاد لأسطول الربيعي"); a tap opens the full card in
 * a sheet, so the decision is made with what the owner will see in front of him.
 */
export function FleetInviteBanner({ invite }: { invite: FleetInvite }) {
  const theme = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  const { owner, fleet } = inviteNames(invite, t);
  return (
    <>
      <Pressable
        testID="fleet-invite-banner"
        accessibilityRole="button"
        onPress={() => {
          theme.haptic('light');
          setOpen(true);
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          padding: theme.space[3],
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.accentTint,
          borderWidth: 1,
          borderColor: withAlpha(theme.colors.accent, 0.35),
          transform: [{ scale: pressed ? 0.985 : 1 }],
        })}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: theme.colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="car" size={22} color="onAccent" strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="label" weight={700} color="accentText" numberOfLines={2}>
            {t('partner.fleet_invite_banner', { owner, fleet })}
          </Text>
          <Text variant="caption" color="text">
            {t('partner.fleet_invite_banner_sub')}
          </Text>
        </View>
        <Icon name="chevron-forward" size={20} color="accentText" strokeWidth={2.4} />
      </Pressable>
      <ModalSheet visible={open} onClose={() => setOpen(false)} testID="fleet-invite-sheet">
        <FleetInviteCard invite={invite} flat onAnswered={() => setOpen(false)} />
      </ModalSheet>
    </>
  );
}

/** Account: the fleet he drives with, who sees what, and a way out (with a confirm step). */
export function FleetMemberCard({ invite }: { invite: FleetInvite }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const respond = useRespondInvite();
  const [confirm, setConfirm] = useState(false);
  const { owner, fleet } = inviteNames(invite, t);
  const leave = async () => {
    try {
      await respond.mutateAsync({ fleetOrgId: invite.fleetOrgId, accept: false });
      setConfirm(false);
      toast.show({ message: t('partner.fleet_member_left', { fleet }), tone: 'neutral' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };
  return (
    <Card elevation={0} padding={4} testID={`fleet-member-${invite.fleetOrgId}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: theme.colors.infoTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="car" size={20} color="infoText" strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={700}>
            {t('partner.fleet_member_title', { fleet })}
          </Text>
          <Text variant="caption" color="textMuted">
            {t('partner.fleet_member_sub', { owner })}
          </Text>
        </View>
      </View>
      <View style={{ paddingStart: 40 + theme.space[3], paddingTop: theme.space[1] }}>
        <Button
          testID="fleet-member-leave"
          label={t('partner.fleet_member_leave')}
          variant="ghost"
          size="sm"
          style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }}
          onPress={() => setConfirm(true)}
        />
      </View>
      <ModalSheet
        visible={confirm}
        onClose={() => setConfirm(false)}
        title={t('partner.fleet_member_leave_title', { fleet })}
        testID="fleet-leave-sheet"
      >
        <Text variant="body" color="textMuted">
          {t('partner.fleet_member_leave_body')}
        </Text>
        <View style={{ gap: theme.space[2] }}>
          <Button
            testID="fleet-leave-confirm"
            label={t('partner.fleet_member_leave_cta')}
            variant="destructive"
            size="lg"
            fullWidth
            loading={respond.isPending}
            onPress={() => void leave()}
          />
          <Button
            label={t('action.cancel')}
            variant="ghost"
            fullWidth
            onPress={() => setConfirm(false)}
          />
        </View>
      </ModalSheet>
    </Card>
  );
}
