import { router, Stack } from 'expo-router';
import { Linking, Share, View } from 'react-native';
import { Button, Card, Icon, RetryState, retryKindFor, SketchScene, Skeleton, StatusPill, Text, useNetwork, useTheme, useToast } from '@driver/ui';
import { HeaderBack } from '@/features/food/HeaderBack';
import { Screen } from '@/components/Screen';
import { friendLabel, friendTone, inviteMessage, progressCopy, ruleLines } from '@/features/invite/invite';
import { useInvite } from '@/features/invite/queries';
import { shareUrl } from '@/features/rajaa/share';
import { useLocale, useT } from '@/lib/i18n';
import { requireSignIn } from '@/lib/guest';
import { useSignedIn } from '@/lib/session';

/**
 * «عزّم صديقك» (joy g2): the referral framed as a gift to a friend, on the rule the ledger already
 * has (`referral.mine` → 200 points each, worth 2,000 دينار, with the friend's 2nd cash order of
 * 10,000+, up to 10 friends a month — the server's numbers, worded here). Sent in the person's own
 * name on WhatsApp (the link opens `/i/<code>` with its preview card) or any other app.
 */
export default function InviteScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const net = useNetwork();
  const signedIn = useSignedIn();
  const invite = useInvite();
  const data = invite.data;

  const header = <Stack.Screen options={{ title: t('invite.title'), headerLeft: () => <HeaderBack /> }} />;

  if (!signedIn) {
    return (
      <Screen edges={['bottom']} testID="invite-guest">
        {header}
        <SketchScene name="welcome" />
        <Text variant="body" align="center">
          {t('invite.guest')}
        </Text>
        <Button
          label={t('invite.sign_in')}
          fullWidth
          onPress={() => void requireSignIn('/invite')}
          testID="invite-sign-in"
        />
      </Screen>
    );
  }

  if (!data && (invite.isError || net.state !== 'online')) {
    const kind = retryKindFor({ net, error: invite.error, slow: false });
    return (
      <Screen edges={['bottom']} testID="invite-error">
        {header}
        <RetryState kind={kind} locale={locale} art={kind === 'offline' || kind === 'unreachable' ? <SketchScene name="offline" /> : undefined} onRetry={() => void invite.refetch()} />
      </Screen>
    );
  }

  const url = data ? shareUrl(data.path) : '';
  const message = data ? t(inviteMessage({ url, code: data.code, rule: data.rule }).key, inviteMessage({ url, code: data.code, rule: data.rule }).params) : '';
  const sendWhatsApp = async () => {
    try {
      await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
    } catch {
      toast.show({ message: t('sticker.failed'), tone: 'danger' });
    }
  };
  const shareOther = async () => {
    try {
      await Share.share({ message });
    } catch {
      toast.show({ message: t('sticker.failed'), tone: 'danger' });
    }
  };
  const progress = data ? progressCopy(data.invited, data.rewarded) : null;

  return (
    <Screen
      edges={['bottom']}
      testID="invite"
      footer={
        <View style={{ gap: theme.space[2] }}>
          <Button size="lg" fullWidth icon="share" label={t('invite.send_whatsapp')} disabled={!data} onPress={() => void sendWhatsApp()} testID="invite-whatsapp" />
          <Button variant="secondary" fullWidth label={t('invite.share')} disabled={!data} onPress={() => void shareOther()} testID="invite-share" />
        </View>
      }
    >
      {header}
      <SketchScene name="welcome" />
      <View style={{ gap: theme.space[2] }}>
        <Text variant="heading" face="voice" align="center" accessibilityRole="header">
          {t('invite.title')}
        </Text>
        <Text variant="body" color="textMuted" align="center">
          {data && !data.rule.rewardsOn ? t('invite.subtitle_plain') : t('invite.subtitle')}
        </Text>
      </View>
      {data && !data.rule.rewardsOn ? null : (
      <Card elevation={0} padding={4} testID="invite-rule">
        {data ? (
          <View style={{ gap: theme.space[3] }}>
            {ruleLines(data.rule).map((line, i) => (
              <View key={line.key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
                <View style={{ marginTop: 2 }}>
                  <Icon name={i === 0 ? 'gift' : i === 1 ? 'receipt' : 'family'} size={18} color={i === 0 ? 'accentText' : 'textMuted'} />
                </View>
                <Text variant={i === 0 ? 'label' : 'footnote'} weight={i === 0 ? 600 : undefined} tabular style={{ flex: 1 }}>
                  {t(line.key, line.params)}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={{ gap: theme.space[2] }}>
            <Skeleton height={18} />
            <Skeleton height={16} width="80%" />
            <Skeleton height={16} width="50%" />
          </View>
        )}
      </Card>
      )}
      {data ? (
        <View style={{ alignItems: 'center', gap: theme.space[1] }}>
          <Text variant="caption" color="textMuted">
            {t('invite.code_label')}
          </Text>
          <Text variant="numeralMd" tabular selectable testID="invite-code" style={{ letterSpacing: 4 }}>
            {data.code}
          </Text>
          {progress ? (
            <Text variant="footnote" color="textMuted" align="center" testID="invite-progress">
              {t(progress.key, progress.params)}
            </Text>
          ) : null}
        </View>
      ) : null}
      {data && data.friends.length > 0 ? (
        <Card elevation={0} padding={0} testID="invite-friends">
          <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[3] }}>
            <Text variant="label" weight={600}>
              {t('invite.friends_title')}
            </Text>
          </View>
          {data.friends.map((f, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 48, paddingHorizontal: theme.space[4], borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.colors.border }}>
              <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
                {f.firstName ?? t('invite.friend_no_name')}
              </Text>
              <StatusPill size="sm" tone={friendTone(f.state)} label={t(friendLabel(f.state))} />
            </View>
          ))}
        </Card>
      ) : null}
      <Button variant="ghost" icon="heart" label={t('invite.stickers_link')} onPress={() => router.push('/stickers')} testID="invite-stickers" style={{ alignSelf: 'center' }} />
    </Screen>
  );
}
