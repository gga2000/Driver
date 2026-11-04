import { useEffect, useRef, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { t } from '@driver/i18n';
import { Avatar } from '../components/Avatar';
import { RollingDigits } from '../components/RollingDigits';
import { Text } from '../components/Text';
import { formatAmount, ltr } from '../format';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeProvider';
import type { HomeCardDish } from './cards';
import { stageRuns, trackerSteps, type Meal, type OrderStage } from './logic';
import { HomePress, Picture, type DishPicture } from './media';
import { GUARD_MS, homeSize, iqd, mins } from './format';
import { countWord, useHomeLook } from './look';

export type { DishPicture } from './media';


/** Big minutes in orange with the word beside them: «12 دقيقة», «5 دقايق». */
function BigMinutes({ n, size = 'numeralMd', rough, testID }: { n: number; size?: 'numeralMd' | 'numeralSm'; /** Offline: an estimate, in cream, with «تقريباً». */ rough?: boolean; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[1] }}>
      {rough ? (
        <Text variant="label" color={look.panel.muted} compact>
          {t('home.panel.about')}
        </Text>
      ) : null}
      <RollingDigits value={String(n)} variant={size} face="display" color={rough ? look.panel.muted : look.panel.accent} testID={testID} />
      <Text variant="label" weight={600} color={look.panel.muted} compact>
        {countWord(n, 'home.unit.minute')}
      </Text>
    </View>
  );
}

function PanelShell({ children, testID, tight }: { children: ReactNode; testID?: string; tight?: boolean }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: look.panel.fill,
        padding: theme.space[4],
        paddingVertical: tight ? theme.space[3] : theme.space[4],
        gap: tight ? theme.space[2] : theme.space[3],
        borderTopWidth: look.panel.edge ? 1 : 0,
        borderTopColor: look.panel.edge ?? undefined,
      }}
    >
      {children}
    </View>
  );
}

function Heading({ over, title, live }: { over?: string; title: string; live?: boolean }) {
  const look = useHomeLook();
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      {over ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {live ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: look.live }} /> : null}
          <Text variant="footnote" color={look.panel.muted} numberOfLines={1}>
            {over}
          </Text>
        </View>
      ) : null}
      <Text variant="title" face="display" color={look.panel.on} numberOfLines={2}>
        {title}
      </Text>
    </View>
  );
}

// ─── Order ───────────────────────────────────────────────────────────────────────────────────────

export interface OrderPanelProps {
  /** Where it comes from («مطعم خالد», or the pickup for a ride). */
  from: string;
  /** The stage line («طلع من المطعم»), from the app's order copy. */
  title: string;
  stage: OrderStage;
  /** Minutes left; hidden once it has arrived or was cancelled. */
  minutes?: number;
  /**
   * An honest change, drawn as its own layout (audit round 3), never as one more orange sentence:
   * - `late`: an orange band («تأخرنا عليك · نعتذر»), the new time in place of the minutes (one clock only),
   *   and the late-promise rule on one quiet line;
   * - `ended`: why it was cancelled and exactly what happens to the money.
   */
  notice?: { tone: 'late' | 'ended'; title: string; text?: string; /** The new arrival time («1:40»), late only. */ time?: string };
  /** What to do next after a cancellation: one main button and one quiet one. */
  actions?: { primary: { label: string; onPress: () => void }; secondary?: { label: string; onPress: () => void } };
  /** No connection: the minutes turn into an estimate and the panel says it is trying again. */
  offline?: boolean;
  /** Cash to hand over at the door, in dinars; leave out when paid from the wallet. */
  cash?: number;
  /** The courier or driver. */
  person?: { name: string; photo?: string; kind: 'courier' | 'driver' };
  onMessage?: () => void;
  testID?: string;
}

const STEP_KEYS = ['home.step.placed', 'home.step.preparing', 'home.step.on_way', 'home.step.arrived'] as const;

/** The courier's approved photo, or a calm forest circle with the initial (never an error-red identity colour). */
function PersonFace({ name, photo }: { name: string; photo?: string }) {
  const look = useHomeLook();
  if (photo) return <Avatar name={name} uri={photo} size={40} />;
  return (
    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: look.panel.raised, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant="bodyStrong" face="display" color={look.panel.on} compact>
        {name.trim().charAt(0)}
      </Text>
    </View>
  );
}

/**
 * The panel under the map while an order or ride runs (spec §12.2): stage, rolling minutes, the four steps
 * (done = cream, now = orange, next = outlined), the cash to hand over with the no-change promise, and the
 * courier with «راسله». One focal point per state: the minutes, or the late band, or the next step after a
 * cancellation. One haptic per new step (plays once; silent under Reduce Motion).
 */
export function OrderPanel({ from, title, stage, minutes, notice, actions, offline, cash, person, onMessage, testID }: OrderPanelProps) {
  const theme = useTheme();
  const look = useHomeLook();
  const steps = trackerSteps(stage);
  const late = notice?.tone === 'late';
  const runs = stageRuns(stage) && minutes !== undefined && !(late && notice?.time);
  const seen = useRef(stage);
  useEffect(() => {
    if (seen.current === stage) return;
    seen.current = stage;
    if (!theme.reduceMotion) theme.haptic(stage === 'arrived' ? 'success' : stage === 'cancelled' ? 'warning' : 'light');
  }, [stage, theme]);
  const headA11y = late && notice?.time
    ? t('home.panel.late_a11y', { title, time: notice.time })
    : runs
      ? t(offline ? 'home.panel.order_rough_a11y' : 'home.panel.order_a11y', { title, minutes: mins(minutes!) })
      : title;
  return (
    <PanelShell testID={testID}>
      {late && notice ? (
        <View
          testID={testID ? `${testID}-late` : undefined}
          accessibilityLiveRegion="polite"
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 40, paddingHorizontal: theme.space[3], marginHorizontal: -theme.space[4], marginTop: -theme.space[4], backgroundColor: look.panel.accent }}
        >
          <Icon name="clock" size={18} color="onAccent" />
          <Text variant="label" weight={600} color="onAccent" compact numberOfLines={1} style={{ flex: 1 }}>
            {notice.title}
          </Text>
        </View>
      ) : null}

      <View accessible accessibilityLabel={headA11y} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
        <Heading over={from} title={title} />
        {late && notice?.time ? (
          <View style={{ alignItems: 'flex-end' }} testID={testID ? `${testID}-new-time` : undefined}>
            <Text variant="numeralMd" face="display" color={look.panel.accent} tabular>
              {ltr(notice.time)}
            </Text>
            <Text variant="footnote" color={look.panel.muted} compact>
              {t('home.panel.new_time')}
            </Text>
          </View>
        ) : runs ? (
          <BigMinutes n={minutes!} rough={offline} testID={testID ? `${testID}-minutes` : undefined} />
        ) : null}
      </View>

      {offline ? (
        <View testID={testID ? `${testID}-offline` : undefined} accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="wifi-off" size={16} color={look.panel.muted} />
          <Text variant="label" color={look.panel.onSoft} style={{ flex: 1 }}>
            {t('home.panel.offline_line')}
          </Text>
        </View>
      ) : null}

      {notice && (notice.tone === 'ended' || notice.text) ? (
        <Text testID={testID ? `${testID}-notice` : undefined} variant="label" color={look.panel.onSoft} accessibilityLiveRegion="polite">
          {notice.tone === 'ended' ? notice.title : null}
          {notice.tone === 'ended' && notice.text ? '\n' : null}
          {notice.text}
        </Text>
      ) : null}

      {steps.length > 0 ? (
        <View style={{ gap: theme.space[2], opacity: offline ? 0.6 : 1 }}>
          <View style={{ flexDirection: 'row', gap: theme.space[1] }}>
            {steps.map((s, i) => (
              <View
                key={i}
                testID={testID ? `${testID}-bar-${s}` : undefined}
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  // Only the step happening now is orange; done steps are quiet cream.
                  backgroundColor: s === 'now' ? look.panel.accent : s === 'done' ? look.panel.upcoming : 'transparent',
                  borderWidth: s === 'next' ? 1.5 : 0,
                  borderColor: look.panel.upcoming,
                }}
              />
            ))}
          </View>
          <View style={{ flexDirection: 'row' }}>
            {steps.map((s, i) => {
              const label = t(STEP_KEYS[i]!);
              return (
                <View
                  key={i}
                  accessible
                  accessibilityLabel={s === 'done' ? t('home.step_a11y', { step: label }) : s === 'now' ? t('home.step_now_a11y', { step: label }) : label}
                  style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 3 }}
                >
                  {s === 'done' ? <Icon name="check" size={13} color={look.panel.muted} strokeWidth={2.5} /> : null}
                  <Text variant="footnote" weight={s === 'now' ? 700 : 400} color={s === 'now' ? look.panel.on : look.panel.muted} compact numberOfLines={1}>
                    {label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {cash !== undefined && cash > 0 && stage !== 'cancelled' ? (
        <View testID={testID ? `${testID}-cash` : undefined} style={{ backgroundColor: look.panel.raised, borderRadius: theme.radius.xl, paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], gap: 2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="label" color={look.panel.onSoft}>
              {t('home.panel.cash_title')}
            </Text>
            <Text variant="title" face="display" color={look.panel.on} tabular>
              {iqd(cash)}
            </Text>
          </View>
          <Text variant="footnote" color={look.panel.muted}>
            {t('home.panel.cash_note')}
          </Text>
        </View>
      ) : null}

      {person && stage !== 'cancelled' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flex: 1, minWidth: 0 }}>
            <PersonFace name={person.name} photo={person.photo} />
            <Text variant="bodyStrong" face="display" color={look.panel.on} numberOfLines={1} style={{ flexShrink: 1 }}>
              {t(person.kind === 'courier' ? 'home.panel.courier' : 'home.panel.driver', { name: person.name })}
            </Text>
          </View>
          {onMessage ? (
            <HomePress
              onPress={onMessage}
              accessibilityLabel={t(offline ? 'home.panel.message_later_a11y' : 'home.panel.message_a11y', { name: person.name })}
              testID={testID ? `${testID}-message` : undefined}
              style={{ minHeight: theme.hitTarget, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, backgroundColor: look.panel.raised }}
            >
              <Icon name="chat" size={18} color={look.panel.on} />
              <Text variant="label" weight={600} color={look.panel.on} compact>
                {t('home.panel.message')}
              </Text>
            </HomePress>
          ) : null}
        </View>
      ) : null}

      {actions ? (
        <View style={{ gap: theme.space[2] }}>
          <PanelButton label={actions.primary.label} onPress={actions.primary.onPress} filled testID={testID ? `${testID}-primary` : undefined} />
          {actions.secondary ? <PanelButton label={actions.secondary.label} onPress={actions.secondary.onPress} testID={testID ? `${testID}-secondary` : undefined} /> : null}
        </View>
      ) : null}
    </PanelShell>
  );
}

/** A full-width round button on the forest: orange for the one next step, raised forest for the quiet one. */
function PanelButton({ label, a11y, onPress, filled, testID }: { label: string; a11y?: string; onPress: () => void; filled?: boolean; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <HomePress
      onPress={onPress}
      haptic={filled ? 'light' : 'secondary'}
      guardMs={GUARD_MS}
      accessibilityLabel={a11y ?? label}
      testID={testID}
      style={{ minHeight: homeSize.button, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space[5], backgroundColor: filled ? look.panel.accent : look.panel.raised }}
    >
      <Text variant="bodyStrong" face="display" color={filled ? 'onAccent' : look.panel.on} compact numberOfLines={1}>
        {label}
      </Text>
    </HomePress>
  );
}

// ─── Calm ────────────────────────────────────────────────────────────────────────────────────────

/** A dish on the panel: a home card dish, plus the price before the offer (offers only). */
export interface HomeDish extends HomeCardDish {
  was?: number;
}

/** The regular's usual order, shown in the calm panel in place of the fastest dish (audit round 3). */
export interface UsualOrder {
  restaurant: string;
  /** The items, already joined in words («تمن وقيمة ولبن»). */
  items: string;
  /** Last time's total in dinars (the server prices the new order). */
  price: number;
  picture?: DishPicture;
  /** Friday wording («مثل كل جمعة»). */
  friday: boolean;
  onReorder: () => void;
}

export interface CalmPanelProps {
  /** The fastest dish to the door right now (shown when there is no usual order). */
  dish: HomeDish;
  onDish?: (id: string) => void;
  /** A regular's usual order: the panel *becomes* it, with «اطلبه» (food is offered once, not twice). */
  usual?: UsualOrder;
  testID?: string;
}

/**
 * Most of the day (spec §12.2): the panel's one job. For a regular, the usual order with one orange
 * «اطلبه» (one tap, one order); for everyone else, the fastest dish and its minutes. Calm and compact.
 */
export function CalmPanel({ dish, onDish, usual, testID }: CalmPanelProps) {
  const theme = useTheme();
  const look = useHomeLook();
  if (usual) {
    const title = t(usual.friday ? 'home.usual_friday' : 'home.usual_title');
    const line = t('home.usual_line', { restaurant: usual.restaurant, items: usual.items });
    return (
      <PanelShell testID={testID} tight>
        <View accessible accessibilityLabel={t('home.usual_a11y', { title, line, price: iqd(usual.price) })} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Picture picture={usual.picture} name={usual.items} seed={usual.restaurant} width={homeSize.usualPhoto} height={homeSize.usualPhoto} radius={theme.radius.lg} testID={testID ? `${testID}-usual` : undefined} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="footnote" color={look.panel.muted} compact numberOfLines={1}>
              {title}
            </Text>
            <Text variant="bodyStrong" face="display" color={look.panel.on} numberOfLines={1}>
              {line}
            </Text>
            <Text variant="label" color={look.panel.onSoft} tabular compact>
              {iqd(usual.price)}
            </Text>
          </View>
        </View>
        <PanelButton label={t('home.usual_go')} a11y={t('home.usual_go_a11y', { restaurant: usual.restaurant })} onPress={usual.onReorder} filled testID={testID ? `${testID}-reorder` : undefined} />
      </PanelShell>
    );
  }
  return (
    <PanelShell testID={testID} tight>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
        {/* The open count lives on the أكل tile (audit round 2: each fact once). */}
        <Heading title={t('home.panel.fastest')} />
        <BigMinutes n={dish.minutes} size="numeralSm" />
      </View>
      <HomePress
        accessibilityLabel={t('home.panel.dish_a11y', { name: dish.name, restaurant: dish.restaurant, price: iqd(dish.price), minutes: mins(dish.minutes) })}
        onPress={onDish ? () => onDish(dish.id) : undefined}
        testID={testID ? `${testID}-dish` : undefined}
        style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: homeSize.button, padding: theme.space[1], paddingEnd: theme.space[3], borderRadius: theme.radius.pill, backgroundColor: look.panel.raised }}
      >
        <Picture picture={dish.picture} name={dish.name} seed={dish.id} width={40} height={40} radius={20} />
        <Text variant="label" color={look.panel.on} numberOfLines={1} style={{ flex: 1 }}>
          {t('home.panel.dish_line', { dish: dish.name, restaurant: dish.restaurant })}
        </Text>
        <Icon name="chevron-forward" size={18} color={look.panel.muted} />
      </HomePress>
    </PanelShell>
  );
}

// ─── Offers ──────────────────────────────────────────────────────────────────────────────────────

export interface OffersPanelProps {
  town: string;
  meal: Meal;
  /** When this meal's offers end («3», «11»). */
  until: string;
  dishes: readonly HomeDish[];
  onDish?: (id: string) => void;
  testID?: string;
}

/** At lunch and dinner when offers exist (spec §12.2): the meal, how long they last, the dishes with the old price struck through. */
export function OffersPanel({ town, meal, until, dishes, onDish, testID }: OffersPanelProps) {
  const theme = useTheme();
  const look = useHomeLook();
  // No offers left: the app falls back to the calm panel (`panelMode`); never «0 عرض».
  if (dishes.length === 0) return null;
  return (
    <PanelShell testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
        <Heading live over={t(meal === 'lunch' ? 'home.panel.offers_lunch' : 'home.panel.offers_dinner', { time: until })} title={t('home.panel.offers_title', { town })} />
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          <Text variant="numeralSm" face="display" color={look.panel.accent}>
            {String(dishes.length)}
          </Text>
          <Text variant="label" weight={600} color={look.panel.muted} compact>
            {countWord(dishes.length, 'home.unit.offer')}
          </Text>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2], paddingHorizontal: theme.space[4] }} style={{ marginHorizontal: -theme.space[4] }}>
        {dishes.map((d) => (
          <HomePress
            key={d.id}
            accessibilityLabel={t('home.panel.offer_a11y', { dish: t('home.panel.dish_a11y', { name: d.name, restaurant: d.restaurant, price: iqd(d.price), minutes: mins(d.minutes) }) })}
            onPress={onDish ? () => onDish(d.id) : undefined}
            testID={testID ? `${testID}-dish-${d.id}` : undefined}
            style={{ width: homeSize.offerWidth, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: look.panel.raised }}
          >
            <Picture picture={d.picture} name={d.name} seed={d.id} width="100%" height={homeSize.offerPhoto} radius={0} />
            <View style={{ position: 'absolute', top: theme.space[2], start: theme.space[2], backgroundColor: look.panel.accent, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[2] }}>
              <Text variant="footnote" weight={700} color="onAccent" compact>
                {t('home.panel.offer_badge')}
              </Text>
            </View>
            <View style={{ padding: theme.space[2], gap: 0 }}>
              <Text variant="label" weight={600} face="display" color={look.panel.on} numberOfLines={1}>
                {d.name}
              </Text>
              <Text variant="footnote" color={look.panel.muted} numberOfLines={1}>
                {t('home.panel.dish_meta', { restaurant: d.restaurant, minutes: t('live_map.min', { n: d.minutes }) })}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                <Text variant="label" weight={700} color={look.panel.cash} tabular>
                  {iqd(d.price)}
                </Text>
                {d.was !== undefined && d.was > d.price ? (
                  <Text variant="footnote" color={look.panel.muted} tabular accessibilityLabel={t('home.panel.was', { price: formatAmount(d.was) })} style={{ textDecorationLine: 'line-through' }}>
                    {ltr(formatAmount(d.was))}
                  </Text>
                ) : null}
              </View>
            </View>
          </HomePress>
        ))}
      </ScrollView>
    </PanelShell>
  );
}
