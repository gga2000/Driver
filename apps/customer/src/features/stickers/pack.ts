import type { MessageKey } from '@driver/i18n';

/**
 * The exported pack (joy g7): `scripts/stickers-export.mjs` writes `assets/stickers/<id>.webp` from the
 * sketchbook manifest (`STICKERS` in `@driver/ui`); `files.ts` names each file for Metro. A sticker
 * shows only when its file is bundled.
 */
export interface PackSticker {
  id: string;
  source: number;
  line: MessageKey;
  fileName: string;
}

export function packStickers(specs: ReadonlyArray<{ id: string }>, files: Readonly<Record<string, number>>): PackSticker[] {
  return specs.flatMap((s) => {
    const source = files[s.id];
    return source === undefined ? [] : [{ id: s.id, source, line: `sticker.line.${s.id}` as MessageKey, fileName: `driver-${s.id}.webp` }];
  });
}
