/**
 * Sharing a picture on the web (joy g7 stickers, l5 share card): the browser's share sheet with the
 * file when it can share files (Android Chrome: WhatsApp is right there), else the file is downloaded
 * to send by hand. Native: `share-file.native.ts` (the platform share sheet through expo-sharing).
 * The same pattern as the partner app's «شارك يومك».
 */
import { Asset } from 'expo-asset';

export type ShareResult = 'shared' | 'saved' | 'cancelled' | 'failed';

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Shares (or downloads) a picture the page already holds. */
export async function shareBlob(blob: Blob, fileName: string, title: string): Promise<ShareResult> {
  if (typeof document === 'undefined') return 'failed';
  const file = typeof File !== 'undefined' ? new File([blob], fileName, { type: blob.type }) : null;
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { canShare?: (d: ShareData) => boolean }) : null;
  if (file && nav?.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return 'cancelled';
    }
  }
  download(blob, fileName);
  return 'saved';
}

/** Shares a bundled picture (a sticker): fetched from the app's own assets, then `shareBlob`. */
export async function shareAsset(moduleId: number, fileName: string, mimeType: string, title: string): Promise<ShareResult> {
  try {
    const asset = Asset.fromModule(moduleId);
    const res = await fetch(asset.uri);
    if (!res.ok) return 'failed';
    const blob = new Blob([await res.blob()], { type: mimeType });
    return await shareBlob(blob, fileName, title);
  } catch {
    return 'failed';
  }
}
