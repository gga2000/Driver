import { useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, Share, View } from 'react-native';
import type { RequestPostView, RequestShareInvite } from '@driver/contracts';
import { Button, Icon, StatusPill, Stepper, Text, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { countKey } from '@/lib/plural';
import { clockLabel } from './logic';
import { RuleList } from './Option';
import { useOpenShare } from './queries';
import { shareUrl } from './share';
import { shareFriends, shareSlots, type ShareSlot } from './share-car';

/**
 * Step 6 (Ali's item 56, design screen 6): the booker's panel on his picked private car. Before the
 * link: what sharing does and how many places are his. After: one place's price, everyone in the car
 * (him, friends who paid, empty places waiting for the link), the cash left for him, and the link.
 */
export function BookerSharePanel({ r, dayLabel }: { r: RequestPostView; dayLabel: string }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const locale = useLocale();
  const open = useOpenShare();
  const [mine, setMine] = useState(r.share?.bookerPlaces ?? 1);
  const failed = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }, 5000);

  if (!r.share) {
    if (!r.shareable) return null;
    return (
      <View testID="rajaa-carshare-offer" style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="share" size={22} color="accentText" strokeWidth={2} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" weight={700}>
              {t('rajaa.carshare_offer_title')}
            </Text>
            <Text variant="caption" color="textMuted">
              {t('rajaa.carshare_offer_body')}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 48 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="footnote" weight={600}>
              {t('rajaa.carshare_my_places')}
            </Text>
            <Text variant="caption" color="textMuted">
              {t('rajaa.carshare_my_places_hint')}
            </Text>
          </View>
          <Stepper size="sm" value={mine} min={1} max={r.seats - 1} onChange={setMine} accessibilityLabel={t('rajaa.carshare_my_places')} />
        </View>
        <Button
          testID="rajaa-carshare-open"
          variant="ink"
          icon="share"
          fullWidth
          label={t('rajaa.carshare_open_cta')}
          loading={open.isPending}
          onPress={() => open.mutate({ postId: r.id, bookerPlaces: mine }, { onError: failed })}
        />
      </View>
    );
  }

  const s = r.share;
  const picked = r.offers.find((o) => o.id === r.pickedOfferId);
  const closes = clockLabel(s.closesAt);
  const send = async () => {
    if (!s.path) return;
    const message = t('rajaa.carshare_message', { to: r.to.label, day: dayLabel, time: clockLabel(r.when), amount: amountParam(s.placeIqd), url: shareUrl(s.path) });
    try {
      // The phone's share sheet (WhatsApp first for most people here); on the web, WhatsApp's link.
      if (Platform.OS === 'web') await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
      else await Share.share({ message });
    } catch {
      toast.show({ message: t('sticker.failed'), tone: 'danger' });
    }
  };
  const empty = shareSlots(s).filter((x) => x === 'empty').length;

  return (
    <View testID="rajaa-carshare" style={{ gap: theme.space[3] }}>
      <View style={{ gap: theme.space[2], padding: theme.space[4], borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
        <Text variant="caption" weight={600} color="textMuted">
          {t('rajaa.carshare_each')}
        </Text>
        <Text variant="title" weight={700} testID="rajaa-carshare-each">
          {iqd(s.placeIqd, { locale })}
        </Text>
        {picked ? (
          <Text variant="caption" color="textMuted">
            {t('rajaa.carshare_split', { price: amountParam(picked.priceIqd), people: s.people })}
          </Text>
        ) : null}
        <SlotBar slots={shareSlots(s)} />
      </View>

      <PersonRow
        testID="rajaa-carshare-me"
        initial={t('rajaa.carshare_me').slice(0, 1)}
        title={s.bookerPlaces > 1 ? t('rajaa.carshare_named_places', { name: t('rajaa.carshare_me'), places: t(countKey('rajaa.carshare_places', s.bookerPlaces), { n: s.bookerPlaces }) }) : t('rajaa.carshare_me')}
        body={r.cashReserved || !r.depositIqd ? t('rajaa.carshare_me_body_cash') : t('rajaa.carshare_me_body')}
        tag={<StatusPill size="sm" tone="accent" label={t('rajaa.carshare_tag_booker')} />}
      />
      {shareFriends(s.members).map((m, i) => {
        const name = m.firstName ?? t('rajaa.carshare_friend_unnamed');
        return (
          <PersonRow
            key={`f${i}`}
            testID={`rajaa-carshare-friend-${i}`}
            initial={name.slice(0, 1)}
            title={m.places > 1 ? t('rajaa.carshare_named_places', { name, places: t(countKey('rajaa.carshare_places', m.places), { n: m.places }) }) : name}
            body={t('rajaa.carshare_friend_body', { amount: amountParam(m.amountIqd) })}
            tag={<StatusPill size="sm" tone="success" icon="check" label={t(m.boardedBy ? 'rajaa.carshare_tag_in' : 'rajaa.carshare_tag_paid')} />}
          />
        );
      })}
      {empty > 0 ? (
        <PersonRow
          testID="rajaa-carshare-empty"
          dashed
          initial="?"
          title={t(countKey('rajaa.carshare_empty_n', empty), { n: empty })}
          body={s.open ? t('rajaa.carshare_empty_body', { time: closes }) : t('rajaa.carshare_empty_closed')}
          tag={s.open ? <StatusPill size="sm" tone="neutral" label={t('rajaa.carshare_tag_waiting')} /> : null}
        />
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[2], paddingHorizontal: theme.space[1] }} testID="rajaa-carshare-cash">
        <Text variant="footnote" weight={600}>
          {t('rajaa.carshare_cash')}
        </Text>
        <Text variant="label" weight={700}>
          {iqd(s.cashIqd, { locale })}
        </Text>
      </View>
      {s.open ? (
        <RuleList items={[t('rajaa.carshare_rule_fallback', { time: closes }), t('rajaa.carshare_rule_cancel')]} />
      ) : (
        <Text variant="caption" color="textMuted" testID="rajaa-carshare-closed">
          {t('rajaa.carshare_closed_line', { time: closes })}
        </Text>
      )}
      {s.open && s.placesLeft > 0 ? (
        <Button testID="rajaa-carshare-send" variant="ink" icon="share" fullWidth label={t('rajaa.carshare_send')} onPress={() => void send()} />
      ) : null}
    </View>
  );
}

/** Everyone in the car as one bar: his places, friends who paid, places still empty. */
function SlotBar({ slots }: { slots: readonly ShareSlot[] }) {
  const theme = useTheme();
  const colour = (x: ShareSlot) => (x === 'me' ? theme.colors.accent : x === 'friend' ? theme.colors.success : theme.colors.surfaceSunken);
  return (
    <View style={{ flexDirection: 'row', gap: 3, height: 8, marginTop: theme.space[1] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {slots.map((x, i) => (
        <View key={i} style={{ flex: 1, borderRadius: 4, backgroundColor: colour(x) }} />
      ))}
    </View>
  );
}

function PersonRow({ initial, title, body, tag, dashed = false, testID }: { initial: string; title: string; body: string; tag: ReactNode; dashed?: boolean; testID?: string }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        minHeight: 56,
        paddingVertical: theme.space[2],
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderStyle: dashed ? 'dashed' : 'solid',
        borderColor: dashed ? theme.colors.borderStrong : theme.colors.border,
        backgroundColor: theme.colors.surface,
      }}
    >
      <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: dashed ? theme.colors.surfaceSunken : theme.colors.accentTint }}>
        <Text variant="label" weight={700} color={dashed ? 'textMuted' : 'accentText'}>
          {initial}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="footnote" weight={700}>
          {title}
        </Text>
        <Text variant="caption" color="textMuted">
          {body}
        </Text>
      </View>
      {tag}
    </View>
  );
}


/** Step 6: on the board, the shared car he joined (a friend's), one tap back to its page. */
export function SharedCarStrip({ car, onPress }: { car: RequestShareInvite; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  const now = new Date();
  const sameDay = Math.floor((car.when.getTime() + 3 * 3600_000) / 86_400_000) === Math.floor((now.getTime() + 3 * 3600_000) / 86_400_000);
  return (
    <Pressable
      testID="rajaa-shared-strip"
      accessibilityRole="button"
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 48, padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: theme.colors.successTint }}
    >
      <Icon name="share" size={20} color="successText" strokeWidth={2} />
      <Text variant="footnote" weight={600} style={{ flex: 1 }}>
        {t('rajaa.shared_strip', { to: car.to.label, day: t(sameDay ? 'rajaa.day_today' : 'rajaa.day_tomorrow'), time: clockLabel(car.when) })}
      </Text>
      <Icon name="chevron-forward" size={18} color="textMuted" />
    </Pressable>
  );
}
