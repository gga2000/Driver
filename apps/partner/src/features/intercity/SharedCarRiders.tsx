import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { DriverRequestRide } from '@driver/contracts';
import { Button, Card, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useRequestActions } from './queries';

/**
 * Way C (Ali 2026-10-09: "c"): who is in a shared private car. The booker pays the cash; each friend
 * paid in the app and confirms «صعدت» on his own phone next to the car. A friend whose phone can't,
 * the driver confirms for him (logged; the friend is told and can answer «ما صعدت»).
 */
export function SharedCarRiders({ ride, collectIqd }: { ride: DriverRequestRide; collectIqd: number }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { boardFor } = useRequestActions();
  const friends = (ride.share?.members ?? []).filter((m) => m.state === 'joined');
  if (!ride.share || friends.length === 0) return null;
  const arrived = ride.state === 'driver_arrived';
  const done = friends.filter((m) => m.boardedBy !== null).length;

  const confirm = (memberId: string) =>
    boardFor.mutate(
      { postId: ride.id, memberId },
      {
        onSuccess: () => {
          theme.haptic('success');
          toast.show({ message: t('partner.ic_share_boarded_toast'), tone: 'success' });
        },
        onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }),
      },
    );

  return (
    <Card padding={4} testID="ride-share-riders">
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.space[2] }}>
          <Text variant="label" weight={700}>
            {t('partner.ic_share_title')}
          </Text>
          {arrived ? (
            <Text variant="caption" color={done === friends.length ? 'successText' : 'textMuted'} tabular testID="ride-share-count">
              {t('partner.ic_share_count', { done, all: friends.length })}
            </Text>
          ) : null}
        </View>
        <Row initial={t('partner.ic_share_booker').slice(0, 1)} title={t('partner.ic_share_booker')} body={t('partner.ic_share_booker_body', { amount: amountParam(collectIqd) })} />
        {friends.map((m) => {
          const name = m.firstName ?? t('partner.ic_share_friend');
          return (
            <Row
              key={m.id}
              testID={`ride-share-${m.id}`}
              initial={name.slice(0, 1)}
              title={m.places > 1 ? `${name} · ${m.places}` : name}
              body={t('partner.ic_share_friend_body', { amount: amountParam(m.amountIqd) })}
              end={
                m.boardedBy ? (
                  <StatusPill size="sm" tone="success" icon="check" label={t('rajaa.carshare_tag_in')} />
                ) : arrived ? (
                  <Button
                    testID={`ride-share-board-${m.id}`}
                    size="sm"
                    variant="secondary"
                    label={t('partner.ic_share_board_cta')}
                    loading={boardFor.isPending && boardFor.variables?.memberId === m.id}
                    onPress={() => confirm(m.id)}
                  />
                ) : null
              }
            />
          );
        })}
        {arrived && done < friends.length ? (
          <Text variant="caption" color="textMuted">
            {t('partner.ic_share_board_hint')}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

function Row({ initial, title, body, end, testID }: { initial: string; title: string; body: string; end?: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 48 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentTint }}>
        <Text variant="label" weight={700} color="accentText">
          {initial}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="footnote" weight={700}>
          {title}
        </Text>
        <Text variant="caption" color="textMuted" tabular>
          {body}
        </Text>
      </View>
      {end}
    </View>
  );
}
