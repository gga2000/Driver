import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { CheckInChallenge } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, Card, Icon, Skeleton, StatusPill, Text, useTheme, useToast, type IconName } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { GestureIllustration, ResultMark, SelfieFrame } from '@/features/account/CheckInParts';
import { Glyph } from '@/features/account/Glyph';
import { clockTime, secondsLeftOf } from '@/features/account/logic';
import { pickPhoto, uploadPhoto, type PickedPhoto } from '@/features/account/photo';
import { useAccountMutations, useCheckInStatus, useRefreshAccount } from '@/features/account/queries';
import { clock } from '@/features/work/logic';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

type Phase = { kind: 'idle' } | { kind: 'challenge'; c: CheckInChallenge } | { kind: 'preview'; c: CheckInChallenge; photo: PickedPhoto } | { kind: 'checking'; c: CheckInChallenge; photo: PickedPhoto } | { kind: 'passed' } | { kind: 'failed' };

/**
 * التسجيل اليومي (scoring §2): a liveness selfie at the first online of each day. A random move
 * (`driverAccount.checkInChallenge`, 2 minutes) shown on an animated face → the selfie (front camera,
 * the file picker on the web) → signed upload → `submitCheckIn`. Passed: "متحقق اليوم ✓" and the
 * switch opens. Failed: one more try. Two failures lock him out for the day and alert ops.
 */
export default function CheckIn() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const status = useCheckInStatus();
  const m = useAccountMutations();
  const refresh = useRefreshAccount();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [now, setNow] = useState(Date.now());
  const s = status.data;

  const challenge = phase.kind === 'challenge' || phase.kind === 'preview' || phase.kind === 'checking' ? phase.c : null;
  useEffect(() => {
    if (!challenge) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [challenge]);
  const left = challenge ? secondsLeftOf(challenge.expiresAt, now) : 0;
  useEffect(() => {
    if (challenge && left === 0 && phase.kind !== 'checking') {
      toast.show({ message: t('partner.checkin_expired'), tone: 'warning' });
      setPhase({ kind: 'idle' });
    }
  }, [challenge, left, phase.kind, t, toast]);

  const start = async () => {
    try {
      const c = await m.challenge.mutateAsync();
      setNow(Date.now());
      setPhase({ kind: 'challenge', c });
    } catch (err) {
      if (apiErrorCode(err) === 'checkin_locked') await refresh();
      else toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  const shoot = async (c: CheckInChallenge) => {
    const got = await pickPhoto('camera', { selfie: true });
    if (got === 'denied') toast.show({ message: t('error.camera_denied'), tone: 'warning' });
    else if (got) setPhase({ kind: 'preview', c, photo: got });
  };

  const send = async (c: CheckInChallenge, photo: PickedPhoto) => {
    setPhase({ kind: 'checking', c, photo });
    try {
      const uploadId = await uploadPhoto(photo, (input) => m.ticket.mutateAsync(input));
      const res = await m.submitCheckIn.mutateAsync({ challengeId: c.challengeId, uploadId });
      theme.haptic(res.result === 'passed' ? 'success' : 'warning');
      await refresh();
      setPhase(res.result === 'passed' ? { kind: 'passed' } : res.lockedOut ? { kind: 'idle' } : { kind: 'failed' });
    } catch (err) {
      const code = apiErrorCode(err);
      if (code === 'checkin_locked' || code === 'checkin_challenge_invalid') {
        await refresh();
        setPhase({ kind: 'idle' });
      } else setPhase({ kind: 'preview', c, photo });
      toast.show({ message: err instanceof Error && /^(upload_|photo_size)/.test(err.message) ? t('partner.docs_upload_failed') : apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  let body: React.ReactNode;
  if (!s) {
    body = (
      <Card elevation={1} padding={5}>
        <Skeleton lines={5} />
      </Card>
    );
  } else if (phase.kind === 'passed' || (phase.kind === 'idle' && s.verifiedToday)) {
    body = (
      <Result
        testID="checkin-passed"
        kind="passed"
        title={phase.kind === 'passed' ? t('partner.checkin_ok') : t('partner.checkin_verified_title')}
        body={phase.kind === 'passed' ? t('partner.checkin_passed_body') : t('partner.checkin_verified_at', { time: s.verifiedAt ? clockTime(s.verifiedAt) : '' })}
        badge={s.badge_ar ?? t('partner.checkin_verified_title')}
        action={{ label: phase.kind === 'passed' ? t('partner.checkin_go_online') : t('partner.checkin_back_home'), onPress: () => router.navigate('/'), testID: 'checkin-done' }}
      />
    );
  } else if (s.lockedOut) {
    body = (
      <Result
        testID="checkin-locked"
        kind="locked"
        title={t('partner.checkin_locked_title')}
        body={t('partner.checkin_locked')}
        action={{ label: t('partner.checkin_call_ops'), icon: 'chat', onPress: () => toast.show({ message: t('partner.stub_toast'), tone: 'info' }), testID: 'checkin-call-ops' }}
        secondary={{ label: t('partner.checkin_back_home'), onPress: () => router.navigate('/') }}
      />
    );
  } else if (phase.kind === 'failed') {
    body = (
      <Result
        testID="checkin-failed"
        kind="failed"
        title={t('partner.checkin_failed_title')}
        body={t('partner.f8_failed_left')}
        tips
        attempt={s.failuresToday + 1}
        action={{ label: t('partner.checkin_try_again'), onPress: () => void start(), testID: 'checkin-retry', loading: m.challenge.isPending }}
      />
    );
  } else if (phase.kind === 'challenge') {
    const c = phase.c;
    const { minutes, seconds } = clock(left * 1000);
    body = (
      <View style={{ gap: theme.space[5] }}>
        <Card testID="checkin-challenge" elevation={2} padding={5}>
          <View style={{ alignItems: 'center', gap: theme.space[4] }}>
            <StatusPill tone={left <= 30 ? 'warning' : 'neutral'} icon="clock" label={t('partner.checkin_time_left', { minutes, seconds })} style={{ alignSelf: 'center' }} />
            <GestureIllustration gesture={c.gesture} />
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Text variant="footnote" color="textMuted">
                {t('partner.checkin_step_gesture')}
              </Text>
              <Text testID="checkin-gesture" variant="heading" align="center">
                {c.gesture_ar}
              </Text>
            </View>
          </View>
        </Card>
        <Tip text={t('partner.checkin_tips')} />
      </View>
    );
  } else if (phase.kind === 'preview' || phase.kind === 'checking') {
    const checking = phase.kind === 'checking';
    body = (
      <View style={{ gap: theme.space[5], alignItems: 'stretch' }}>
        <Text variant="heading" align="center">
          {checking ? t('partner.checkin_checking') : t('partner.checkin_preview_title')}
        </Text>
        <SelfieFrame uri={phase.photo.uri} scanning={checking} />
        <StatusPill tone="accent" icon="user" label={t('partner.checkin_gesture_chip', { gesture: phase.c.gesture_ar })} style={{ alignSelf: 'center' }} />
      </View>
    );
  } else {
    body = (
      <View style={{ gap: theme.space[5] }}>
        <Card testID="checkin-intro" elevation={2} padding={5}>
          <View style={{ alignItems: 'center', gap: theme.space[4] }}>
            <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
              <Glyph name="face" size={48} color="accentText" strokeWidth={1.8} />
            </View>
            <View style={{ alignItems: 'center', gap: theme.space[1] }}>
              <Text variant="heading" align="center">
                {t('partner.checkin_required_title')}
              </Text>
              <Text variant="body" color="textMuted" align="center">
                {t('partner.checkin_required_body')}
              </Text>
            </View>
            {s.failuresToday > 0 ? <StatusPill tone="warning" icon="clock" label={t('partner.checkin_attempt', { n: s.failuresToday + 1 })} style={{ alignSelf: 'center' }} /> : null}
          </View>
        </Card>
        <View style={{ gap: theme.space[3] }}>
          <Step n={1} text={t('partner.checkin_step_1')} />
          <Step n={2} text={t('partner.checkin_step_2')} />
          <Step n={3} text={t('partner.checkin_tips')} />
        </View>
        <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center', paddingHorizontal: theme.space[1] }}>
          <Icon name="shield" size={18} color="textMuted" strokeWidth={2} />
          <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {t('partner.checkin_why')}
          </Text>
        </View>
      </View>
    );
  }

  const footer =
    s && !s.lockedOut && !(phase.kind === 'idle' && s.verifiedToday) && phase.kind !== 'passed' && phase.kind !== 'failed' ? (
      phase.kind === 'challenge' ? (
        <Button testID="checkin-shoot" label={t('partner.checkin_take')} icon="user" size="lg" fullWidth onPress={() => void shoot(phase.c)} />
      ) : phase.kind === 'preview' || phase.kind === 'checking' ? (
        <View style={{ gap: theme.space[2] }}>
          <Button testID="checkin-send" label={t('partner.checkin_send')} size="lg" fullWidth loading={phase.kind === 'checking'} loadingLabel={t('partner.checkin_checking')} onPress={() => void send(phase.c, phase.photo)} />
          <Button testID="checkin-retake" label={t('partner.checkin_retake')} variant="ghost" fullWidth disabled={phase.kind === 'checking'} onPress={() => void shoot(phase.c)} />
        </View>
      ) : (
        <Button testID="checkin-start" label={t('partner.checkin_start')} loading={m.challenge.isPending} loadingLabel={t('partner.checkin_starting')} size="lg" fullWidth onPress={() => void start()} />
      )
    ) : undefined;

  return (
    <Screen testID="checkin" edges={['bottom']} footer={footer}>
      <Stack.Screen options={{ title: t('partner.hub_checkin') }} />
      {body}
    </Screen>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.text, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="caption" weight={700} color="bg" tabular>
          {n}
        </Text>
      </View>
      <Text variant="label" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

function Tip({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center', backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
      <Glyph name="camera" size={18} color="textMuted" />
      <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}


/** f8: why a selfie doesn't match, in the order it usually goes wrong: light, distance, a covered face. */
const RETRY_TIPS: ReadonlyArray<{ key: MessageKey; icon: IconName }> = [
  { key: 'partner.f8_tip_light', icon: 'bulb' },
  { key: 'partner.f8_tip_close', icon: 'camera' },
  { key: 'partner.f8_tip_clear', icon: 'user' },
];
function Result({
  kind,
  title,
  body,
  badge,
  attempt,
  tips = false,
  action,
  secondary,
  testID,
}: {
  kind: 'passed' | 'failed' | 'locked';
  /** f8: after a failed match, the three things that make the next selfie match. */
  tips?: boolean;
  title: string;
  body: string;
  badge?: string;
  attempt?: number;
  action: { label: string; onPress: () => void; testID: string; icon?: 'chat'; loading?: boolean };
  secondary?: { label: string; onPress: () => void };
  testID: string;
}) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID={testID} style={{ gap: theme.space[5], paddingTop: theme.space[6] }}>
      <ResultMark kind={kind} />
      <View style={{ alignItems: 'center', gap: theme.space[2] }}>
        <Text variant="heading" align="center">
          {title}
        </Text>
        <Text variant="body" color="textMuted" align="center">
          {body}
        </Text>
        {badge ? <StatusPill tone="success" label={badge} style={{ alignSelf: 'center', marginTop: theme.space[1] }} /> : null}
        {attempt ? <StatusPill tone="warning" icon="clock" label={t('partner.checkin_attempt', { n: attempt })} style={{ alignSelf: 'center', marginTop: theme.space[1] }} /> : null}
      </View>
      {tips ? (
        <View testID="checkin-tips" style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
          <Text variant="label" weight={700}>
            {t('partner.f8_tips_title')}
          </Text>
          {RETRY_TIPS.map((tip) => (
            <View key={tip.key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={tip.icon} size={18} color="accentText" strokeWidth={2.2} />
              </View>
              <Text variant="label" style={{ flex: 1 }}>
                {t(tip.key)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ gap: theme.space[2] }}>
        <Button testID={action.testID} label={action.label} icon={action.icon} loading={action.loading} size="lg" fullWidth onPress={action.onPress} />
        {secondary ? <Button label={secondary.label} variant="ghost" fullWidth onPress={secondary.onPress} /> : null}
      </View>
    </View>
  );
}
