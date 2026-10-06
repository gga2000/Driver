import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { AdminMenuItem } from '@driver/contracts';
import { Button, EmptyState, SearchField, Skeleton, Stepper, Text, TextField, useTheme, useToast, withAlpha } from '@driver/ui';
import { Page } from '@/components/Page';
import { Glyph, type GlyphName } from '@/features/menu/Glyph';
import { filterMenu } from '@/features/menu/logic';
import { ChoiceTile, Panel, PanelTitle, Thumb } from '@/features/menu/parts';
import { useMenu } from '@/features/menu/queries';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT, type TKey } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { amountParam, iqd } from '@/lib/money';
import { DealBadge } from './DealCard';
import { dayName, daysText, dealHeadline, hoursText, itemsText, rangeText } from './format';
import {
  AMOUNT_CHOICES,
  DURATION_CHOICES,
  MAX_PERCENT,
  MIN_ORDER_CHOICES,
  PERCENT_CHOICES,
  START_CHOICES,
  STEPS,
  apiType,
  draftProblems,
  draftToInput,
  draftWindow,
  emptyDraft,
  needsItems,
  toggleDay,
  type DealDraft,
  type DealKind,
  type HoursPreset,
  type WizardStep,
} from './logic';
import { useDealActions, useDealProjection } from './queries';
import { color } from '@driver/design-tokens';

const KINDS: ReadonlyArray<{ kind: DealKind; title: TKey; body: TKey }> = [
  { kind: 'percent', title: 'merchant.deals.kind_percent', body: 'merchant.deals.kind_percent_body' },
  { kind: 'free_delivery', title: 'merchant.deals.kind_free_delivery', body: 'merchant.deals.kind_free_delivery_body' },
  { kind: 'bogo', title: 'merchant.deals.kind_bogo', body: 'merchant.deals.kind_bogo_body' },
  { kind: 'item_discount', title: 'merchant.deals.kind_item_discount', body: 'merchant.deals.kind_item_discount_body' },
];
const HOURS_CHOICES: ReadonlyArray<{ id: HoursPreset; label: TKey }> = [
  { id: 'all', label: 'merchant.deals.hours_all' },
  { id: 'lunch', label: 'merchant.deals.hours_lunch' },
  { id: 'dinner', label: 'merchant.deals.hours_dinner' },
  { id: 'late', label: 'merchant.deals.hours_late' },
];
const BUDGET_CHOICES = [null, 50_000, 100_000, 250_000] as const;
const STEP_TITLE: Record<WizardStep, TKey> = { kind: 'merchant.deals.step_kind', offer: 'merchant.deals.step_offer', when: 'merchant.deals.step_when', review: 'merchant.deals.step_review' };
/** Week starts Saturday on an Iraqi wall calendar. */
const WEEK = [6, 0, 1, 2, 3, 4, 5] as const;

/**
 * عرض جديد. Tablet: the whole form on the start side, and a live summary with the server's projected
 * cost and the submit button beside it. Phone: four steps (kind → offer → when → review), the cost
 * shown in full on the last one before the owner sends it.
 */
export function ProposeDeal() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { wide } = useLayout();
  const { store, canSeeMoney: owner } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const menu = useMenu(storeId);
  const actions = useDealActions();
  const [draft, setDraft] = useState<DealDraft>(emptyDraft);
  const [step, setStep] = useState<WizardStep>('kind');
  const [now] = useState(() => Date.now());

  const items = useMemo(() => (menu.data?.categories ?? []).flatMap((c) => c.items), [menu.data]);
  const names = useMemo(() => new Map(items.map((i) => [i.id, i.nameAr] as const)), [items]);
  const set = (patch: Partial<DealDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const fallbackName = draft.kind ? dealHeadline(t, apiType(draft.kind), draft.kind === 'percent' ? draft.percent : draft.amountIqd) : '';
  const input = storeId ? draftToInput(draft, storeId, now, fallbackName) : null;
  const projection = useDealProjection(input, owner);

  const submit = () => {
    if (!input) return;
    actions.propose.mutate(input, {
      onSuccess: (deal) => {
        toast.show({ message: deal.state === 'pending_approval' ? t('merchant.deals.sent') : t('merchant.deals.live_now'), tone: 'success' });
        if (router.canGoBack()) router.back();
        else router.replace('/deals');
      },
      onError: (err) => toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' }),
    });
  };

  if (!owner) {
    return (
      <Page title={t('merchant.deals.new_title')} back testID="deal-new-screen">
        <EmptyState icon="shield" title={t('merchant.deals.owner_only')} body={t('merchant.deals.staff_note')} />
      </Page>
    );
  }

  const requiresApproval = projection.data?.requiresApproval ?? true;
  const submitLabel = requiresApproval ? t('merchant.deals.submit_approval') : t('merchant.deals.submit_live');

  // ── form pieces ──
  const kindPicker = (
    <View style={{ flexDirection: wide ? 'row' : 'column', flexWrap: 'wrap', gap: theme.space[3] }}>
      {KINDS.map((k) => (
        <ChoiceTile
          key={k.kind}
          testID={`kind-${k.kind}`}
          selected={draft.kind === k.kind}
          onPress={() => set({ kind: k.kind, itemIds: k.kind === 'free_delivery' ? [] : draft.itemIds })}
          style={wide ? { flexBasis: '47%', flexGrow: 1 } : undefined}
        >
          <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
            <DealBadge type={apiType(k.kind)} value={k.kind === 'percent' ? draft.percent : draft.amountIqd} size={52} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong" style={{ fontSize: 16 }}>
                {t(k.title)}
              </Text>
              <Text variant="footnote" color="textMuted">
                {t(k.body)}
              </Text>
            </View>
          </View>
        </ChoiceTile>
      ))}
    </View>
  );

  const offerForm = draft.kind ? (
    <View style={{ gap: theme.space[5] }}>
      {draft.kind === 'percent' ? (
        <Field label={t('merchant.deals.percent_label')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2], alignItems: 'center' }}>
            {PERCENT_CHOICES.map((p) => (
              <Choice key={p} testID={`percent-${p}`} label={`${p}%`} selected={draft.percent === p} onPress={() => set({ percent: p })} />
            ))}
            <Stepper value={draft.percent} min={1} max={MAX_PERCENT} onChange={(n) => set({ percent: n })} accessibilityLabel={t('merchant.deals.percent_label')} />
          </View>
        </Field>
      ) : null}
      {draft.kind === 'item_discount' ? (
        <Field label={t('merchant.deals.amount_label')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {AMOUNT_CHOICES.map((a) => (
              <Choice key={a} testID={`amount-${a}`} label={iqd(a, { locale })} selected={draft.amountIqd === a} onPress={() => set({ amountIqd: a })} />
            ))}
          </View>
        </Field>
      ) : null}
      {draft.kind === 'free_delivery' ? (
        <View style={{ flexDirection: 'row', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
          <Glyph name="bike" size={22} color="accentText" />
          <Text variant="body" style={{ flex: 1 }}>
            {t('merchant.deals.free_delivery_note')}
          </Text>
        </View>
      ) : null}
      {draft.kind !== 'free_delivery' ? (
        <ItemPicker
          items={menu.data?.categories ?? []}
          loading={menu.isLoading}
          selected={draft.itemIds}
          required={needsItems(draft.kind)}
          onChange={(itemIds) => set({ itemIds })}
          hint={draft.kind === 'bogo' ? t('merchant.deals.bogo_hint') : draft.kind === 'percent' ? t('merchant.deals.percent_items_hint') : t('merchant.deals.items_hint')}
        />
      ) : null}
      <TextField testID="deal-name" label={t('merchant.deals.name_label')} placeholder={fallbackName} value={draft.nameAr} onChangeText={(v) => set({ nameAr: v })} maxLength={60} hint={t('merchant.deals.name_hint')} />
    </View>
  ) : null;

  const whenForm = (
    <View style={{ gap: theme.space[5] }}>
      <Field label={t('merchant.deals.start_label')}>
        <Row>
          {START_CHOICES.map((d) => (
            <Choice key={d} testID={`start-${d}`} label={d === 0 ? t('merchant.deals.start_today') : d === 1 ? t('merchant.deals.start_tomorrow') : d === 2 ? t('merchant.deals.start_after') : t('merchant.deals.start_next_week')} selected={draft.startInDays === d} onPress={() => set({ startInDays: d })} />
          ))}
        </Row>
      </Field>
      <Field label={t('merchant.deals.duration_label')}>
        <Row>
          {DURATION_CHOICES.map((d) => (
            <Choice key={d} testID={`duration-${d}`} label={d === 7 ? t('merchant.deals.week') : d === 14 ? t('merchant.deals.two_weeks') : d === 30 ? t('merchant.deals.month') : t('merchant.deals.days_n', { n: d })} selected={draft.durationDays === d} onPress={() => set({ durationDays: d })} />
          ))}
        </Row>
        <Text variant="caption" color="textMuted" tabular>
          {(() => {
            const w = draftWindow(draft, now);
            return rangeText(t, w.startsAt, w.endsAt);
          })()}
        </Text>
      </Field>
      <Field label={t('merchant.deals.days_label')}>
        <Row>
          <Choice testID="days-all" label={t('merchant.deals.every_day')} selected={draft.days.length === 0} onPress={() => set({ days: [] })} />
          {WEEK.map((d) => (
            <Choice key={d} testID={`day-${d}`} label={dayName(t, d)} selected={draft.days.includes(d)} onPress={() => {
              const next = toggleDay(draft.days, d);
              set({ days: next.length === 7 ? [] : next });
            }} />
          ))}
        </Row>
      </Field>
      <Field label={t('merchant.deals.hours_label')}>
        <Row>
          {HOURS_CHOICES.map((h) => (
            <Choice key={h.id} testID={`hours-${h.id}`} label={t(h.label)} selected={draft.hours === h.id} onPress={() => set({ hours: h.id })} />
          ))}
        </Row>
      </Field>
      <Field label={t('merchant.deals.min_label')}>
        <Row>
          {MIN_ORDER_CHOICES.map((m) => (
            <Choice key={m} testID={`min-${m}`} label={m === 0 ? t('merchant.deals.min_none') : iqd(m, { locale })} selected={draft.minOrderIqd === m} onPress={() => set({ minOrderIqd: m })} />
          ))}
        </Row>
      </Field>
      <Field label={t('merchant.deals.budget_label')} hint={t('merchant.deals.budget_hint')}>
        <Row>
          {BUDGET_CHOICES.map((b) => (
            <Choice key={b ?? 'none'} testID={`budget-${b ?? 'none'}`} label={b === null ? t('merchant.deals.budget_none') : iqd(b, { locale })} selected={draft.budgetCapIqd === b} onPress={() => set({ budgetCapIqd: b })} />
          ))}
        </Row>
      </Field>
    </View>
  );

  const summary = draft.kind ? (
    <View style={{ gap: theme.space[2] }}>
      <SummaryLine glyph="tag" text={input?.nameAr ?? fallbackName} strong />
      <SummaryLine glyph="utensils" text={draft.kind === 'free_delivery' ? t('merchant.deals.whole_menu') : itemsText(t, draft.itemIds, names, 3)} />
      {(() => {
        const w = draftWindow(draft, now);
        return <SummaryLine glyph="calendar" text={`${rangeText(t, w.startsAt, w.endsAt)} · ${daysText(t, draft.days)}`} />;
      })()}
      <SummaryLine glyph="clock" text={hoursText(t, input?.schedule.hours)} />
      <SummaryLine glyph="bag" text={draft.minOrderIqd > 0 ? t('merchant.deals.min_order', { amount: amountParam(draft.minOrderIqd) }) : t('merchant.deals.min_none_long')} />
      {draft.budgetCapIqd ? <SummaryLine glyph="cash" text={t('merchant.deals.budget_line', { amount: amountParam(draft.budgetCapIqd) })} /> : null}
    </View>
  ) : (
    <Text variant="footnote" color="textMuted">
      {t('merchant.deals.pick_kind_first')}
    </Text>
  );

  const projectionCard = (
    <View testID="deal-projection" style={{ borderRadius: theme.radius.xl, backgroundColor: theme.colors.text, padding: theme.space[5], gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Glyph name="chart" size={18} color="accentTint" strokeWidth={2} />
        <Text variant="label" weight={600} color="accentTint" style={{ flex: 1 }}>
          {t('merchant.deals.projection_title')}
        </Text>
        {projection.isFetching && projection.data ? <Text variant="caption" color="accentTint">{t('merchant.deals.recalculating')}</Text> : null}
      </View>
      {!input ? (
        <Text variant="body" color="bg">
          {t('merchant.deals.projection_waiting')}
        </Text>
      ) : projection.isError && !projection.data ? (
        <Text variant="body" color="bg">
          {apiErrorMessage(projection.error, t('merchant.deals.projection_failed'), locale)}
        </Text>
      ) : !projection.data ? (
        <View style={{ gap: theme.space[2] }}>
          <Skeleton height={40} width="60%" />
          <Skeleton height={18} width="80%" />
        </View>
      ) : (
        <>
          <View style={{ gap: 0 }}>
            <Text weight={700} color="bg" tabular style={{ fontSize: 34, lineHeight: 46 }}>
              {iqd(projection.data.projected.weeklyCostIqd, { locale })}
            </Text>
            <Text variant="footnote" color="accentTint">
              {t('merchant.deals.projection_week')}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
            <Stat label={t('merchant.deals.stat_orders')} value={String(projection.data.projected.ordersPerWeek)} />
            <Stat label={t('merchant.deals.stat_per_order')} value={iqd(projection.data.projected.costPerOrderIqd, { locale })} />
            <Stat label={t('merchant.deals.stat_total')} value={iqd(projection.data.projected.totalCostIqd, { locale })} />
          </View>
          <Text variant="caption" color="accentTint">
            {projection.data.projected.basisOrders > 0 ? t('merchant.deals.projection_basis', { orders: projection.data.projected.basisOrders, days: projection.data.basisDays }) : t('merchant.deals.projection_no_basis')}
          </Text>
        </>
      )}
    </View>
  );

  const notes = (
    <View style={{ gap: theme.space[2] }}>
      <Note glyph="cash" text={t('merchant.deals.funding_note')} />
      <Note glyph="shield" text={requiresApproval ? t('merchant.deals.approval_note') : t('merchant.deals.no_approval_note')} />
    </View>
  );

  const submitButton = <Button testID="deal-submit" label={submitLabel} size="lg" fullWidth disabled={!input} loading={actions.propose.isPending} onPress={submit} />;

  // ── tablet: one page + live summary ──
  if (wide) {
    return (
      <Page title={t('merchant.deals.new_title')} subtitle={store?.name} back testID="deal-new-screen" scroll={false} maxWidth={1180}>
        <View style={{ flex: 1, flexDirection: 'row', gap: theme.space[6] }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: theme.space[5], paddingBottom: theme.space[10] }}>
            <Panel>
              <PanelTitle glyph="tag" title={t('merchant.deals.step_kind_n')} />
              {kindPicker}
            </Panel>
            {draft.kind ? (
              <Panel>
                <PanelTitle glyph="percent" title={t('merchant.deals.step_offer_n')} />
                {offerForm}
              </Panel>
            ) : null}
            {draft.kind ? (
              <Panel>
                <PanelTitle glyph="calendar" title={t('merchant.deals.step_when_n')} />
                {whenForm}
              </Panel>
            ) : null}
          </ScrollView>
          <ScrollView style={{ width: 380, flexGrow: 0 }} contentContainerStyle={{ gap: theme.space[4], paddingBottom: theme.space[10] }}>
            <Panel>
              <Text variant="title">{t('merchant.deals.summary')}</Text>
              {summary}
            </Panel>
            {projectionCard}
            {notes}
            {submitButton}
          </ScrollView>
        </View>
      </Page>
    );
  }

  // ── phone: steps ──
  const idx = STEPS.indexOf(step);
  const stepOk = draftProblems(draft, step).length === 0 && (step !== 'review' || !!input);
  return (
    <Page title={t('merchant.deals.new_title')} subtitle={t('merchant.deals.step_of', { n: idx + 1, total: STEPS.length, title: t(STEP_TITLE[step]) })} back testID="deal-new-screen" scroll={false}>
      <View style={{ flexDirection: 'row', gap: 6, paddingBottom: theme.space[3] }}>
        {STEPS.map((s, i) => (
          <View key={s} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i <= idx ? theme.colors.accent : theme.colors.border }} />
        ))}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: theme.space[5], paddingBottom: theme.space[6] }} keyboardShouldPersistTaps="handled">
        {step === 'kind' ? kindPicker : null}
        {step === 'offer' ? offerForm : null}
        {step === 'when' ? whenForm : null}
        {step === 'review' ? (
          <>
            {projectionCard}
            <Panel>
              <Text variant="title">{t('merchant.deals.summary')}</Text>
              {summary}
            </Panel>
            {notes}
          </>
        ) : null}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: theme.space[2], paddingVertical: theme.space[3], borderTopWidth: 1, borderTopColor: theme.colors.border }}>
        {idx > 0 ? <Button testID="wizard-back" label={t('merchant.deals.back')} variant="secondary" size="lg" onPress={() => setStep(STEPS[idx - 1]!)} style={{ flex: 1 }} /> : null}
        {step === 'review' ? (
          <View style={{ flex: 2 }}>{submitButton}</View>
        ) : (
          <Button testID="wizard-next" label={t('merchant.deals.next')} size="lg" disabled={!stepOk} onPress={() => setStep(STEPS[idx + 1]!)} style={{ flex: 2 }} fullWidth />
        )}
      </View>
    </Page>
  );
}

// ───────────────────────── small pieces ─────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <View style={{ gap: 2 }}>
        <Text variant="label" weight={600}>
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" color="textMuted">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Row({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>{children}</View>;
}

function Choice({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: theme.space[4],
        borderRadius: theme.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.accentTint : theme.colors.surface,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text variant="label" weight={selected ? 700 : 500} color={selected ? 'accentText' : 'text'} tabular>
        {label}
      </Text>
    </Pressable>
  );
}

function SummaryLine({ glyph, text, strong }: { glyph: GlyphName; text: string; strong?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      <Glyph name={glyph} size={18} color="textMuted" />
      <Text variant={strong ? 'bodyStrong' : 'footnote'} style={{ flex: 1 }} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, gap: 2, paddingTop: theme.space[2], borderTopWidth: 1, borderTopColor: withAlpha(color.neutral[50], 0.18) }}>
      <Text variant="caption" color="accentTint" numberOfLines={1}>
        {label}
      </Text>
      <Text variant="label" weight={700} color="bg" tabular numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Note({ glyph, text }: { glyph: GlyphName; text: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start' }}>
      <Glyph name={glyph} size={18} color="textMuted" />
      <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

/** Dishes the deal covers: search, grouped by section, tap to tick. */
function ItemPicker({
  items,
  loading,
  selected,
  required,
  onChange,
  hint,
}: {
  items: ReadonlyArray<{ nameAr: string | null; items: readonly AdminMenuItem[] }>;
  loading: boolean;
  selected: readonly string[];
  required: boolean;
  onChange: (ids: string[]) => void;
  hint: string;
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(required || selected.length > 0);
  const sections = filterMenu(items, query);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <Field label={required ? t('merchant.deals.items_label_required') : t('merchant.deals.items_label')} hint={hint}>
      {!required ? (
        <Row>
          <Choice testID="items-all" label={t('merchant.deals.whole_menu')} selected={!open} onPress={() => {
            setOpen(false);
            onChange([]);
          }} />
          <Choice testID="items-some" label={t('merchant.deals.some_items')} selected={open} onPress={() => setOpen(true)} />
        </Row>
      ) : null}
      {open ? (
        <View style={{ borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden', backgroundColor: theme.colors.surface }}>
          <View style={{ padding: theme.space[3], gap: theme.space[2], borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <SearchField value={query} onChangeText={setQuery} onClear={() => setQuery('')} placeholder={t('merchant.menu.search')} />
            <Text variant="caption" color={selected.length ? 'accentText' : 'textMuted'} weight={600}>
              {t('merchant.deals.items_selected', { count: selected.length })}
            </Text>
          </View>
          <ScrollView style={{ maxHeight: 340 }} nestedScrollEnabled>
            {loading ? <Skeleton height={120} /> : null}
            {sections.map((s) => (
              <View key={s.nameAr ?? '__none'}>
                <Text variant="caption" weight={700} color="textMuted" style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[3], paddingBottom: theme.space[1] }}>
                  {s.nameAr ?? t('merchant.menu.no_section')}
                </Text>
                {s.items.map((i) => {
                  const on = selected.includes(i.id);
                  return (
                    <Pressable
                      key={i.id}
                      testID={`pick-${i.id}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      onPress={() => toggle(i.id)}
                      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: theme.space[2], backgroundColor: on ? theme.colors.accentTint : pressed ? theme.colors.surfaceSunken : 'transparent' })}
                    >
                      <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: on ? theme.colors.accent : theme.colors.borderStrong, backgroundColor: on ? theme.colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                        {on ? <Glyph name="check" size={15} color="onAccent" strokeWidth={2.6} /> : null}
                      </View>
                      <Thumb url={i.photoUrl} name={i.nameAr} size={36} />
                      <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
                        {i.nameAr}
                      </Text>
                      <Text variant="label" color="textMuted" tabular>
                        {iqd(i.priceIqd, { locale })}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </Field>
  );
}
