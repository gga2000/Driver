import type { MenuPhotoRequestState, MenuPhotoRequestView } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import type { ChipTone } from '@/components/ui/badge';

/**
 * The Console's read of the menu photo service (maps k3): how each request's state shows as a chip,
 * and the one-line count under the store name. Kept pure for the tests.
 */

export const MENU_PHOTO_STATE_KEY: Record<MenuPhotoRequestState, MessageKey> = {
  requested: 'console.mp_state_requested',
  scheduled: 'console.mp_state_scheduled',
  shot: 'console.mp_state_shot',
  done: 'console.mp_state_done',
  cancelled: 'console.mp_state_cancelled',
};

/** Waiting for a person (nobody took it) is `ready`; being worked on is `live`; finished `done`. */
export function menuPhotoTone(state: MenuPhotoRequestState): ChipTone {
  switch (state) {
    case 'requested':
      return 'ready';
    case 'scheduled':
    case 'shot':
      return 'live';
    case 'done':
      return 'done';
    case 'cancelled':
      return 'neutral';
  }
}

/** Requests still waiting on field ops (no visit yet): the count on the card's title. */
export function untakenCount(list: readonly Pick<MenuPhotoRequestView, 'state'>[]): number {
  return list.filter((r) => r.state === 'requested').length;
}
