import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, View, type ImageSourcePropType } from 'react-native';
import { t } from '@driver/i18n';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { LocalPhoto, PhotoImage } from '../components/PhotoImage';
import { RollingDigits } from '../components/RollingDigits';
import { Text } from '../components/Text';
import { formatAmount, ltr } from '../format';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeProvider';
import { trackerSteps, type OrderStage } from './logic';
import { countWord, useHomeLook } from './look';

/** A dish picture: a bundled one (gallery, demo) or a network photo. */
export type DishPicture = { source: ImageSourcePropType } | { uri: string };

function DishPhoto({ picture, size, radius }: { picture: DishPicture; size: { width: number | `${number}%`; height: number }; radius: number }) {
  const style = { ...size, borderRadius: radius };
  return 'uri' in picture ? <PhotoImage uri={picture.uri} style={style} /> : <LocalPhoto source={picture.source} style={style} />;
}

/** Big minutes in orange with the word beside them: «12 دقيقة», «5 دقايق». */
function BigMinutes({ n, size = 'numeralMd', testID }: { n: number; size?: 'numeralMd' | 'numeralSm'; testID?: string }) {
  const look = useHomeLook();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
      <RollingDigits value={String(n)} variant={size} face="display" color={look.panel.accent} testID={testID} />
      <Text variant="label" weight={600} color={look.panel.muted} compact>
        {countWord(n, 'home.word.minute', 'home.word.minute_pl')}
      </Text>
    </View>
  );
}

function PanelShell({ children, testID, tight }: { children: React.ReactNode; testID?: string; tight?: boolean }) {
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

function Heading({ over, title, live }: { over: string; title: string; live?: boolean }) {
  const look = useHomeLook();
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {live ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: look.live }} /> : null}
        <Text variant="footnote" color={look.panel.muted} numberOfLines={1}>
          {over}
        </Text>
      </View>
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
  /** The stage line («الدليفري طلع من المطعم»), from the app's order copy. */
  title: string;
  stage: OrderStage;
  /** Minutes left; hidden once it has arrived. */
  minutes: number;
  /** Cash to hand over at the door, in dinars; leave out when paid from the wallet. */
  cash?: number;
  /** The courier or driver. */
  person?: { name: string; photo?: string; kind: 'courier' | 'driver' };
  onMessage?: () => void;
  testID?: string;
}

const STEP_KEYS = ['home.step.placed', 'home.step.preparing', 'home.step.on_way', 'home.step.arrived'] as const;

/**
 * The panel under the map while an order or ride runs (spec §12.2): stage, rolling minutes, the four steps
 * (done = check, now = orange, next = outlined), the cash to hand over with the no-change promise, and the
 * courier with «راسله». One haptic per new step (plays once; silent under Reduce Motion).
 */
export function OrderPanel({ from, title, stage, minutes, cash, person, onMessage, testID }: OrderPanelProps) {
  const theme = useTheme();
  const look = useHomeLook();
  const steps = trackerSteps(stage);
  const seen = useRef(stage);
  useEffect(() => {
    if (seen.current === stage) return;
    seen.current = stage;
    if (!theme.reduceMotion) theme.haptic(stage === 'arrived' ? 'success' : 'light');
  }, [stage, theme]);
  return (
    <PanelShell testID={testID}>
      <View accessible accessibilityLabel={t('home.panel.order_a11y', { title, minutes })} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
        <Heading over={from} title={title} />
        {stage === 'arrived' ? null : <BigMinutes n={minutes} testID={testID ? `${testID}-minutes` : undefined} />}
      </View>

      <View style={{ gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {steps.map((s, i) => (
            <View
              key={i}
              testID={testID ? `${testID}-bar-${s}` : undefined}
              style={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                backgroundColor: s === 'next' ? 'transparent' : look.panel.accent,
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
                accessibilityLabel={s === 'done' ? t('home.step_a11y', { step: label }) : label}
                accessibilityState={{ selected: s === 'now' }}
                style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 3 }}
              >
                {s === 'done' ? <Icon name="check" size={13} color={look.panel.on} strokeWidth={2.5} /> : null}
                <Text variant="footnote" weight={s === 'now' ? 700 : 400} color={s === 'now' ? look.panel.cash : s === 'next' ? look.panel.upcoming : look.panel.on} compact numberOfLines={1}>
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {cash !== undefined && cash > 0 ? (
        <View testID={testID ? `${testID}-cash` : undefined} style={{ backgroundColor: look.panel.raised, borderRadius: theme.radius.xl, paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], gap: 2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="label" color={look.panel.on}>
              {t('home.panel.cash_title')}
            </Text>
            <Text variant="title" face="display" color={look.panel.cash} tabular>
              {t('unit.iqd', { amount: ltr(formatAmount(cash)) })}
            </Text>
          </View>
          <Text variant="footnote" color={look.panel.muted}>
            {t('home.panel.cash_note')}
          </Text>
        </View>
      ) : null}

      {person ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flex: 1, minWidth: 0 }}>
            <Avatar name={person.name} uri={person.photo} size={40} />
            <Text variant="bodyStrong" face="display" color={look.panel.on} numberOfLines={1} style={{ flexShrink: 1 }}>
              {t(person.kind === 'courier' ? 'home.panel.courier' : 'home.panel.driver', { name: person.name })}
            </Text>
          </View>
          {onMessage ? (
            <Button label={t('home.panel.message')} icon="chat" size="md" onPress={onMessage} accessibilityLabel={t('home.panel.message_a11y', { name: person.name })} testID={testID ? `${testID}-message` : undefined} />
          ) : null}
        </View>
      ) : null}
    </PanelShell>
  );
}

// ─── Calm ────────────────────────────────────────────────────────────────────────────────────────

export interface HomeDish {
  id: string;
  name: string;
  restaurant: string;
  /** Minutes to the door. */
  minutes: number;
  /** Price now, in dinars. */
  price: number;
  /** The price before the offer (offers only). */
  was?: number;
  picture: DishPicture;
}

export interface CalmPanelProps {
  town: string;
  /** Restaurants open now. */
  open: number;
  /** The fastest dish to the door right now. */
  dish: HomeDish;
  onDish?: (id: string) => void;
  testID?: string;
}

/** Most of the day (spec §12.2): one line, the fastest dish and its minutes. Calm and compact. */
export function CalmPanel({ town, open, dish, onDish, testID }: CalmPanelProps) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <PanelShell testID={testID} tight>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
        <Heading live over={t('home.panel.town_line', { town, open: t('live_map.open_now', { n: open }) })} title={t('home.panel.fastest')} />
        <BigMinutes n={dish.minutes} size="numeralSm" />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('home.panel.dish_a11y', { name: dish.name, restaurant: dish.restaurant, price: t('unit.iqd', { amount: formatAmount(dish.price) }), minutes: dish.minutes })}
        onPress={onDish ? () => onDish(dish.id) : undefined}
        testID={testID ? `${testID}-dish` : undefined}
        style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 48, padding: 4, paddingEnd: theme.space[3], borderRadius: theme.radius.pill, backgroundColor: look.panel.raised }}
      >
        <DishPhoto picture={dish.picture} size={{ width: 40, height: 40 }} radius={20} />
        <Text variant="label" color={look.panel.on} numberOfLines={1} style={{ flex: 1 }}>
          {`${dish.name} · ${dish.restaurant}`}
        </Text>
        <Icon name="chevron-forward" size={18} color={look.panel.muted} />
      </Pressable>
    </PanelShell>
  );
}

// ─── Offers ──────────────────────────────────────────────────────────────────────────────────────

export interface OffersPanelProps {
  town: string;
  meal: 'lunch' | 'dinner';
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
  return (
    <PanelShell testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
        <Heading live over={t(meal === 'lunch' ? 'home.panel.offers_lunch' : 'home.panel.offers_dinner', { time: until })} title={t('home.panel.offers_title', { town })} />
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          <Text variant="numeralSm" face="display" color={look.panel.accent}>
            {String(dishes.length)}
          </Text>
          <Text variant="label" weight={600} color={look.panel.muted} compact>
            {countWord(dishes.length, 'home.word.offer', 'home.word.offer_pl')}
          </Text>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2] }} style={{ marginHorizontal: -theme.space[4] }}>
        <View style={{ width: theme.space[2] }} />
        {dishes.map((d) => (
          <Pressable
            key={d.id}
            accessibilityRole="button"
            accessibilityLabel={`${t('home.panel.offer_badge')}: ${t('home.panel.dish_a11y', { name: d.name, restaurant: d.restaurant, price: t('unit.iqd', { amount: formatAmount(d.price) }), minutes: d.minutes })}`}
            onPress={onDish ? () => onDish(d.id) : undefined}
            testID={testID ? `${testID}-dish-${d.id}` : undefined}
            style={{ width: 148, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: look.panel.raised }}
          >
            <DishPhoto picture={d.picture} size={{ width: '100%', height: 84 }} radius={0} />
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
                  {t('unit.iqd', { amount: ltr(formatAmount(d.price)) })}
                </Text>
                {d.was ? (
                  <Text variant="footnote" color={look.panel.muted} tabular accessibilityLabel={t('home.panel.was', { price: formatAmount(d.was) })} style={{ textDecorationLine: 'line-through' }}>
                    {ltr(formatAmount(d.was))}
                  </Text>
                ) : null}
              </View>
            </View>
          </Pressable>
        ))}
        <View style={{ width: theme.space[2] }} />
      </ScrollView>
    </PanelShell>
  );
}
