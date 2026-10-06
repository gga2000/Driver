import { Share } from 'react-native';
import type { DayShareInput, DayShareResult } from './share-types';

/**
 * Native: the share sheet with the day's text (WhatsApp is one tap from it). The web build draws the
 * card as an image instead (`share.web.ts`).
 */
export async function shareDay(input: DayShareInput): Promise<DayShareResult> {
  const r = await Share.share({ message: input.text });
  return r.action === Share.dismissedAction ? 'cancelled' : 'shared';
}
