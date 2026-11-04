import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, ScrollView, View } from 'react-native';
import { t } from '@driver/i18n';
import { Avatar } from '../components/Avatar';
import { RollingDigits } from '../components/RollingDigits';
import { Text } from '../components/Text';
import { formatAmount, ltr } from '../format';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeProvider';
import type { HomeCardDish } from './cards';
import { panelMinutes, STAGES, stageRuns, stepName, stepsA11y, trackerSteps, type Meal, type OrderStage, type TrackerStep } from './logic';
import { HomePress, Picture, type DishPicture } from './media';
import { GUARD_MS, homeSize, iqd, mins } from './format';
import { countWord, useHomeLook } from './look';

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

/** The forest panel. `band` sits edge to edge above the padded body (the late band), so nothing relies on negative margins. */
function PanelShell({ children, band, testID, tight }: { children: ReactNode; band?: ReactNode; testID?: string; tight?: boolean }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <View testID={testID} style={{ backgroundColor: look.panel.fill, borderTopWidth: look.panel.edge ? 1 : 0, borderTopColor: look.panel.edge ?? undefined }}>
      {band}
      <View style={{ padding: theme.space[4], paddingVertical: tight ? theme.space[3] : theme.space[4], gap: tight ? theme.space[2] : theme.space[3] }}>{children}</View>
    </View>
  );
}

function Heading({ over, title, live }: { over?: string; title: string; live?: boolean }) {
  const look = useHomeLook();
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      {over ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {live ? <View style={{ width: homeSize.dot, height: homeSize.dot, borderRadius: homeSize.dot / 2, backgroundColor: look.live }} /> : null}
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
  notice?: OrderNotice;
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

/** Late: the band title, the new time with its part of day («1:40 الظهر») and the late-promise rule. Ended: why, and what happens to the money. */
export type OrderNotice = { tone: 'late'; title: string; time?: string; text?: string } | { tone: 'ended'; title: string; text?: string };

/** The courier's approved photo, or a calm forest circle with the initial (never an error-red identity colour). */
function PersonFace({ name, photo }: { name: string; photo?: string }) {
  const look = useHomeLook();
  if (photo) return <Avatar name={name} uri={photo} size={homeSize.face} />;
  return (
    <View style={{ width: homeSize.face, height: homeSize.face, borderRadius: homeSize.face / 2, backgroundColor: look.panel.raised, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant="bodyStrong" face="display" color={look.panel.on} compact>
        {name.trim().charAt(0)}
      </Text>
    </View>
  );
}

/** What a screen reader hears for the panel's head. */
function headLabel(title: string, newTime: string | undefined, left: number | undefined, offline: boolean): string {
  if (newTime !== undefined) return t('home.panel.late_a11y', { title, time: newTime });
  if (left === undefined) return title;
  if (left === 0) return t('home.panel.arriving_a11y', { title });
  return t(offline ? 'home.panel.order_rough_a11y' : 'home.panel.order_a11y', { title, minutes: mins(left) });
}

/** The late-promise band: its own amber, a clock, one line («تأخرنا عليك · نعتذر»). */
function LateBand({ title, testID }: { title: string; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: homeSize.band, paddingHorizontal: theme.space[4], backgroundColor: look.late.fill }}>
      <Icon name="clock" size={homeSize.icon} color={look.late.on} />
      <Text variant="label" weight={600} color={look.late.on} compact numberOfLines={1} style={{ flex: 1 }}>
        {title}
      </Text>
    </View>
  );
}

/** Where it comes from, the stage, and the one clock: the minutes, «يوصل هسة», or (late) the new time on its own row. */
function PanelHead({ from, title, newTime, left, offline, testID }: { from: string; title: string; newTime?: string; left?: number; offline: boolean; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <View accessible accessibilityLabel={headLabel(title, newTime, left, offline)} style={{ gap: theme.space[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
        <Heading over={from} title={title} />
        {newTime !== undefined ? null : left === 0 ? (
          <Text variant="bodyStrong" face="display" color={look.panel.accent} compact testID={testID ? `${testID}-arriving` : undefined}>
            {t('home.panel.arriving')}
          </Text>
        ) : left !== undefined ? (
          <BigMinutes n={left} rough={offline} testID={testID ? `${testID}-minutes` : undefined} />
        ) : null}
      </View>
      {newTime !== undefined ? (
        // Late: the new time gets its own row, so the stage title never wraps beside it.
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }} testID={testID ? `${testID}-new-time` : undefined}>
          <Text variant="label" color={look.panel.muted} compact>
            {t('home.panel.new_time')}
          </Text>
          <Text variant="numeralSm" face="display" color={look.panel.accent} tabular numberOfLines={1}>
            {newTime}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** The four steps as one screen-reader stop («خطوة 2 من 4: دا يتحضّر»); now = orange (muted offline), done = cream with a check, next = outlined. */
function StepTrack({ steps, offline, testID }: { steps: readonly TrackerStep[]; offline: boolean; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <View accessible accessibilityLabel={stepsA11y(steps)} testID={testID ? `${testID}-steps` : undefined} style={{ gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', gap: theme.space[1] }}>
        {steps.map((s, i) => (
          <View
            key={i}
            testID={testID ? `${testID}-bar-${s}` : undefined}
            style={{
              flex: 1,
              height: homeSize.bar,
              borderRadius: homeSize.bar / 2,
              backgroundColor: s === 'now' ? (offline ? look.panel.muted : look.panel.accent) : s === 'done' ? look.panel.onSoft : 'transparent',
              borderWidth: s === 'next' ? homeSize.outline : 0,
              borderColor: look.panel.upcoming,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {steps.map((s, i) => (
          <View key={i} style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: theme.space[1] }}>
            {s === 'done' ? <Icon name="check" size={homeSize.iconSm} color={look.panel.onSoft} strokeWidth={2.75} /> : null}
            <Text variant="footnote" weight={s === 'now' ? 700 : 400} color={s === 'next' ? look.panel.muted : look.panel.on} compact numberOfLines={1}>
              {stepName(STAGES[i]!)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** «جهّز 19,250 دينار» with «الخردة علينا، تنحط بمحفظتك». */
function CashRow({ cash, testID }: { cash: number; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <View testID={testID} style={{ backgroundColor: look.panel.raised, borderRadius: theme.radius.xl, paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.space[2] }}>
        <Text variant="title" face="display" color={look.panel.on} tabular>
          {t('home.panel.cash_line', { price: iqd(cash) })}
        </Text>
        <Icon name="cash" size={homeSize.icon} color={look.panel.onSoft} />
      </View>
      <Text variant="footnote" color={look.panel.muted}>
        {t('home.panel.cash_note')}
      </Text>
    </View>
  );
}

/** The courier or driver with «راسله». */
function PersonRow({ person, offline, onMessage, testID }: { person: NonNullable<OrderPanelProps['person']>; offline: boolean; onMessage?: () => void; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
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
          style={{ minHeight: theme.hitTarget, flexDirection: 'row', alignItems: 'center', gap: theme.space[1], paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, backgroundColor: look.panel.raised }}
        >
          <Icon name="chat" size={homeSize.icon} color={look.panel.on} />
          <Text variant="label" weight={600} color={look.panel.on} compact>
            {t('home.panel.message')}
          </Text>
        </HomePress>
      ) : null}
    </View>
  );
}

/**
 * The panel under the map while an order or ride runs (spec §12.2): stage, rolling minutes, the four steps,
 * the cash to hand over with «الخردة علينا», and the courier with «راسله». One focal point per state: the
 * minutes, or the late band, or the next step after a cancellation. A new step plays one haptic (silent
 * under Reduce Motion) and is announced once to screen readers, with its notice when there is one.
 */
export function OrderPanel({ from, title, stage, minutes, notice, actions, offline = false, cash, person, onMessage, testID }: OrderPanelProps) {
  const theme = useTheme();
  const steps = trackerSteps(stage);
  const late = notice?.tone === 'late' ? notice : null;
  const newTime = late?.time;
  // One clock only: a late order's new time replaces the minutes.
  const left = stageRuns(stage) && newTime === undefined && minutes !== undefined ? panelMinutes(minutes) : undefined;
  const ended = stage === 'cancelled';
  const seen = useRef(stage);
  const { reduceMotion, haptic } = theme;
  const spoken = notice ? `${title}. ${notice.title}` : title;
  useEffect(() => {
    if (seen.current === stage) return;
    seen.current = stage;
    if (!reduceMotion) haptic(stage === 'arrived' ? 'success' : ended ? 'warning' : 'light');
    // One announcement per new step, the notice included: no live regions, so nothing is read twice.
    AccessibilityInfo.announceForAccessibility(spoken);
  }, [stage, ended, reduceMotion, haptic, spoken]);
  return (
    <PanelShell testID={testID} band={late ? <LateBand title={late.title} testID={testID ? `${testID}-late` : undefined} /> : null}>
      <PanelHead from={from} title={title} newTime={newTime} left={left} offline={offline} testID={testID} />
      {offline ? <OfflineLine testID={testID ? `${testID}-offline` : undefined} /> : null}
      {notice && (notice.tone === 'ended' || notice.text) ? <NoticeText notice={notice} testID={testID ? `${testID}-notice` : undefined} /> : null}
      {steps.length > 0 ? <StepTrack steps={steps} offline={offline} testID={testID} /> : null}
      {cash !== undefined && cash > 0 && !ended ? <CashRow cash={cash} testID={testID ? `${testID}-cash` : undefined} /> : null}
      {person && !ended ? <PersonRow person={person} offline={offline} onMessage={onMessage} testID={testID} /> : null}
      {actions ? (
        <View style={{ gap: theme.space[2] }}>
          <PanelButton label={actions.primary.label} onPress={actions.primary.onPress} tone="accent" testID={testID ? `${testID}-primary` : undefined} />
          {actions.secondary ? <PanelButton label={actions.secondary.label} onPress={actions.secondary.onPress} tone="quiet" testID={testID ? `${testID}-secondary` : undefined} /> : null}
        </View>
      ) : null}
    </PanelShell>
  );
}

function OfflineLine({ testID }: { testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      <Icon name="wifi-off" size={homeSize.iconSm} color={look.panel.muted} />
      <Text variant="label" color={look.panel.onSoft} style={{ flex: 1 }}>
        {t('home.panel.reconnecting')}
      </Text>
    </View>
  );
}

function NoticeText({ notice, testID }: { notice: OrderNotice; testID?: string }) {
  const look = useHomeLook();
  return (
    <Text testID={testID} variant="label" color={look.panel.onSoft}>
      {notice.tone === 'ended' ? notice.title : null}
      {notice.tone === 'ended' && notice.text ? '\n' : null}
      {notice.text}
    </Text>
  );
}

/**
 * A full-width round button on the forest: `accent` (orange) for the one next step on a screen, `light`
 * (cream with forest text) when the orange already lives elsewhere on the screen (the food tile), and
 * `quiet` (raised forest) for the second choice.
 */
function PanelButton({ label, a11y, onPress, tone, testID }: { label: string; a11y?: string; onPress: () => void; tone: 'accent' | 'light' | 'quiet'; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  const filled = tone !== 'quiet';
  const bg = tone === 'accent' ? look.panel.accent : tone === 'light' ? look.panel.on : look.panel.raised;
  const fg = tone === 'accent' ? 'onAccent' : tone === 'light' ? look.panel.fill : look.panel.on;
  return (
    <HomePress
      onPress={onPress}
      haptic={filled ? 'light' : 'secondary'}
      guardMs={GUARD_MS}
      accessibilityLabel={a11y ?? label}
      testID={testID}
      style={{ minHeight: homeSize.button, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space[5], backgroundColor: bg }}
    >
      <Text variant="bodyStrong" face="display" color={fg} compact numberOfLines={1}>
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
  /** Stable id of the usual order (for the reorder callback). */
  id: string;
  restaurant: string;
  /** The items, already joined in words («تمن وقيمة ولبن»). */
  items: string;
  /** Last time's total in dinars (the server prices the new order). */
  price: number;
  picture?: DishPicture;
  /** Friday wording («مثل كل جمعة»). */
  friday: boolean;
}

/**
 * Either the fastest dish (anyone), or a regular's usual order: the panel *becomes* it, with «اطلبه»
 * (food is offered once, not twice).
 */
export type CalmPanelProps = ({ dish: HomeDish; onDish?: (id: string) => void; usual?: undefined } | { usual: UsualOrder; onReorder: (id: string) => void; dish?: undefined }) & { testID?: string };

/**
 * Most of the day (spec §12.2): the panel's one job. For a regular, the usual order with one orange
 * «اطلبه» (one tap, one order); for everyone else, the fastest dish and its minutes. Calm and compact.
 */
export function CalmPanel(props: CalmPanelProps) {
  const theme = useTheme();
  const look = useHomeLook();
  const { testID } = props;
  if (props.usual) {
    const { usual, onReorder } = props;
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
        <PanelButton label={t('home.usual_go')} a11y={t('home.usual_go_a11y', { restaurant: usual.restaurant })} onPress={() => onReorder(usual.id)} tone="light" testID={testID ? `${testID}-reorder` : undefined} />
      </PanelShell>
    );
  }
  const { dish, onDish } = props;
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
        <Picture picture={dish.picture} name={dish.name} seed={dish.id} width={homeSize.face} height={homeSize.face} radius={homeSize.face / 2} />
        <Text variant="label" color={look.panel.on} numberOfLines={1} style={{ flex: 1 }}>
          {t('home.panel.dish_line', { dish: dish.name, restaurant: dish.restaurant })}
        </Text>
        <Icon name="chevron-forward" size={18} color={look.panel.muted} />
      </HomePress>
    </PanelShell>
  );
}

const offerA11y = (d: HomeDish) => {
  const dish = t('home.panel.dish_a11y', { name: d.name, restaurant: d.restaurant, price: iqd(d.price), minutes: mins(d.minutes) });
  return d.was !== undefined && d.was > d.price ? t('home.panel.offer_was_a11y', { dish, was: iqd(d.was) }) : t('home.panel.offer_a11y', { dish });
};

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
            accessibilityLabel={offerA11y(d)}
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
                {t('home.panel.dish_meta', { restaurant: d.restaurant, minutes: mins(d.minutes) })}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                <Text variant="label" weight={700} color={look.panel.cash} tabular>
                  {iqd(d.price)}
                </Text>
                {d.was !== undefined && d.was > d.price ? (
                  <Text variant="footnote" color={look.panel.muted} tabular accessibilityLabel={t('home.panel.was', { price: iqd(d.was) })} style={{ textDecorationLine: 'line-through' }}>
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
