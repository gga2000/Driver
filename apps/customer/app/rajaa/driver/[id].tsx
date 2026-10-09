import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Image, View } from 'react-native';
import { RAJAA_REPUTATION_RULES, type RajaaDriverProfile, type RajaaPublicReview } from '@driver/contracts';
import { Avatar, Card, EmptyState, Icon, MeterBar, PlateChip, RetryState, retryKindFor, SketchScene, Skeleton, StatStrip, StatusPill, Text, useLoadTimeout, useNetwork, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { carArtFor } from '@/features/rajaa/car-art';
import { BADGE_ICON, badgeCopy, monthYear, percentLabel, recordFacts, tagLabel } from '@/features/rajaa/driver-record';
import { RodeBefore } from '@/features/rajaa/DriverRecord';
import { vehicleDesc } from '@/features/rajaa/labels';
import { useDriverProfile } from '@/features/rajaa/queries';
import { apiErrorCode } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';

/**
 * «ملفه» (ideas x12–x17, Ali 2026-10-07): who you are about to travel 100 km with. His photo and first
 * name, today's check-in, since when he drives with us and whether you rode with him; his rating,
 * trips and on-time share; his badges with how each was earned; a bar per quality riders tick; his car
 * as painted for the seat picker; and the newest lines riders wrote, without their names.
 */
export default function DriverProfileScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const { id } = useLocalSearchParams<{ id: string }>();
  const profile = useDriverProfile(id);
  const [slow, restartSlow] = useLoadTimeout(profile.isPending);
  const title = <Stack.Screen options={{ title: profile.data?.card.firstName ?? t('rajaa.profile_title') }} />;

  if (profile.isPending && !slow) {
    return (
      <Screen edges={['bottom']} testID="driver-profile-loading">
        {title}
        <Skeleton height={140} radius={24} />
        <Skeleton height={84} radius={16} />
        <Skeleton height={180} radius={20} />
      </Screen>
    );
  }
  if (!profile.data) {
    // Off the board and not his seat any more: say so plainly instead of a network error.
    if (apiErrorCode(profile.error) === 'departure_not_found') {
      return (
        <Screen edges={['bottom']} testID="driver-profile-gone">
          {title}
          <EmptyState icon="rajaa" title={t('rajaa.profile_gone')} action={{ label: t('rajaa.back_to_board'), onPress: () => router.replace('/rajaa') }} />
        </Screen>
      );
    }
    const kind = retryKindFor({ net, error: profile.error, slow });
    return (
      <Screen edges={['bottom']} testID="driver-profile-error">
        {title}
        <RetryState
          kind={kind}
          locale={locale}
          art={kind === 'offline' || kind === 'unreachable' ? <SketchScene name="offline" /> : undefined}
          {...(kind === 'server' ? { title: t('rajaa.profile_load_failed') } : {})}
          onRetry={() => {
            restartSlow();
            void profile.refetch();
          }}
        />
      </Screen>
    );
  }

  const p = profile.data;
  const s = p.card.stats;
  const name = p.card.firstName ?? t('rajaa.driver_unnamed');
  return (
    <Screen edges={['bottom']} testID="driver-profile">
      {title}
      <Header p={p} name={name} />
      <StatStrip testID="driver-profile-stats" items={recordFacts(t, s, 'driver-profile')} />

      {s.badges.length > 0 ? (
        <View style={{ gap: theme.space[3] }}>
          <SectionHeader title={t('rajaa.profile_badges')} />
          <Card padding={0} testID="driver-profile-badges">
            {s.badges.map((b, i) => {
              const copy = badgeCopy(t, b);
              return (
                <View
                  key={b}
                  testID={`driver-profile-badge-${b}`}
                  accessible
                  accessibilityLabel={`${copy.title}، ${copy.body}`}
                  style={{ flexDirection: 'row', gap: theme.space[3], padding: theme.space[4], borderTopWidth: i > 0 ? 1 : 0, borderTopColor: theme.colors.border }}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: b === 'top_driver' || b === 'family_trusted' ? theme.colors.accentTint : theme.colors.surfaceSunken }}>
                    <Icon name={BADGE_ICON[b]} size={22} color={b === 'top_driver' || b === 'family_trusted' ? 'accentText' : 'text'} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong">{copy.title}</Text>
                    <Text variant="footnote" color="textMuted">
                      {copy.body}
                    </Text>
                  </View>
                </View>
              );
            })}
          </Card>
        </View>
      ) : null}

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('rajaa.profile_qualities')} />
        <Card padding={4} testID="driver-profile-qualities">
          {p.qualities.length > 0 ? (
            <View style={{ gap: theme.space[4] }}>
              {p.qualities.map((q) => (
                <MeterBar key={q.tag} testID={`driver-profile-quality-${q.tag}`} label={tagLabel(t, q.tag)} share={q.share} valueLabel={percentLabel(q.share)} />
              ))}
              <Text variant="caption" color="textMuted">
                {t('rajaa.profile_qualities_note', { n: s.ratingCount })}
              </Text>
            </View>
          ) : (
            <Text variant="footnote" color="textMuted" testID="driver-profile-qualities-wait">
              {t('rajaa.profile_qualities_wait', { n: RAJAA_REPUTATION_RULES.minRatings })}
            </Text>
          )}
        </Card>
      </View>

      <CarSection p={p} />

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('rajaa.profile_reviews')} />
        {p.reviews.length > 0 ? (
          <>
            <Text variant="caption" color="textMuted">
              {p.reviewCount > p.reviews.length ? `${t('rajaa.profile_reviews_note')} · ${t('rajaa.profile_reviews_more', { shown: p.reviews.length, total: p.reviewCount })}` : t('rajaa.profile_reviews_note')}
            </Text>
            <View style={{ gap: theme.space[2] }} testID="driver-profile-reviews">
              {p.reviews.map((r, i) => (
                <Review key={i} r={r} testID={`driver-profile-review-${i}`} />
              ))}
            </View>
          </>
        ) : (
          <Card padding={4} testID="driver-profile-reviews-empty">
            <Text variant="footnote" color="textMuted">
              {t('rajaa.profile_reviews_empty')}
            </Text>
          </Card>
        )}
      </View>
    </Screen>
  );
}

function Header({ p, name }: { p: RajaaDriverProfile; name: string }) {
  const theme = useTheme();
  const t = useT();
  const verified = Boolean(p.card.verifiedTodayAt);
  return (
    <Card padding={5} elevation={1} testID="driver-profile-header">
      <View style={{ alignItems: 'center', gap: theme.space[2] }}>
        <Avatar name={name} uri={apiPhoto(p.card.photoUrl) ?? undefined} size={88} ring={verified} {...(p.card.firstName ? {} : { icon: 'user' as const, tone: 'accent' as const })} />
        <Text variant="heading" align="center" accessibilityRole="header">
          {name}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: theme.space[2] }}>
          {verified ? <StatusPill testID="driver-profile-verified" size="sm" tone="success" icon="shield" label={t('trip.verified_today')} /> : null}
          <RodeBefore n={p.card.stats.ridesWithYou} testID="driver-profile-rode" />
        </View>
        <Text variant="footnote" color="textMuted" align="center" testID="driver-profile-since">
          {p.firstTripAt ? t('rajaa.profile_since', { month: monthYear(t, p.firstTripAt) }) : t('rajaa.profile_first_trip')}
        </Text>
      </View>
    </Card>
  );
}

/** His car: the flat top-down saloon for a 4-seat car, the model and colour, and the plate as it looks. */
function CarSection({ p }: { p: RajaaDriverProfile }) {
  const theme = useTheme();
  const t = useT();
  const art = carArtFor(p.vehicle);
  return (
    <View style={{ gap: theme.space[3] }}>
      <SectionHeader title={t('rajaa.profile_car')} />
      <Card padding={4} testID="driver-profile-car">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
          {art ? (
            <View style={{ width: 72, height: 72 / art.aspect, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: art.background }}>
              <Image source={art.source} accessible={false} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
            </View>
          ) : (
            <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSunken }}>
              <Icon name="car" size={28} color="textMuted" />
            </View>
          )}
          <View style={{ flex: 1, gap: theme.space[2], minWidth: 0 }}>
            <Text variant="bodyStrong">{vehicleDesc(t, p.vehicle)}</Text>
            <PlateChip plate={p.vehicle.plate} accessibilityLabel={t('driver.plate')} testID="driver-profile-plate" />
          </View>
        </View>
      </Card>
    </View>
  );
}

function Review({ r, testID }: { r: RajaaPublicReview; testID: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Card padding={4} testID={testID}>
      <View style={{ gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[2] }}>
          <View accessible accessibilityLabel={t('rajaa.profile_stars_a11y', { n: r.stars })} style={{ flexDirection: 'row', gap: 2 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Icon key={n} name="star" size={14} color={n <= r.stars ? 'accent' : 'border'} {...(n <= r.stars ? { filled: true, fillColor: 'accent' as const } : {})} />
            ))}
          </View>
          <Text variant="caption" color="textMuted">
            {monthYear(t, r.month)}
          </Text>
        </View>
        <Text variant="body">{r.text}</Text>
      </View>
    </Card>
  );
}
