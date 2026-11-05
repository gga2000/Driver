import { ScrollView, View } from 'react-native';
import { t } from '@driver/i18n';
import { Text } from '../components/Text';
import { formatAmount, ltr } from '../format';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeProvider';
import type { HomeCardDish } from './cards';
import type { Meal } from './logic';
import { HomePress, Picture, type DishPicture } from './media';
import { homeSize, iqd, mins } from './format';
import { countWord, useHomeLook } from './look';
import { BigMinutes, Heading, PanelButton, PanelShell } from './panelParts';

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
  /** How long it takes today from that kitchen (the same learned minutes the dish cards show); left out when unknown. */
  minutes?: number;
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
        <View accessible accessibilityLabel={t('home.usual_a11y', { title, line, price: usual.minutes === undefined ? iqd(usual.price) : t('home.usual_meta', { price: iqd(usual.price), minutes: mins(usual.minutes) }) })} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Picture picture={usual.picture} name={usual.items} seed={usual.restaurant} width={homeSize.usualPhoto} height={homeSize.usualPhoto} radius={theme.radius.lg} testID={testID ? `${testID}-usual` : undefined} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="footnote" color={look.panel.muted} compact numberOfLines={1}>
              {title}
            </Text>
            <Text variant="bodyStrong" face="display" color={look.panel.on} numberOfLines={1}>
              {line}
            </Text>
            <Text variant="label" color={look.panel.onSoft} tabular compact numberOfLines={1}>
              {usual.minutes === undefined ? iqd(usual.price) : t('home.usual_meta', { price: iqd(usual.price), minutes: mins(usual.minutes) })}
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
        <Icon name="chevron-forward" size={homeSize.icon} color={look.panel.muted} />
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
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[1] }}>
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
              <Text variant="footnote" weight={700} color={look.panel.onAccent} compact>
                {t('home.panel.offer_badge')}
              </Text>
            </View>
            <View style={{ padding: theme.space[2] }}>
              <Text variant="label" weight={600} face="display" color={look.panel.on} numberOfLines={1}>
                {d.name}
              </Text>
              <Text variant="footnote" color={look.panel.muted} numberOfLines={1}>
                {t('home.panel.dish_meta', { restaurant: d.restaurant, minutes: mins(d.minutes) })}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: homeSize.gapTight, flexWrap: 'wrap' }}>
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
