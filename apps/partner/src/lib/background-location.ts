import type { BackgroundState } from '@/features/work/background-plan';

/**
 * Web build: browsers can't report a position with the tab closed, so there is no background task.
 * Native: `background-location.native.ts`.
 */

export interface BackgroundCopy {
  notificationTitle: string;
  notificationBody: string;
  disclosureTitle: string;
  disclosureBody: string;
  disclosureAllow: string;
  disclosureLater: string;
}

export async function syncBackgroundLocation(_next: BackgroundState, _copy?: BackgroundCopy): Promise<boolean> {
  return false;
}
