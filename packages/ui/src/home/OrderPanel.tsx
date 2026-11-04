import { useEffect, useRef } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { t } from '@driver/i18n';
import { Avatar } from '../components/Avatar';
import { Text } from '../components/Text';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeProvider';
import { panelMinutes, STAGES, stageRuns, stepName, stepsA11y, trackerSteps, type OrderStage, type TrackerStep } from './logic';
import { HomePress } from './media';
import { homeSize, iqd, mins } from './format';
import { useHomeLook } from './look';
import { BigMinutes, Heading, PanelButton, PanelShell } from './panelParts';

type PanelAction = { label: string; onPress: () => void };

/**
 * A running order can be late but has no buttons; a cancelled one says why and what next, and has no clock,
 * cash or courier. The types keep the two apart, so the panel can't be handed a mix (audit round 7).
 */
type OrderState =
  | {
      stage: Exclude<OrderStage, 'cancelled'>;
      /** Minutes left; hidden once it has arrived. */
      minutes?: number;
      /** Late (audit round 3): the amber band, the new time in place of the minutes (one clock only), the late-promise rule on one quiet line. */
      notice?: LateNotice;
      actions?: undefined;
    }
  | {
      stage: 'cancelled';
      minutes?: undefined;
      /** Why it was cancelled and exactly what happens to the money. */
      notice?: EndedNotice;
      /** What to do next: one main button and one quiet one. */
      actions?: { primary: PanelAction; secondary?: PanelAction };
    };

export type OrderPanelProps = OrderState & {
  /** Where it comes from («مطعم خالد», or the pickup for a ride). */
  from: string;
  /** The stage line («طلع من المطعم»), from the app's order copy. */
  title: string;
  /** No connection: the minutes turn into an estimate and the panel says it is trying again. */
  offline?: boolean;
  /** Cash to hand over at the door, in dinars; leave out when paid from the wallet. */
  cash?: number;
  /** The courier or driver. */
  person?: { name: string; photo?: string; kind: 'courier' | 'driver' };
  onMessage?: () => void;
  testID?: string;
};

/** Late: the band title, the new time with its part of day («1:40 الظهر») and the late-promise rule. */
type LateNotice = { tone: 'late'; title: string; time?: string; text?: string };
/** Ended: why, and what happens to the money. */
type EndedNotice = { tone: 'ended'; title: string; text?: string };
export type OrderNotice = LateNotice | EndedNotice;

/** The courier's approved photo, or a calm forest circle with the initial (never an error-red identity colour). */
function PersonFace({ name, photo }: { name: string; photo?: string }) {
  const look = useHomeLook();
  if (photo) return <Avatar name={name} uri={photo} size={homeSize.face} />;
  // The first whole character (an emoji or a joined letter is never cut in half); no name, a person mark.
  const initial = Array.from(name.trim())[0];
  return (
    <View style={{ width: homeSize.face, height: homeSize.face, borderRadius: homeSize.face / 2, backgroundColor: look.panel.raised, alignItems: 'center', justifyContent: 'center' }}>
      {initial ? (
        <Text variant="bodyStrong" face="display" color={look.panel.on} compact>
          {initial}
        </Text>
      ) : (
        <Icon name="user" size={homeSize.icon} color={look.panel.onSoft} />
      )}
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
    <View testID={testID} style={{ backgroundColor: look.panel.raised, borderRadius: theme.radius.xl, paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], gap: homeSize.gapHair }}>
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
export function OrderPanel(props: OrderPanelProps) {
  const { from, title, stage, minutes, notice, actions, offline = false, cash, person, onMessage, testID } = props;
  const theme = useTheme();
  const steps = trackerSteps(stage);
  const late = notice?.tone === 'late' ? notice : null;
  const newTime = late?.time;
  // One clock only: a late order's new time replaces the minutes.
  const left = stageRuns(stage) && newTime === undefined && minutes !== undefined ? panelMinutes(minutes) : undefined;
  const ended = stage === 'cancelled';
  const { reduceMotion, haptic } = theme;
  const spoken = notice ? t('home.panel.spoken_notice', { title, notice: notice.title }) : title;
  // What is news: a new step, or a notice that arrives (or changes) while the step stays the same (late mid-ride).
  const news = `${stage}|${notice?.tone ?? ''}|${notice?.title ?? ''}`;
  const seen = useRef(news);
  const seenStage = useRef(stage);
  useEffect(() => {
    if (seen.current === news) return;
    seen.current = news;
    const newStep = seenStage.current !== stage;
    seenStage.current = stage;
    if (!reduceMotion) haptic(stage === 'arrived' ? 'success' : ended || (!newStep && late) ? 'warning' : 'light');
    // One announcement per change, the notice included: no live regions, so nothing is read twice.
    AccessibilityInfo.announceForAccessibility(spoken);
  }, [news, stage, ended, late, reduceMotion, haptic, spoken]);
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
