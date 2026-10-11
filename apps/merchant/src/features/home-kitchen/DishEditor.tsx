import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import {
  HOME_KITCHEN_RULES,
  type HomeKitchenDish,
  type ReserveRule,
  type SaveHomeDishInput,
} from '@driver/contracts';
import {
  Button,
  ChipGroup,
  EmptyState,
  SegmentedControl,
  Skeleton,
  Stepper,
  Text,
  TextField,
  useTheme,
} from '@driver/ui';
import { Page } from '@/components/Page';
import { Panel, PanelTitle } from '@/features/menu/parts';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { parsePrice } from '@/features/menu/logic';
import { useLayout } from '@/lib/layout';
import { useCounterToast } from '@/lib/toast';
import {
  AHEAD_CHOICES,
  ruleReady,
  ruleLine,
  SERVES,
  servesOf,
  TIME_CHOICES,
  WEEK_ORDER,
  type Serves,
} from './logic';
import { useHomeKitchen, useHomeKitchenActions } from './queries';

interface Form {
  nameAr: string;
  description: string;
  serves: Serves;
  portion: string;
  price: string;
  mode: 'ready' | 'reserve';
  rule: ReserveRule;
}

type DishInput = Omit<SaveHomeDishInput, 'merchantOrgId' | 'itemId'>;

const FIRST_RULE: ReserveRule = {
  aheadMin: 1440,
  days: [...WEEK_ORDER],
  times: ['13:00'],
  maxPerSlot: 6,
};

function formOf(d: HomeKitchenDish | null): Form {
  return {
    nameAr: d?.nameAr ?? '',
    description: d?.description ?? '',
    serves: servesOf(d?.servesMin ?? null, d?.servesMax ?? null),
    portion: d?.portion ?? '',
    price: d ? String(d.priceIqd) : '',
    mode: d?.sale.mode ?? 'ready',
    rule: d?.sale.mode === 'reserve' ? d.sale.rule : FIRST_RULE,
  };
}

/**
 * «أكلة جديدة» / one of her dishes (owner): name, her line, how many it feeds, what's on the plate, the
 * price, then how it sells — ready today, or by reservation on the days and times she cooks it. The
 * photo stays on the menu's dish screen.
 */
export function DishEditor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const { store, canSeeMoney: owner } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const view = useHomeKitchen(storeId);
  const { save } = useHomeKitchenActions(storeId);
  const dish = id ? (view.data?.dishes.find((d) => d.id === id) ?? null) : null;

  if (id && !dish) {
    return (
      <Page title={t('home_kitchen.dish_title')} back testID="home-dish" maxWidth={720}>
        {view.isError || view.data ? (
          <EmptyState
            icon="x"
            title={t('home_kitchen.load_failed')}
            action={{ label: t('merchant.menu.retry'), onPress: () => void view.refetch() }}
          />
        ) : (
          <Skeleton height={320} radius={theme.radius.xl} />
        )}
      </Page>
    );
  }
  const onSave = (input: DishInput) => {
    if (!storeId) return;
    save.mutate(
      { merchantOrgId: storeId, ...(dish ? { itemId: dish.id } : {}), ...input },
      {
        onSuccess: () => {
          theme.haptic('success');
          toast.show({ message: t('home_kitchen.saved'), tone: 'success' });
          router.back();
        },
        onError: (err) =>
          toast.show({
            message: apiErrorMessage(err, t('merchant.common.error'), locale),
            tone: 'danger',
          }),
      },
    );
  };
  return (
    <DishForm
      key={dish?.id ?? 'new'}
      dish={dish}
      owner={owner}
      busy={save.isPending}
      onSave={onSave}
    />
  );
}

function DishForm({
  dish,
  owner,
  busy,
  onSave,
}: {
  dish: HomeKitchenDish | null;
  owner: boolean;
  busy: boolean;
  onSave: (input: DishInput) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const [form, setForm] = useState<Form>(() => formOf(dish));
  const [tried, setTried] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setRule = (patch: Partial<ReserveRule>) =>
    setForm((f) => ({ ...f, rule: { ...f.rule, ...patch } }));
  const pom = theme.services.home;
  const { wide } = useLayout();

  const price = parsePrice(form.price);
  const nameOk = form.nameAr.trim().length > 0;
  const priceOk = price !== null && price > 0;
  const ruleOk = form.mode === 'ready' || ruleReady(form.rule);
  const submit = () => {
    setTried(true);
    if (!nameOk || !priceOk || !ruleOk || price === null) return;
    const [min, max] = SERVES[form.serves];
    onSave({
      nameAr: form.nameAr.trim(),
      description: form.description.trim() || null,
      servesMin: min,
      servesMax: max,
      portion: form.portion.trim() || null,
      priceIqd: price,
      sale:
        form.mode === 'ready'
          ? { mode: 'ready' }
          : { mode: 'reserve', rule: { ...form.rule, times: [...form.rule.times].sort() } },
    });
  };

  if (!owner) {
    return (
      <Page title={t('home_kitchen.dish_title')} back testID="home-dish" maxWidth={720}>
        <EmptyState icon="lock" title={t('home_kitchen.owner_only')} />
      </Page>
    );
  }

  return (
    <Page
      title={dish ? dish.nameAr : t('home_kitchen.new_title')}
      back
      testID="home-dish"
      maxWidth={wide ? 1160 : 720}
    >
      <View
        style={{
          flexDirection: wide ? 'row' : 'column',
          gap: theme.space[4],
          alignItems: wide ? 'flex-start' : 'stretch',
        }}
      >
        <Panel testID="home-dish-details" style={wide ? { flex: 1 } : undefined}>
          <TextField
            testID="home-dish-name"
            label={t('home_kitchen.name')}
            placeholder={t('home_kitchen.name_placeholder')}
            value={form.nameAr}
            onChangeText={(v) => set('nameAr', v)}
            maxLength={40}
            error={tried && !nameOk ? t('home_kitchen.name_missing') : undefined}
          />
          <TextField
            testID="home-dish-line"
            label={t('home_kitchen.line')}
            placeholder={t('home_kitchen.line_placeholder')}
            value={form.description}
            onChangeText={(v) => set('description', v)}
            maxLength={HOME_KITCHEN_RULES.descriptionMax}
            hint={t('home_kitchen.chars_left', {
              n: HOME_KITCHEN_RULES.descriptionMax - form.description.length,
            })}
          />
          <View style={{ gap: theme.space[2] }}>
            <Text variant="label">{t('home_kitchen.serves')}</Text>
            <ChipGroup
              mode="single"
              required
              items={(Object.keys(SERVES) as Serves[]).map((s) => ({
                id: s,
                label: t(`home_kitchen.serves_${s.replace('-', '_')}` as never),
              }))}
              value={[form.serves]}
              onChange={(next) => next[0] && set('serves', next[0] as Serves)}
              accessibilityLabel={t('home_kitchen.serves')}
            />
          </View>
          <TextField
            testID="home-dish-portion"
            label={t('home_kitchen.portion')}
            placeholder={t('home_kitchen.portion_placeholder')}
            value={form.portion}
            onChangeText={(v) => set('portion', v)}
            maxLength={HOME_KITCHEN_RULES.portionMax}
            hint={t('home_kitchen.portion_hint')}
          />
          <TextField
            testID="home-dish-price"
            label={t('home_kitchen.price')}
            placeholder="6,000"
            value={form.price}
            onChangeText={(v) => set('price', v)}
            keyboardType="number-pad"
            error={tried && !priceOk ? t('home_kitchen.price_missing') : undefined}
          />
        </Panel>

        <Panel testID="home-dish-sale" style={wide ? { flex: 1 } : undefined}>
          <PanelTitle title={t('home_kitchen.sells_title')} />
          <SegmentedControl
            options={[
              { value: 'ready', label: t('home_kitchen.mode_ready') },
              { value: 'reserve', label: t('home_kitchen.mode_reserve') },
            ]}
            value={form.mode}
            onChange={(v) => set('mode', v)}
            accessibilityLabel={t('home_kitchen.sells_title')}
            testIDPrefix="home-dish-mode"
          />
          <Text variant="footnote" color="textMuted">
            {form.mode === 'ready'
              ? t('home_kitchen.mode_ready_hint')
              : t('home_kitchen.mode_reserve_hint')}
          </Text>
          {form.mode === 'reserve' ? (
            <View style={{ gap: theme.space[4] }}>
              <View style={{ gap: theme.space[2] }}>
                <Text variant="label">{t('home_kitchen.ahead')}</Text>
                <ChipGroup
                  mode="single"
                  required
                  items={AHEAD_CHOICES.map((m) => ({
                    id: String(m),
                    label: t(`home_kitchen.ahead_${m}` as never),
                  }))}
                  value={[String(form.rule.aheadMin)]}
                  onChange={(next) => next[0] && setRule({ aheadMin: Number(next[0]) })}
                  accessibilityLabel={t('home_kitchen.ahead')}
                />
              </View>
              <View style={{ gap: theme.space[2] }}>
                <Text variant="label">{t('home_kitchen.days')}</Text>
                <ChipGroup
                  mode="multi"
                  items={WEEK_ORDER.map((d) => ({
                    id: String(d),
                    label: t(`merchant.hours.dow_short_${d}` as never),
                  }))}
                  value={form.rule.days.map(String)}
                  onChange={(next) => setRule({ days: next.map(Number) })}
                  accessibilityLabel={t('home_kitchen.days')}
                />
                {tried && form.rule.days.length === 0 ? (
                  <Text variant="footnote" color="danger">
                    {t('home_kitchen.days_missing')}
                  </Text>
                ) : null}
              </View>
              <View style={{ gap: theme.space[2] }}>
                <Text variant="label">{t('home_kitchen.times')}</Text>
                <Text variant="caption" color="textMuted">
                  {t('home_kitchen.times_hint', { n: HOME_KITCHEN_RULES.maxTimes })}
                </Text>
                <ChipGroup
                  mode="multi"
                  items={TIME_CHOICES.map((c) => ({
                    id: c,
                    label: t(`home_kitchen.time_${c.slice(0, 2)}` as never),
                  }))}
                  value={form.rule.times}
                  onChange={(next) =>
                    setRule({ times: next.slice(0, HOME_KITCHEN_RULES.maxTimes) })
                  }
                  accessibilityLabel={t('home_kitchen.times')}
                />
                {tried && form.rule.times.length === 0 ? (
                  <Text variant="footnote" color="danger">
                    {t('home_kitchen.times_missing')}
                  </Text>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label">{t('home_kitchen.per_slot')}</Text>
                  <Text variant="caption" color="textMuted">
                    {t('home_kitchen.per_slot_hint')}
                  </Text>
                </View>
                <Stepper
                  value={form.rule.maxPerSlot}
                  min={1}
                  max={HOME_KITCHEN_RULES.maxPerSlot}
                  onChange={(n) => setRule({ maxPerSlot: n })}
                  accessibilityLabel={t('home_kitchen.per_slot')}
                />
              </View>
              {ruleReady(form.rule) ? (
                <View
                  style={{
                    gap: 4,
                    padding: theme.space[3],
                    borderRadius: theme.radius.lg,
                    backgroundColor: pom.card.bg,
                  }}
                  testID="home-dish-preview"
                >
                  <Text
                    variant="caption"
                    weight={700}
                    color={theme.scheme === 'dark' ? pom.card.dot : pom.fill}
                  >
                    {t('home_kitchen.customer_sees')}
                  </Text>
                  <Text variant="body">{ruleLine(form.rule, t)}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </Panel>
      </View>

      {dish ? (
        <Button
          variant="ghost"
          icon="camera"
          label={t('home_kitchen.photo')}
          onPress={() =>
            router.push({ pathname: '/menu/item', params: { id: dish.id, photo: '1' } })
          }
          testID="home-dish-photo"
        />
      ) : null}
      <Button
        fullWidth
        size="lg"
        label={t('home_kitchen.save')}
        loading={busy}
        onPress={submit}
        testID="home-dish-save"
      />
    </Page>
  );
}
