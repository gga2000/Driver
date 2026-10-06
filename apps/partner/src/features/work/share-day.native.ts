/**
 * "شارك يومك" on the phone (audit S-4): the share card (a hidden `ShareDayCard` view, the same layout
 * the web draws on a canvas) captured as a PNG with react-native-view-shot, then the platform share
 * sheet (expo-sharing) — WhatsApp is the first row for most drivers. Both are native modules: a
 * development build is needed (Expo Go for SDK 52 can't load them; see docs/deploy/mobile.md).
 * Same API as share-day.ts.
 */
import type { RefObject } from 'react';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import type { ShareCardModel } from './shift-logic';

export type ShareResult = 'shared' | 'saved' | 'cancelled' | 'failed';

export async function shareDay(input: { model: ShareCardModel; fileName: string; brand: { name: string; badge: string }; view?: RefObject<unknown> }): Promise<ShareResult> {
  try {
    const target = input.view?.current;
    if (!target) return 'failed';
    const uri = await captureRef(target as Parameters<typeof captureRef>[0], { format: 'png', quality: 1, result: 'tmpfile', fileName: input.fileName.replace(/\.png$/, '') });
    if (!(await Sharing.isAvailableAsync())) return 'failed';
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: input.model.title });
    return 'shared';
  } catch {
    return 'failed';
  }
}
