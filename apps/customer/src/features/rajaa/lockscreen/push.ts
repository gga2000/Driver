import type { RajaaPassPush } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { passCardFromPush, passCardKey, passNotificationId } from './content';
import type { OngoingLabels, OngoingPassDevice } from './ongoing';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Applies one server pass push to the lock screen (customer d-8 follow-up): re-posts the card in place,
 * or removes it when the trip is gone. An older push than the last one applied for that booking is
 * dropped (pushes can arrive out of order). Returns the card's key (empty when removed) or null when
 * the push was stale. Plain function: the app's receive listener calls it, and so would a headless
 * notification task (`expo-task-manager`, not installed yet — see docs/api/rajaa-pass-push.md).
 */
export async function applyPassPush(
  push: RajaaPassPush,
  ctx: { t: T; amount: (iqd: number) => string; labels: OngoingLabels; device: Pick<OngoingPassDevice, 'show' | 'dismiss'>; now: Date; lastSentAt: Map<string, number> },
): Promise<string | null> {
  const last = ctx.lastSentAt.get(push.bookingId);
  if (last !== undefined && push.sentAt.getTime() < last) return null;
  ctx.lastSentAt.set(push.bookingId, push.sentAt.getTime());
  const card = passCardFromPush(push, ctx.t, ctx.amount, ctx.now);
  if (!card) {
    await ctx.device.dismiss(passNotificationId(push.bookingId));
    return '';
  }
  await ctx.device.show(card, ctx.labels);
  return passCardKey(card);
}
