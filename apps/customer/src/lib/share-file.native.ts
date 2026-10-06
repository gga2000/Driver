/**
 * Sharing a picture on the phone (joy g7, l5): the platform share sheet (expo-sharing) with a local
 * file — WhatsApp sends a 512×512 WebP as a sticker. Same API as `share-file.ts` (the web one).
 */
import { Asset } from 'expo-asset';
import * as Sharing from 'expo-sharing';

export type ShareResult = 'shared' | 'saved' | 'cancelled' | 'failed';

/** Shares a local file (a captured share card). */
export async function shareLocalFile(uri: string, mimeType: string, title: string): Promise<ShareResult> {
  try {
    if (!(await Sharing.isAvailableAsync())) return 'failed';
    await Sharing.shareAsync(uri, { mimeType, dialogTitle: title, ...(mimeType === 'image/png' ? { UTI: 'public.png' } : {}) });
    return 'shared';
  } catch {
    return 'failed';
  }
}

/** The web's blob path has no phone equivalent: pictures are shared as files here. */
export async function shareBlob(_blob: Blob, _fileName: string, _title: string): Promise<ShareResult> {
  return 'failed';
}

/** Shares a bundled picture (a sticker): copied to the cache by expo-asset, then the share sheet. */
export async function shareAsset(moduleId: number, _fileName: string, mimeType: string, title: string): Promise<ShareResult> {
  try {
    const asset = Asset.fromModule(moduleId);
    await asset.downloadAsync();
    if (!asset.localUri) return 'failed';
    return await shareLocalFile(asset.localUri, mimeType, title);
  } catch {
    return 'failed';
  }
}
