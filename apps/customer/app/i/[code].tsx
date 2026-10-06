import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { normalizeInviteCode } from '@driver/contracts';
import { Button, Card, Icon, RetryState, retryKindFor, SketchScene, Skeleton, Text, useNetwork, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { claimProblem, ruleLines } from '@/features/invite/invite';
import { useClaimInvite, useInvitePreview } from '@/features/invite/queries';
import { apiErrorCode } from '@/lib/api';
import { requireSignIn } from '@/lib/guest';
import { useLocale, useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';

/**
 * `/i/<code>` (joy g2): what a friend sees when he taps the invitation. Open to guests: the inviter's
 * first name and the rule (the server's numbers). «سجّل وخذ العزيمة» remembers this page, signs him in
 * (and through setup), and on coming back here the invitation is accepted once — only before his
 * first order; the server says no to his own code or a second inviter.
 */
export default function InviteLanding() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const code = normalizeInviteCode(raw ?? '');
  const signedIn = useSignedIn();
  const preview = useInvitePreview(code);
  const claim = useClaimInvite();
  const tried = useRef(false);

  // Signed in (straight away, or back from sign-in): accept once.
  useEffect(() => {
    if (!signedIn || !code || tried.current || !preview.data?.valid) return;
    tried.current = true;
    claim.mutate({ code });
  }, [signedIn, code, preview.data?.valid, claim]);

  const header = <Stack.Screen options={{ headerShown: false }} />;
  const home = () => (router.canDismiss() ? router.dismissAll() : router.replace('/'));

  if (!code || preview.data?.valid === false) {
    return (
      <Screen edges={['top', 'bottom']} testID="invite-landing-invalid">
        {header}
        <SketchScene name="rejected" />
        <Text variant="body" align="center">
          {t('invite.landing_invalid')}
        </Text>
        <Button label={t('invite.landing_home')} variant="secondary" fullWidth onPress={home} />
      </Screen>
    );
  }

  if (!preview.data && (preview.isError || net.state !== 'online')) {
    const kind = retryKindFor({ net, error: preview.error, slow: false });
    return (
      <Screen edges={['top', 'bottom']} testID="invite-landing-error">
        {header}
        <RetryState kind={kind} locale={locale} art={<SketchScene name="offline" />} onRetry={() => void preview.refetch()} />
      </Screen>
    );
  }

  const name = preview.data?.inviterFirstName ?? null;
  const problem = claim.isError ? claimProblem(apiErrorCode(claim.error)) : null;
  const done = claim.isSuccess;

  return (
    <Screen
      edges={['top', 'bottom']}
      testID="invite-landing"
      footer={
        done ? (
          <Button size="lg" fullWidth icon="food" label={t('invite.landing_order')} onPress={() => router.replace('/restaurants')} testID="invite-landing-order" />
        ) : signedIn ? (
          problem ? (
            <Button size="lg" fullWidth variant="secondary" label={t('invite.landing_home')} onPress={home} />
          ) : (
            <Button size="lg" fullWidth label={t('invite.landing_accept_signed')} loading={claim.isPending} disabled={!preview.data} onPress={() => code && claim.mutate({ code })} testID="invite-landing-claim" />
          )
        ) : (
          <Button size="lg" fullWidth icon="gift" label={t('invite.landing_accept')} disabled={!preview.data} onPress={() => void requireSignIn(`/i/${code}`)} testID="invite-landing-accept" />
        )
      }
    >
      {header}
      <SketchScene name={done ? 'door' : 'welcome'} />
      <View style={{ gap: theme.space[2] }}>
        <Text variant="heading" face="voice" align="center" accessibilityRole="header" testID="invite-landing-title">
          {done ? t('invite.landing_done') : name ? t('invite.landing_title', { name }) : t('invite.landing_title_anon')}
        </Text>
        <Text variant="body" color="textMuted" align="center">
          {done ? t('invite.landing_done_body') : t('invite.landing_body')}
        </Text>
      </View>
      {problem ? (
        <Card elevation={0} padding={3} testID="invite-landing-problem">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="x" size={18} color="dangerText" />
            <Text variant="footnote" color="dangerText" style={{ flex: 1 }}>
              {t(problem)}
            </Text>
          </View>
        </Card>
      ) : null}
      <Card elevation={0} padding={4}>
        {preview.data ? (
          <View style={{ gap: theme.space[3] }}>
            {ruleLines(preview.data.rule).map((line, i) => (
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
            <Skeleton height={16} width="70%" />
          </View>
        )}
      </Card>
    </Screen>
  );
}
