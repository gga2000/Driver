import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { modelFitsLayout, modelsForLayout, type IntercityDirection, type IntercitySeatId, type VehicleModelKey } from '@driver/contracts';
import { Button, Card, Chip, Icon, IconButton, SeatMap, StatusPill, Text, TextField, useTheme, useToast, type SeatInfo } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHead } from '@/features/intercity/BoardParts';
import { cityName, dayAndPeriod, timeWithPeriod } from '@/features/intercity/labels';
import {
  ANNOUNCE_RULES,
  clampDepart,
  clockBare,
  clockLabel,
  CORRIDOR_SWITCH,
  destinationCity,
  fullCarEarnings,
  garagesFor,
  openSeats,
  originCity,
  suggestedDepart,
  VEHICLE_OPTIONS,
  type VehicleOption,
} from '@/features/intercity/logic';
import { useDemand, useDriverActions, useMyDepartures, useNetwork } from '@/features/intercity/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

const MIN = 60_000;

/**
 * أعلن طلعة — garage, time ("يطلع الساعة X أو من يكمل"), the hard latest departure, the car (seat
 * map preview), family-only, and the money up front: seat price, front-seat extra, what a full car
 * leaves him. Announcing claims waiting demand in that window into holds on his car (server).
 */
export default function Announce() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const params = useLocalSearchParams<{ corridor?: string; direction?: string; at?: string }>();
  const corridorId = CORRIDOR_SWITCH.some((c) => c.id === params.corridor) ? params.corridor! : 'aziziyah_baghdad';
  const direction: IntercityDirection = params.direction === 'to_aziziyah' ? 'to_aziziyah' : 'from_aziziyah';
  const corridorCityId = CORRIDOR_SWITCH.find((c) => c.id === corridorId)!.cityId;
  const fromCity = originCity(corridorCityId, direction);
  const toCity = destinationCity(corridorCityId, direction);

  const network = useNetwork();
  const demand = useDemand(corridorId, direction);
  const mine = useMyDepartures();
  const { announce } = useDriverActions();

  const garages = useMemo(() => garagesFor(network.data?.garages ?? [], fromCity), [network.data, fromCity]);
  const corridor = network.data?.corridors.find((c) => c.id === corridorId);

  const [garageId, setGarageId] = useState<string | null>(null);
  const [departAt, setDepartAt] = useState<Date | null>(params.at ? clampDepart(new Date(params.at), new Date()) : null);
  const [latestMin, setLatestMin] = useState<number>(ANNOUNCE_RULES.defaultLatestMin);
  const [vehicle, setVehicle] = useState<VehicleOption>(VEHICLE_OPTIONS[0]!);
  const [plate, setPlate] = useState('');
  const [modelKey, setModelKey] = useState<VehicleModelKey | null>(null);
  const [otherModel, setOtherModel] = useState('');
  const [modelError, setModelError] = useState<'pick' | 'name' | null>(null);
  const [familyOnly, setFamilyOnly] = useState(false);
  // His word for the car (x15): riders see «ما يدخن» / «جناط كبيرة» on his profile and rate him on it.
  const [noSmoking, setNoSmoking] = useState(false);
  const [bigBags, setBigBags] = useState(false);
  // b7: riders see «مكيّفة» on the board (cool in summer, warm in winter).
  const [ac, setAc] = useState(false);
  const [plateError, setPlateError] = useState(false);

  // Defaults: the first garage of the side; the busiest demand window; his last car and plate.
  useEffect(() => {
    if (!garageId && garages[0]) setGarageId(garages[0].id);
  }, [garages, garageId]);
  useEffect(() => {
    if (!departAt && demand.data) setDepartAt(suggestedDepart(demand.data, new Date()));
  }, [demand.data, departAt]);
  const [carSet, setCarSet] = useState(false);
  useEffect(() => {
    if (carSet || !mine.data) return;
    const last = [...mine.data].sort((a, b) => b.departAt.getTime() - a.departAt.getTime())[0];
    if (last) {
      setPlate(last.vehicle.plate);
      setVehicle(VEHICLE_OPTIONS.find((v) => v.available && v.layout === last.vehicle.layout) ?? VEHICLE_OPTIONS[0]!);
      setModelKey(last.vehicle.modelKey);
      if (last.vehicle.modelKey === 'other') setOtherModel(last.vehicle.model ?? '');
      setNoSmoking(last.vehicle.noSmoking);
      setBigBags(last.vehicle.bigBags);
      setAc(last.vehicle.ac);
    }
    setCarSet(true);
  }, [carSet, mine.data]);

  const now = new Date();
  const at = departAt ?? clampDepart(new Date(now.getTime() + 45 * MIN), now);
  const latest = new Date(at.getTime() + latestMin * MIN);
  const shift = (min: number) => setDepartAt(clampDepart(new Date(at.getTime() + min * MIN), new Date()));

  const windows = useMemo(
    () =>
      (demand.data ?? [])
        .filter((b) => openSeats(b) > 0 && b.windowEnd.getTime() > now.getTime())
        .sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime())
        .slice(0, 4),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demand.data],
  );
  const waitingAtTime = (demand.data ?? [])
    .filter((b) => b.windowStart.getTime() <= at.getTime() && at.getTime() < b.windowEnd.getTime() && (!b.garageId || b.garageId === garageId))
    .reduce((n, b) => n + openSeats(b), 0);

  const previewSeats: SeatInfo[] = useMemo(
    () => (vehicle.layout === 4 ? ['front', 'back_left', 'back_middle', 'back_right'] : vehicle.layout === 6 ? ['front', 'middle_left', 'middle_right', 'rear_left', 'rear_middle', 'rear_right'] : ['front', 'middle_left', 'middle_middle', 'middle_right', 'rear_left', 'rear_middle', 'rear_right']).map((id) => ({
      id: id as IntercitySeatId,
      state: 'free' as const,
      premium: id === 'front' ? corridor?.frontPremiumIqd ?? 2_000 : 0,
    })),
    [vehicle.layout, corridor?.frontPremiumIqd],
  );
  const money = corridor ? fullCarEarnings(vehicle.layout, corridor.seatPriceIqd, corridor.frontPremiumIqd) : null;

  // A model that can't carry the chosen seat layout is cleared, so the picker never lies.
  const fittingModel = modelKey && modelFitsLayout(modelKey, vehicle.layout) ? modelKey : null;

  const submit = async () => {
    if (!garageId) return;
    const noModel = !fittingModel ? 'pick' : fittingModel === 'other' && !otherModel.trim() ? 'name' : null;
    if (plate.trim().length < 2 || noModel) {
      setPlateError(plate.trim().length < 2);
      setModelError(noModel);
      theme.haptic('error');
      return;
    }
    try {
      const dep = await announce.mutateAsync({
        garageId,
        corridorId,
        departAt: at,
        latestDepartureAt: latest,
        vehicle: {
          kind: vehicle.kind,
          layout: vehicle.layout,
          plate: plate.trim(),
          modelKey: fittingModel!,
          ...(fittingModel === 'other' ? { model: otherModel.trim() } : {}),
          noSmoking,
          bigBags,
          ac,
        },
        familyOnly,
      });
      theme.haptic('success');
      toast.show({ message: t('partner.ic_announce_done'), tone: 'success' });
      router.replace(`/intercity/departure/${dep.id}`);
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  return (
    <Screen
      testID="intercity-announce"
      edges={['bottom']}
      footer={<Button testID="announce-submit" label={t('partner.ic_announce_submit', { time: clockLabel(at) })} size="lg" fullWidth loading={announce.isPending} disabled={!garageId} onPress={() => void submit()} />}
    >
      <Stack.Screen options={{ title: t('partner.ic_announce_title') }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name="car" size={20} color="accentText" />
        <Text variant="title">{t('rajaa.route', { from: cityName(t, fromCity), to: cityName(t, toCity) })}</Text>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHead title={t('partner.ic_announce_garage')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {garages.map((g) => (
            <Chip key={g.id} testID={`garage-${g.id}`} role="radio" label={g.nameAr} icon="garage" selected={g.id === garageId} onPress={() => setGarageId(g.id)} />
          ))}
        </View>
      </View>

      <Card testID="announce-time">
        <View style={{ gap: theme.space[3] }}>
          <Text variant="label" color="textMuted">
            {t('partner.ic_announce_time')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <IconButton icon="minus" variant="tonal" size={52} accessibilityLabel={t('partner.ic_announce_earlier')} onPress={() => shift(-ANNOUNCE_RULES.stepMin)} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text variant="display" tabular testID="announce-clock">
                {clockBare(at)}
              </Text>
              <Text variant="label" color="textMuted">
                {dayAndPeriod(t, at, now)}
              </Text>
            </View>
            <IconButton icon="plus" variant="tonal" size={52} accessibilityLabel={t('partner.ic_announce_later')} onPress={() => shift(ANNOUNCE_RULES.stepMin)} />
          </View>
          <Text variant="footnote" color="textMuted" align="center">
            {t('partner.ic_announce_time_hint')}
          </Text>
          {windows.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2], justifyContent: 'center' }}>
              {windows.map((w) => {
                const start = clampDepart(new Date(Math.max(w.windowStart.getTime(), now.getTime())), now);
                const selected = at.getTime() >= w.windowStart.getTime() && at.getTime() < w.windowEnd.getTime();
                return (
                  <Chip
                    key={`${w.garageId ?? 'any'}-${w.windowStart.toISOString()}`}
                    role="radio"
                    icon="user"
                    selected={selected}
                    label={`${clockLabel(start)} · ${openSeats(w)}`}
                    onPress={() => setDepartAt(start)}
                  />
                );
              })}
            </View>
          ) : null}
          {waitingAtTime > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], backgroundColor: theme.colors.successTint, borderRadius: theme.radius.md, padding: theme.space[3] }}>
              <Icon name="user" size={18} color="successText" />
              <Text variant="footnote" weight={600} color="successText" style={{ flex: 1 }} tabular>
                {t('partner.ic_announce_demand', { n: waitingAtTime })}
              </Text>
            </View>
          ) : null}
        </View>
      </Card>

      <View style={{ gap: theme.space[3] }}>
        <SectionHead title={t('partner.ic_announce_latest')} sub={t('partner.ic_announce_latest_hint', { time: timeWithPeriod(t, latest) })} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {ANNOUNCE_RULES.latestOptionsMin.map((m) => (
            <Chip key={m} role="radio" label={t('partner.ic_announce_latest_opt', { n: amountParam(m, { sign: true }) })} selected={m === latestMin} onPress={() => setLatestMin(m)} />
          ))}
        </View>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHead title={t('partner.ic_announce_vehicle')} />
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {VEHICLE_OPTIONS.map((v) => (
            <VehicleTile key={v.key} option={v} selected={v.key === vehicle.key} onPress={() => v.available && setVehicle(v)} />
          ))}
        </View>
        <Card elevation={0} tone="sunken" padding={4}>
          <SeatMap layout={vehicle.layout} seats={previewSeats} selection={[]} legend={false} compact />
        </Card>
        <SectionHead title={t('partner.ic_announce_model')} sub={t('partner.ic_announce_model_hint')} />
        <View testID="announce-model" accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {modelsForLayout(vehicle.layout).map((m) => (
            <Chip
              key={m}
              testID={`model-${m}`}
              role="radio"
              icon={m === 'other' ? 'plus' : 'car'}
              label={t(`vehicle.model_${m}`)}
              selected={m === fittingModel}
              onPress={() => {
                setModelKey(m);
                setModelError(null);
              }}
            />
          ))}
        </View>
        {modelError === 'pick' ? (
          <Text variant="footnote" color="dangerText" testID="announce-model-error">
            {t('partner.ic_announce_model_pick')}
          </Text>
        ) : null}
        {fittingModel === 'other' ? (
          <TextField
            testID="announce-model-other"
            label={t('partner.ic_announce_model_other')}
            placeholder={t('partner.ic_announce_model_other_ph')}
            value={otherModel}
            maxLength={60}
            onChangeText={(v) => {
              setOtherModel(v);
              setModelError(null);
            }}
            error={modelError === 'name' ? t('partner.ic_announce_model_needed') : undefined}
            leadingIcon="car"
          />
        ) : null}
        <TextField
          testID="announce-plate"
          label={t('partner.ic_announce_plate')}
          placeholder={t('partner.ic_announce_plate_ph')}
          value={plate}
          onChangeText={(v) => {
            setPlate(v);
            setPlateError(false);
          }}
          error={plateError ? t('partner.ic_announce_plate_needed') : undefined}
          leadingIcon="car"
        />
        <Toggle label={t('partner.ic_announce_ac')} hint={t('partner.ic_announce_ac_hint')} value={ac} onChange={setAc} testID="announce-ac" />
        <Toggle label={t('partner.ic_announce_no_smoking')} hint={t('partner.ic_announce_promise_hint')} value={noSmoking} onChange={setNoSmoking} testID="announce-no-smoking" />
        <Toggle label={t('partner.ic_announce_big_bags')} hint={t('partner.ic_announce_promise_hint')} value={bigBags} onChange={setBigBags} testID="announce-big-bags" />
        <Toggle label={t('partner.ic_announce_family')} hint={t('partner.ic_announce_family_hint')} value={familyOnly} onChange={setFamilyOnly} testID="announce-family" />
      </View>

      {corridor && money ? (
        <Card testID="announce-price">
          <View style={{ gap: theme.space[2] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Text variant="label" color="textMuted" style={{ flex: 1 }}>
                {t('partner.ic_announce_price_title')}
              </Text>
              {corridor.placeholderPrice ? <StatusPill label={t('rajaa.price_placeholder')} tone="neutral" size="sm" /> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
              <Text variant="amount" tabular>
                {`${amountParam(corridor.seatPriceIqd)} ${t('quote.currency')}`}
              </Text>
              <Text variant="label" weight={600} color="accentText" tabular>
                {t('partner.ic_announce_front', { amount: amountParam(corridor.frontPremiumIqd, { sign: true }) })}
              </Text>
            </View>
            <Text variant="footnote" weight={600} tabular>
              {t('partner.ic_announce_full_car', { gross: amountParam(money.grossIqd), net: amountParam(money.netIqd) })}
            </Text>
            <Text variant="caption" color="textMuted">
              {t('partner.ic_announce_take')}
            </Text>
          </View>
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start' }}>
        <Icon name="clock" size={16} color="textMuted" style={{ marginTop: 3 }} />
        <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
          {t('partner.ic_announce_lowfill')}
        </Text>
      </View>
    </Screen>
  );
}

function VehicleTile({ option, selected, onPress }: { option: VehicleOption; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  const disabled = !option.available;
  return (
    <Pressable
      testID={`vehicle-${option.key}`}
      accessibilityRole="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      onPress={onPress}
      style={{
        flex: 1,
        alignItems: 'center',
        gap: 2,
        paddingVertical: theme.space[3],
        borderRadius: theme.radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.accentTint : theme.colors.surface,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Text variant="title" weight={700} tabular color={selected ? 'accentText' : 'text'}>
        {String(option.seats)}
      </Text>
      <Text variant="caption" weight={600} numberOfLines={1}>
        {t(`partner.ic_vehicle_${option.key}`)}
      </Text>
      <Text variant="caption" color="textMuted" numberOfLines={1}>
        {disabled ? t('partner.ic_vehicle_soon') : t('partner.ic_vehicle_seats', { n: option.seats })}
      </Text>
    </Pressable>
  );
}

/** A labelled on/off row (no native Switch: one look on web and native). */
function Toggle({ label, hint, value, onChange, testID }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      aria-checked={value}
      onPress={() => {
        theme.haptic('selection');
        onChange(!value);
      }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[2] }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="label" weight={600}>
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" color="textMuted">
            {hint}
          </Text>
        ) : null}
      </View>
      <View style={{ width: 50, height: 30, borderRadius: 15, padding: 3, backgroundColor: value ? theme.colors.accent : theme.colors.borderStrong, alignItems: value ? 'flex-end' : 'flex-start', direction: 'ltr' }}>
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.surface }} />
      </View>
    </Pressable>
  );
}
