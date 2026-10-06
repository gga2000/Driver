/**
 * The share card on the phone (joy l5): the card view captured as a 1080×1920 PNG with
 * react-native-view-shot, then the platform share sheet (expo-sharing) — WhatsApp status and
 * Instagram story are in it. Same API as `render.ts` (the web canvas).
 */
import type { RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { shareLocalFile, type ShareResult } from '@/lib/share-file';
import { CARD } from './layout';

export interface CardText {
  head: string;
  sub: string | null;
  brand: string;
  accent: string;
  art: 'dish' | 'scene';
}

export async function shareCard(input: { text: CardText; fileName: string; title: string; view: RefObject<View | null> }): Promise<ShareResult> {
  try {
    const target = input.view.current;
    if (!target) return 'failed';
    const uri = await captureRef(target, { format: 'png', quality: 1, result: 'tmpfile', width: CARD.w * CARD.scale, height: CARD.h * CARD.scale, fileName: input.fileName.replace(/\.png$/, '') });
    return await shareLocalFile(uri, 'image/png', input.title);
  } catch {
    return 'failed';
  }
}
