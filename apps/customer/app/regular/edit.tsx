import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import type { SavedPlaceView } from '@driver/contracts';
import { formatClock, formatHourPart } from '@driver/i18n';
import { Button, Chip, ChipGroup, Icon, SegmentedControl, Skeleton, Text, Toggle, useTheme, useToast } from '@driver/ui';
import { GuestGate } from '@/components/GuestGate';
import { Screen } from '@/components/Screen';
import { useMyPlaces } from '@/features/account/queries';
import { garageName, useNetwork as useRajaaNetwork } from '@/features/rajaa/queries';
import { cityName } from '@/features/rajaa/labels';
import { draftProblem, regularDraft, toInput, useRegularDraft, type RegularDraft } from '@/features/ride-habits/draft';
import { favouritesFor, morningAllowed, timeAt, toggleDay, WEEK_ORDER, WORK_WEEK } from '@/features/ride-habits/logic';
import { useFavourites, useRemoveRegularTrip, useSaveRegularTrip } from '@/features/ride-habits/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';

const HOURS = Array.from({ length: 24 }, (_, i) => (i + 5) % 24);
const MINUTES = [0, 15, 30, 45] as const;

/**
 * A regular trip (joy r5): a ride between two saved places, or a الرجعة on a corridor; its days and
 * time; when to ask (the evening before at 8:00, or that morning at 8:00 for trips from 9:00); cash
 * or wallet; and, if he has one, the favourite driver to ask for first. Saved here; booked only on
 * «أكدها», each time, at the server's price for that time.
 */
export default function RegularEditPage() {
  return useSignedIn() ? <RegularEdit /> : <GuestGate kind="account" />;
}

function RegularEdit() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const params = useLocalSearchParams<{ id?: string }>();
  const d = useRegularDraft();
  const editing = Boolean(params.id && d.id === params.id);
  const places = useMyPlaces();
  const favs = useFavourites();
  const save = useSaveRegularTrip();
  const remove = useRemoveRegularTrip();
  const [problem, setProblem] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);
  const up = (patch: Partial<RegularDraft>) => {
    setProblem(null);
    regularDraft.update(patch);
  };
  const kindFavs = favouritesFor(favs.data ?? [], d.kind === 'ride' ? d.ride.rideVertical : 'intercity');
  const missing = draftProblem(d);

  const submit = () => {
    const input = toInput(d);
    if (!input) {
      setProblem(t(missing === 'same_places' ? 'habits.same_places' : missing === 'need_to' ? 'habits.need_to' : 'habits.need_from'));
      return;
    }
    save.mutate(input, {
      onSuccess: (saved) => {
        toast.show({ message: t('habits.saved'), tone: 'success', icon: 'check' });
        regularDraft.edit(saved);
        if (router.canGoBack()) router.back();
        else router.replace('/regular');
      },
      onError: (e) => setProblem(apiErrorMessage(e, t('error.network'), locale)),
    });
  };
  const drop = () => {
    if (!d.id) return;
    remove.mutate(
      { id: d.id },
      {
        onSuccess: () => {
          toast.show({ message: t('habits.deleted'), tone: 'neutral' });
          router.replace('/regular');
        },
        onError: (e) => setProblem(apiErrorMessage(e, t('error.network'), locale)),
      },
    );
  };

  return (
    <Screen edges={['bottom']} testID="regular-edit" contentStyle={{ gap: theme.space[5] }}>
      <Stack.Screen options={{ title: editing ? t('habits.edit_title') : t('habits.edit_title_new') }} />
        {!editing ? (
          <SegmentedControl
            accessibilityLabel={t('habits.kind')}
            value={d.kind}
            onChange={(kind) => up({ kind, favouriteId: null })}
            options={[
              { value: 'ride', label: t('habits.kind_ride') },
              { value: 'rajaa', label: t('habits.kind_rajaa') },
            ]}
          />
        ) : null}

        {d.kind === 'ride' ? <RidePart d={d} places={places.data} loading={places.isPending} up={up} /> : <RajaaPart d={d} up={up} />}

        <Section title={t('habits.days')}>
          <ChipGroup
            accessibilityLabel={t('habits.days')}
            mode="multi"
            required
            value={d.days.map(String)}
            onChange={(next) => {
              const changed = WEEK_ORDER.find((x) => next.includes(String(x)) !== d.days.includes(x));
              if (changed !== undefined) up({ days: toggleDay(d.days, changed) });
            }}
            items={WEEK_ORDER.map((x) => ({ id: String(x), label: t(`time.dow_${x}`) }))}
          />
          <Button variant="ghost" size="md" label={t('habits.days_work_preset')} onPress={() => up({ days: [...WORK_WEEK] })} testID="regular-days-work" />
        </Section>

        <Section title={t('habits.time')}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2] }}>
            {HOURS.map((h) => (
              <Chip key={h} role="radio" label={formatHourPart(timeAt(h * 60, now))} selected={Math.floor(d.timeMin / 60) === h} onPress={() => up({ timeMin: h * 60 + (d.timeMin % 60) })} testID={`regular-hour-${h}`} />
            ))}
          </ScrollView>
          <SegmentedControl
            accessibilityLabel={t('habits.minute')}
            value={String(d.timeMin % 60) as '0' | '15' | '30' | '45'}
            onChange={(m) => up({ timeMin: Math.floor(d.timeMin / 60) * 60 + Number(m) })}
            options={MINUTES.map((m) => ({ value: String(m) as '0' | '15' | '30' | '45', label: formatClock(timeAt(Math.floor(d.timeMin / 60) * 60 + m, now), { period: false }) }))}
          />
          <Text variant="footnote" color="textMuted" tabular testID="regular-time-chosen">
            {t('habits.time_chosen', { time: formatClock(timeAt(d.timeMin, now)) })}
          </Text>
        </Section>

        <Section title={t('habits.remind')}>
          <SegmentedControl
            accessibilityLabel={t('habits.remind')}
            value={d.remind === 'morning' && morningAllowed(d.timeMin) ? 'morning' : 'evening'}
            onChange={(remind) => (remind === 'morning' && !morningAllowed(d.timeMin) ? setProblem(t('habits.remind_morning_off')) : up({ remind }))}
            options={[
              { value: 'evening', label: t('habits.remind_evening') },
              { value: 'morning', label: t('habits.remind_morning') },
            ]}
          />
          <Text variant="footnote" color="textMuted">
            {morningAllowed(d.timeMin) ? t('habits.remind_hint') : t('habits.remind_morning_off')}
          </Text>
        </Section>

        <Section title={t('checkout.payment')}>
          <SegmentedControl
            accessibilityLabel={t('checkout.payment')}
            value={d.paymentMethod}
            onChange={(paymentMethod) => up({ paymentMethod })}
            options={[
              { value: 'cash', label: t('ride.pay_cash') },
              { value: 'wallet', label: t('ride.pay_wallet') },
            ]}
          />
        </Section>

        {kindFavs.length > 0 ? (
          <Section title={t('habits.favourite')}>
            <ChipGroup
              accessibilityLabel={t('habits.favourite')}
              mode="single"
              required
              value={[d.favouriteId ?? 'any']}
              onChange={(next) => up({ favouriteId: next[0] === 'any' || !next[0] ? null : next[0] })}
              items={[{ id: 'any', label: t('habits.favourite_any') }, ...kindFavs.map((f) => ({ id: f.id, label: f.firstName ?? t('habits.fav_unnamed'), icon: 'heart' as const }))]}
            />
            <Text variant="footnote" color="textMuted">
              {t('habits.favourite_hint')}
            </Text>
          </Section>
        ) : null}

        {editing ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 44 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">{t('habits.active')}</Text>
              <Text variant="footnote" color="textMuted">
                {t('habits.active_hint')}
              </Text>
            </View>
            <Toggle testID="regular-active" value={d.active} onValueChange={(active) => up({ active })} accessibilityLabel={t('habits.active')} />
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
          <Icon name="shield" size={16} color="textMuted" />
          <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
            {t('habits.rule')}
          </Text>
        </View>

        {problem ? (
          <Text variant="footnote" color="dangerText" testID="regular-problem" accessibilityLiveRegion="polite">
            {problem}
          </Text>
        ) : null}
        <Button testID="regular-save" size="lg" label={t('habits.save')} loading={save.isPending} fullWidth onPress={submit} />
        {editing ? <Button testID="regular-delete" variant="ghost" label={t('habits.delete')} loading={remove.isPending} onPress={drop} /> : null}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" weight={600} color="textMuted">
        {title}
      </Text>
      {children}
    </View>
  );
}

function placePoint(p: SavedPlaceView) {
  return { zoneKey: p.zoneId, pin: p.pin, placeId: p.id, label: p.name };
}

function RidePart({ d, places, loading, up }: { d: RegularDraft; places: SavedPlaceView[] | undefined; loading: boolean; up: (p: Partial<RegularDraft>) => void }) {
  const theme = useTheme();
  const t = useT();
  const list = places ?? [];
  // A prefilled point that is not one of his saved places (from a booked ride) is offered too.
  const extra = [d.ride.pickup, d.ride.dropoff].filter((p): p is NonNullable<typeof p> => Boolean(p && !list.some((x) => x.id === p.placeId)));
  const items = [...list.map((p) => ({ id: p.id, label: p.name, icon: p.label === 'home' ? ('home' as const) : p.label === 'work' ? ('briefcase' as const) : ('map-pin' as const) })), ...extra.map((p) => ({ id: `pt:${p.label}`, label: p.label, icon: 'map-pin' as const }))];
  const pointOf = (id: string) => {
    const saved = list.find((p) => p.id === id);
    if (saved) return placePoint(saved);
    return extra.find((p) => `pt:${p.label}` === id) ?? null;
  };
  const idOf = (p: RegularDraft['ride']['pickup']) => (p ? (p.placeId && list.some((x) => x.id === p.placeId) ? p.placeId : `pt:${p.label}`) : null);
  const ride = (patch: Partial<RegularDraft['ride']>) => up({ ride: { ...d.ride, ...patch } });

  return (
    <>
      <Section title={t('habits.vehicle')}>
        <SegmentedControl
          accessibilityLabel={t('habits.vehicle')}
          value={d.ride.rideVertical}
          onChange={(rideVertical) => up({ ride: { ...d.ride, rideVertical }, favouriteId: null })}
          options={[
            { value: 'taxi', label: t('ride.vehicle_taxi') },
            { value: 'tuktuk', label: t('ride.vehicle_tuktuk') },
          ]}
        />
      </Section>
      {loading ? (
        <Skeleton height={88} />
      ) : items.length < 2 ? (
        <View style={{ gap: theme.space[2] }} testID="regular-need-places">
          <Text variant="body">{t('habits.need_places')}</Text>
          <Button variant="secondary" icon="map-pin" label={t('habits.add_place')} onPress={() => router.push('/places/new')} />
        </View>
      ) : (
        <>
          <Section title={t('habits.from')}>
            <ChipGroup accessibilityLabel={t('habits.from')} mode="single" value={idOf(d.ride.pickup) ? [idOf(d.ride.pickup)!] : []} onChange={(next) => next[0] && ride({ pickup: pointOf(next[0]) })} items={items} />
          </Section>
          <Section title={t('habits.to')}>
            <ChipGroup accessibilityLabel={t('habits.to')} mode="single" value={idOf(d.ride.dropoff) ? [idOf(d.ride.dropoff)!] : []} onChange={(next) => next[0] && ride({ dropoff: pointOf(next[0]) })} items={items} />
          </Section>
        </>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 44 }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {t('habits.door')}
        </Text>
        <Toggle testID="regular-door" value={d.ride.doorPickup} onValueChange={(doorPickup) => ride({ doorPickup })} accessibilityLabel={t('habits.door')} />
      </View>
    </>
  );
}

function RajaaPart({ d, up }: { d: RegularDraft; up: (p: Partial<RegularDraft>) => void }) {
  const t = useT();
  const network = useRajaaNetwork();
  const corridors = network.data?.corridors ?? [];
  const corridor = corridors.find((c) => c.id === d.rajaa.corridorId);
  const leaveFrom = d.rajaa.direction === 'from_aziziyah' ? 'aziziyah' : (corridor?.cityId ?? 'kut');
  const garages = (network.data?.garages ?? []).filter((g) => g.cityId === leaveFrom);
  const rajaa = (patch: Partial<RegularDraft['rajaa']>) => {
    const next = { ...d.rajaa, ...patch };
    const from = next.direction === 'from_aziziyah' ? 'aziziyah' : (corridors.find((c) => c.id === next.corridorId)?.cityId ?? 'kut');
    const valid = (network.data?.garages ?? []).filter((g) => g.cityId === from);
    if (!valid.some((g) => g.id === next.garageId) && valid[0]) next.garageId = valid[0].id;
    up({ rajaa: next });
  };
  if (network.isPending) return <Skeleton height={160} />;
  return (
    <>
      <Section title={t('habits.corridor')}>
        <ChipGroup
          accessibilityLabel={t('habits.corridor')}
          mode="single"
          required
          value={[d.rajaa.corridorId]}
          onChange={(next) => next[0] && rajaa({ corridorId: next[0] })}
          items={corridors.map((c) => ({ id: c.id, label: cityName(t, c.cityId) }))}
        />
      </Section>
      <Section title={t('habits.direction')}>
        <SegmentedControl
          accessibilityLabel={t('habits.direction')}
          value={d.rajaa.direction}
          onChange={(direction) => rajaa({ direction })}
          options={[
            { value: 'from_aziziyah', label: t('habits.dir_from') },
            { value: 'to_aziziyah', label: t('habits.dir_to') },
          ]}
        />
      </Section>
      {garages.length > 1 ? (
        <Section title={t('habits.garage')}>
          <ChipGroup accessibilityLabel={t('habits.garage')} mode="single" required value={[d.rajaa.garageId]} onChange={(next) => next[0] && rajaa({ garageId: next[0] })} items={garages.map((g) => ({ id: g.id, label: garageName(network.data, g.id) }))} />
        </Section>
      ) : null}
    </>
  );
}

