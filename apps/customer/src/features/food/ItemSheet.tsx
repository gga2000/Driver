import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { dealLinePrice, type MenuItem, type MenuModifierGroup } from '@driver/contracts';
import { Button, Card, Chip, ChipGroup, Icon, ModalSheet, Rule, StatusPill, Stepper, Text, TextField, useTheme, useToast } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { formatPhoneInput, normalizeIraqiPhone } from '@/lib/phone';
import { useProfile } from '@/lib/profile';
import { useSignedIn } from '@/lib/session';
import { useDishFollows } from '@/features/home/habit-queries';
import { useHousehold } from '@/features/account/queries';
import { ME, TABLE, type CartMerchant } from './cart';
import { cartStore, useCartStore } from './cart-store';
import { FollowBell } from './FollowBell';
import { FoodArt, artOf } from './FoodArt';
import { HOUSEHOLD_PREFIX, defaultPersonFor, isFamilyOrder, personChips } from './family';
import { servesChosen, servesCopy } from './portions';
import { tasteStore, useTaste, withTaste } from '@/features/doors/taste';
import { chosenModifiers, defaultSelection, selectionProblems, sheetCta, sheetLinePrice, toggleModifier, type Selection } from './modifiers';

/** The dish picture on top of the sheet: 16:9 (joy o2). */
const HERO_RATIO = 16 / 9;

export interface ItemSheetProps {
  item: MenuItem;
  merchant: CartMerchant;
  /** Kitchen closed: the sheet shows the dish but can't add it. */
  disabled?: boolean;
  onClose: () => void;
  onAdded: (name: string) => void;
  /** Joy h2: this dish was the kitchen's «قدر اليوم» lately, so it can be followed («خبرني لمن يطبخوها»). */
  followable?: boolean;
}

/**
 * The dish sheet (spec §3) on the shared `ModalSheet` (focus kept inside, back/Escape close it): variants first, modifier chips with required/min/max and price
 * deltas, quantity, "لمن؟" (أنا / saved people / + new person with name and phone), a note for the
 * kitchen (per person when it's someone else's), and the live line price on the add button.
 */
export function ItemSheet({ item, merchant, disabled, onClose, onAdded, followable = false }: ItemSheetProps) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { name: myName } = useProfile();
  const { people, cart } = useCartStore();
  // o5 «سفرة العائلة»: the household from the account, and whether this is a family order.
  const household = useHousehold().data?.members;
  const family = isFamilyOrder({ household: household ?? [], cartPeople: cart.people.length, tableLines: cart.lines.filter((l) => l.personId === TABLE).length });
  const personTouched = useRef(false);
  // q2 «مثل آخر مرة»: sugar, cardamom and ice the way this person took them last time.
  const taste = useTaste();
  const [selection, setSelection] = useState<Selection>(() => withTaste(item, defaultSelection(item), tasteStore.getSnapshot()).selection);
  const [remembered, setRemembered] = useState<string[]>(() => withTaste(item, defaultSelection(item), tasteStore.getSnapshot()).filled);
  const [qty, setQty] = useState(1);
  const [personId, setPersonId] = useState<string>(ME);
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  // o4: where each choice group sits in the sheet's scroll, and which one to flash.
  const scrollRef = useRef<ScrollView>(null);
  const bodyY = useRef(0);
  const groupY = useRef<Record<string, number>>({});
  const [flash, setFlash] = useState<{ groupId: string; n: number } | null>(null);

  useEffect(() => {
    const start = withTaste(item, defaultSelection(item), taste);
    setSelection(start.selection);
    setRemembered(start.filled);
    setQty(1);
    setNote('');
    setConflict(null);
    personTouched.current = false;
    // The usual is read when a dish opens (the menu screen loads it first); learning from this add must not reset the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);
  // A dish that feeds two or more starts on «للسفرة» in a family order, until the person picks.
  useEffect(() => {
    if (!personTouched.current) setPersonId(defaultPersonFor(servesChosen(item, selection), family));
  }, [item, selection, family]);

  const problems = selectionProblems(item, selection);
  const price = sheetLinePrice(item, selection, qty);
  // f10: the line under the dish's menu deal (the server's percent, the rule orders.quote applies).
  const dealPrice = dealLinePrice(price, item.deal);
  const person = people.find((p) => p.id === personId) ?? null;

  const chips = useMemo(() => personChips({ household: household ?? [], saved: people, family }), [household, people, family]);
  const personItems = useMemo(
    () =>
      chips.map((c) =>
        c.kind === 'table'
          ? { id: c.id, label: t('item.for_table_chip'), avatar: { icon: 'family' as const, tone: 'accent' as const } }
          : c.kind === 'me'
            ? { id: c.id, label: t('item.for_me_chip'), avatar: { name: myName ?? t('item.for_me_chip'), tone: 'accent' as const } }
            : { id: c.id, label: c.name, avatar: { name: c.name } },
      ),
    [chips, myName, t],
  );
  const pickPerson = (id: string) => {
    personTouched.current = true;
    const chip = chips.find((c) => c.id === id);
    // A household member is saved as a cart person the first time they are picked.
    if (chip?.kind === 'household' && id.startsWith(HOUSEHOLD_PREFIX)) setPersonId(cartStore.addPerson(chip.name, null).id);
    else setPersonId(id);
  };

  const onToggle = (group: MenuModifierGroup, modifierId: string) => {
    const res = toggleModifier(item, selection, group.id, modifierId);
    setRemembered((r) => r.filter((id) => id !== group.id));
    if (res.blocked === 'max') toast.show({ message: `${group.name}: ${t('item.choose_up_to', { n: group.max })}`, icon: 'x' });
    else if (res.blocked === 'unavailable') toast.show({ message: t('item.sold_out'), icon: 'x' });
    setSelection(res.selection);
  };

  const savePerson = () => {
    const name = newName.trim();
    const phone = newPhone.trim() ? normalizeIraqiPhone(newPhone) : null;
    setNameError(name ? null : t('item.person_name_required'));
    setPhoneError(newPhone.trim() && !phone ? t('error.phone_invalid') : null);
    if (!name || (newPhone.trim() && !phone)) return;
    const p = cartStore.addPerson(name, phone);
    setPersonId(p.id);
    setAdding(false);
    setNewName('');
    setNewPhone('');
  };

  const add = (replace = false) => {
    const res = cartStore.add(
      merchant,
      { itemId: item.id, name: item.name, basePriceIqd: item.priceIqd, modifiers: chosenModifiers(item, selection), qty, note: note.trim() || null, personId },
      { replace },
    );
    if (!res.ok) {
      setConflict(res.current.name);
      return;
    }
    tasteStore.learn(item, selection);
    onAdded(item.name);
  };

  const missing = problems.find((p) => p.problem === 'too_few');
  const itemServesCopy = servesCopy(item.serves, locale);
  const itemServes = itemServesCopy ? t(itemServesCopy.key, 'params' in itemServesCopy ? itemServesCopy.params : undefined) : null;
  const cta = sheetCta(problems, item.available && !disabled);
  const goToMissing = (groupId: string) => {
    const y = groupY.current[groupId];
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, bodyY.current + y - 12), animated: !theme.reduceMotion });
    theme.haptic('warning');
    setFlash((f) => ({ groupId, n: (f?.n ?? 0) + 1 }));
  };

  return (
    <ModalSheet
      visible
      onClose={onClose}
      title={item.name}
      subtitle={item.description ?? undefined}
      hero={
        <View style={{ width: '100%', aspectRatio: HERO_RATIO }} testID="item-hero">
          <FoodArt {...artOf(item)} variant="wide" photoUrl={item.photoUrl} />
        </View>
      }
      scrollRef={scrollRef}
      layout="sheet"
      sheetMaxWidth={MAX_CONTENT_WIDTH}
      closeLabel={t('action.close')}
      testID="item-sheet"
      footer={
        <>
          {conflict ? (
            <Card elevation={0} tone="tint" padding={3} testID="item-conflict">
              <View style={{ gap: theme.space[2] }}>
                <Text variant="label">{t('cart.different_restaurant')}</Text>
                <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
                  <Button size="sm" label={t('cart.start_new')} onPress={() => add(true)} testID="item-conflict-replace" />
                  <Button size="sm" variant="secondary" label={t('cart.keep_current')} onPress={onClose} />
                </View>
              </View>
            </Card>
          ) : null}
          {item.available && dealPrice < price ? (
            <View testID="item-deal-price" style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'baseline', gap: theme.space[2] }}>
              <Text variant="label" weight={700} color="accentText" tabular>
                {iqd(dealPrice, { locale })}
              </Text>
              <Text variant="caption" color="textMuted" tabular style={{ textDecorationLine: 'line-through' }}>
                {iqd(price, { locale })}
              </Text>
            </View>
          ) : null}
          <Button
            testID="item-add"
            size="lg"
            fullWidth
            variant={cta.kind === 'choose' ? 'secondary' : 'primary'}
            disabled={cta.kind === 'blocked'}
            label={!item.available ? t('item.sold_out') : cta.kind === 'choose' ? t('item.choose_group', { group: cta.name }) : t('item.add_to_cart', { amount: amountParam(dealPrice) })}
            accessibilityHint={cta.kind === 'choose' ? t('item.missing_choice', { group: cta.name }) : undefined}
            onPress={() => (cta.kind === 'choose' ? goToMissing(cta.groupId) : add(false))}
          />
        </>
      }
    >
      <View style={{ gap: theme.space[5], paddingTop: theme.space[1] }} onLayout={(e) => (bodyY.current = e.nativeEvent.layout.y)}>
        {itemServes ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }} testID="item-serves">
            <Icon name="family" size={18} color="textMuted" />
            <Text variant="label" color="textMuted">
              {itemServes}
            </Text>
          </View>
        ) : null}
        {followable ? <FollowRow item={item} merchant={merchant} /> : null}
        {item.modifierGroups.map((g) => (
          <View key={g.id} onLayout={(e) => (groupY.current[g.id] = e.nativeEvent.layout.y)}>
            <ModifierGroupBlock group={g} basePrice={item.priceIqd} remembered={remembered.includes(g.id)} selected={selection[g.id] ?? []} onToggle={(id) => onToggle(g, id)} missing={missing?.groupId === g.id} flash={flash?.groupId === g.id ? flash.n : 0} />
          </View>
        ))}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="bodyStrong">{t('item.qty')}</Text>
          <Stepper value={qty} min={1} max={20} onChange={setQty} accessibilityLabel={t('item.qty')} />
        </View>

        <Rule />

        <View style={{ gap: theme.space[3] }} testID="item-for-whom">
          <Text variant="bodyStrong">{t('item.for_whom')}</Text>
          <ChipGroup
            items={personItems}
            value={[personId]}
            required
            onChange={(next) => pickPerson(next[0] ?? ME)}
            accessibilityLabel={t('item.for_whom')}
            action={{ label: t('item.add_person'), icon: 'plus', onPress: () => setAdding((a) => !a) }}
          />
          {adding ? (
            <Card elevation={0} tone="sunken" padding={3} testID="item-new-person">
              <View style={{ gap: theme.space[2] }}>
                <TextField testID="item-person-name" value={newName} onChangeText={setNewName} placeholder={t('item.person_name_placeholder')} error={nameError ?? undefined} />
                <TextField
                  testID="item-person-phone"
                  value={newPhone}
                  onChangeText={(v) => setNewPhone(formatPhoneInput(v))}
                  placeholder={t('item.person_phone_placeholder')}
                  keyboardType="phone-pad"
                  error={phoneError ?? undefined}
                />
                <Button size="sm" label={t('item.save_person')} icon="plus" onPress={savePerson} testID="item-person-save" />
              </View>
            </Card>
          ) : null}
          {/* Points reach a person only through their phone; the table's are the organiser's. */}
          {(person && person.phone) || personId === TABLE ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }} testID="item-points-to">
              <Icon name="gift" size={16} color="accentText" />
              <Text variant="footnote" color="accentText">
                {person ? t('item.points_go_to', { name: person.name }) : t('item.table_points')}
              </Text>
            </View>
          ) : null}
        </View>

        <TextField
          testID="item-note"
          label={person ? t('item.person_note', { name: person.name }) : t('cart.note_restaurant')}
          value={note}
          onChangeText={setNote}
          placeholder={t('item.note_placeholder')}
          maxLength={300}
        />
      </View>
    </ModalSheet>
  );
}

function ModifierGroupBlock({
  group,
  basePrice,
  remembered,
  selected,
  onToggle,
  missing,
  flash,
}: {
  group: MenuModifierGroup;
  basePrice: number;
  /** Filled in from the person's usual (q2): says «مثل آخر مرة». */
  remembered: boolean;
  selected: readonly string[];
  onToggle: (id: string) => void;
  missing: boolean;
  /** Changes each time the add button points here: the group's outline pulses twice in warning (o4). */
  flash: number;
}) {
  const theme = useTheme();
  const glow = useSharedValue(0);
  useEffect(() => {
    if (flash === 0) return;
    if (theme.reduceMotion) {
      glow.value = 1;
      return;
    }
    const d = theme.motion.duration.base;
    glow.value = withSequence(withTiming(1, { duration: d }), withTiming(0.2, { duration: d }), withTiming(1, { duration: d }), withTiming(0.6, { duration: d }));
  }, [flash, glow, theme.reduceMotion, theme.motion]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  const t = useT();
  const locale = useLocale();
  const servesOf = (serves: MenuModifierGroup['modifiers'][number]['serves']) => {
    const c = servesCopy(serves, locale);
    return c ? t(c.key, 'params' in c ? c.params : undefined) : null;
  };
  const rule = group.max === 1 ? t('item.choose_one') : group.min > 0 ? t('item.choose_at_least', { n: group.min }) : t('item.choose_up_to', { n: group.max });
  return (
    <View style={{ gap: theme.space[3] }} testID={`group-${group.id}`}>
      {flash > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', top: -theme.space[2], bottom: -theme.space[2], start: -theme.space[2], end: -theme.space[2], borderRadius: theme.radius.lg, borderWidth: 2, borderColor: theme.colors.warning }, glowStyle]}
        />
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
          {group.name}
        </Text>
        <Text variant="caption" color={remembered ? 'accentText' : 'textMuted'} weight={remembered ? 700 : 400} testID={remembered ? `group-${group.id}-remembered` : undefined}>
          {remembered ? t('item.remembered') : rule}
        </Text>
        <View style={{ flex: 1 }} />
        <StatusPill size="sm" tone={group.required ? (missing ? 'warning' : 'accent') : 'neutral'} label={group.required ? t('item.modifier_required') : t('item.modifier_optional')} />
      </View>
      {group.variant ? (
        <View style={{ borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' }}>
          {group.modifiers.map((m, i) => {
            const on = selected.includes(m.id);
            return (
              <Pressable
                key={m.id}
                testID={`variant-${m.id}`}
                accessibilityRole="radio"
                aria-checked={on}
                disabled={!m.available}
                onPress={() => {
                  theme.haptic('selection');
                  onToggle(m.id);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space[3],
                  minHeight: 52,
                  paddingHorizontal: theme.space[4],
                  backgroundColor: on ? theme.colors.accentTint : theme.colors.surface,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: theme.colors.border,
                  opacity: m.available ? 1 : theme.state.disabledOpacity,
                }}
              >
                <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? theme.colors.focusRing : theme.colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
                  {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.accent }} /> : null}
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text variant="body" weight={on ? 600 : 400}>
                    {m.name}
                  </Text>
                  {servesOf(m.serves) ? (
                    <Text variant="caption" color="textMuted" testID={`variant-serves-${m.id}`}>
                      {servesOf(m.serves)}
                    </Text>
                  ) : null}
                </View>
                <Text variant="label" tabular color={on ? 'text' : 'textMuted'}>
                  {iqd(basePrice + m.priceIqd, { locale })}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {group.modifiers.map((m) => (
            <Chip
              key={m.id}
              testID={`mod-${m.id}`}
              label={m.priceIqd > 0 ? `${m.name} ${iqd(m.priceIqd, { locale, sign: true })}` : m.name}
              selected={selected.includes(m.id)}
              role={group.max === 1 ? 'radio' : 'checkbox'}
              disabled={!m.available}
              onPress={() => onToggle(m.id)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/** «خبرني لمن يطبخوها» (joy h2): for a dish that was the kitchen's pot lately; signed-in people only. */
function FollowRow({ item, merchant }: { item: MenuItem; merchant: CartMerchant }) {
  const theme = useTheme();
  const t = useT();
  const signedIn = useSignedIn();
  const follows = useDishFollows();
  if (!signedIn) return null;
  const followed = Boolean(follows.data?.itemIds.includes(item.id));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }} testID="item-follow">
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight={600}>
          {followed ? t('item.following') : t('item.follow')}
        </Text>
        <Text variant="caption" color="textMuted">
          {t('item.follow_hint')}
        </Text>
      </View>
      <FollowBell merchantOrgId={merchant.id} itemId={item.id} dish={item.name} restaurant={merchant.name} followed={followed} testID="item-follow-bell" />
    </View>
  );
}
