import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SAFETY_RULES } from '@driver/contracts';
import { Button, EmptyState, Icon, ltr, RetryState, retryKindFor, Skeleton, StaleNote, StatusPill, Text, useLoadTimeout, useNetwork, useTheme } from '@driver/ui';
import { Wordmark } from '@/components/Wordmark';
import { apiErrorMessage, useApi } from '@/lib/api';
import { publicPageFailure, shouldRetryQuery } from '@/lib/errors';
import { useLocale, useT } from '@/lib/i18n';

const POLL_MS = 5_000;

/**
 * The emergency contact's page (`/sos/<token>`, no sign-in; scoring & safety §3). The person they
 * are the emergency contact of held "طوارئ": the page says so calmly, shows the last position their
 * phone sent (refreshed every 5 s while the alert is open) with a link to open it in maps, and the
 * police number. First name only; never a phone number. The link dies 30 minutes after the alert
 * is closed.
 */
export default function SosContactPage() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { token = '' } = useLocalSearchParams<{ token: string }>();
  const net = useNetwork();
  const q = useQuery({
    ...api.safety.shared.queryOptions({ token }),
    enabled: Boolean(token),
    retry: shouldRetryQuery,
    // While the alert is open, and while a network or server failure lasts: a blip never ends the page.
    refetchInterval: (s) => (s.state.data?.status === 'live' || (s.state.status === 'error' && publicPageFailure(s.state.error) === 'transient') ? POLL_MS : false),
  });
  const [slow, restartSlow] = useLoadTimeout(q.isPending);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const s = q.data;
  const shell = (children: ReactNode) => (
    <View testID="sos-page" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false, title: t('sos.page_title') }} />
      <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 560, alignSelf: 'center', paddingTop: insets.top + theme.space[6], paddingHorizontal: theme.space[5], paddingBottom: theme.space[10] + insets.bottom, gap: theme.space[6] }}>
        <Wordmark size="md" />
        {children}
      </ScrollView>
    </View>
  );

  const police = (
    <Button label={t('sos.call_police', { number: SAFETY_RULES.policeNumber })} icon="phone" variant="secondary" fullWidth onPress={() => void Linking.openURL(`tel:${SAFETY_RULES.policeNumber}`).catch(() => undefined)} />
  );
  // "Expired" only on the server's word (audit FLOW-06): a failed refresh keeps the last position.
  const failure = q.isError ? publicPageFailure(q.error) : null;
  if (s?.status === 'expired' || failure === 'invalid' || failure === 'final') {
    const invalid = failure === 'invalid';
    return shell(<EmptyState icon="clock" title={s?.status === 'expired' || invalid ? t('sos.page_expired') : apiErrorMessage(q.error, t('error.network'), locale)} body={s?.status === 'expired' || invalid ? t('sos.page_expired_body') : undefined} />);
  }
  if (!s && (failure === 'transient' || slow)) {
    return shell(
      <>
        <RetryState
          kind={retryKindFor({ net, error: q.isError ? q.error : undefined, slow: !q.isError })}
          locale={locale}
          testID="sos-page-retry"
          onRetry={() => {
            restartSlow();
            void q.refetch();
          }}
        />
        {police}
      </>,
    );
  }
  if (!s) {
    return shell(
      <View style={{ gap: theme.space[3] }}>
        <Skeleton width={140} height={22} />
        <Skeleton width="80%" height={30} />
        <Skeleton lines={3} />
      </View>,
    );
  }

  const live = s.status === 'live';
  const ageSec = s.position ? s.position.ageSec + Math.max(0, Math.round((now - q.dataUpdatedAt) / 1000)) : null;
  const ago = ageSec === null ? '' : ageSec < 60 ? t('sos.page_seconds', { seconds: ageSec }) : t('sos.page_minutes', { minutes: Math.floor(ageSec / 60) });
  const mapsUrl = s.position ? `https://www.google.com/maps/search/?api=1&query=${s.position.lat.toFixed(6)},${s.position.lng.toFixed(6)}` : null;

  return shell(
    <>
      <View style={{ gap: theme.space[2] }}>
        {failure === 'transient' ? <StaleNote updatedAt={q.dataUpdatedAt} force locale={locale} testID="sos-page-stale" /> : null}
        <StatusPill size="sm" tone={live ? 'danger' : 'neutral'} live={live} label={t('sos.page_title')} style={{ alignSelf: 'flex-start' }} />
        <Text variant="heading" testID="sos-page-heading">
          {s.firstName ? t('sos.page_heading', { name: s.firstName }) : t('sos.page_heading_anon')}
        </Text>
        <Text variant="body" color="textMuted">
          {live ? t('sos.page_live') : t('sos.page_closed')}
        </Text>
      </View>

      <View style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
        {s.position && mapsUrl ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: live ? theme.colors.dangerTint : theme.colors.surfaceSunken }}>
                <Icon name="location-arrow" size={22} color={live ? 'dangerText' : 'textMuted'} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" tabular testID="sos-page-coords">
                  {ltr(`${s.position.lat.toFixed(5)}, ${s.position.lng.toFixed(5)}`)}
                </Text>
                <Text variant="caption" color="textMuted" tabular>
                  {[t('sos.page_updated', { ago }), s.position.accuracyM !== null ? t('sos.page_accuracy', { meters: Math.round(s.position.accuracyM) }) : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
            <Button label={t('sos.page_open_map')} icon="map-pin" variant="primary" size="lg" fullWidth onPress={() => void Linking.openURL(mapsUrl).catch(() => undefined)} testID="sos-page-map" />
          </>
        ) : (
          <Text variant="label" color="textMuted">
            {t('sos.page_no_position')}
          </Text>
        )}
      </View>

      {police}
    </>,
  );
}
