import type { DishKind } from './dishes';
import type { SceneName, SceneVehicle } from './scenes';

/**
 * «ستيكرات درايفر» (joy g7): a small WhatsApp sticker pack drawn from the Aziziyah sketchbook (J4)
 * with Iraqi lines. Each sticker is one drawing (a dish, or an arch scene) and one line in Marhey;
 * `apps/customer/scripts/stickers-export.mjs` renders them to 512×512 WebP from the gallery's
 * `#stickers` page. `emojis` are WhatsApp's own pack metadata (1–3 per sticker, used by its search);
 * they never appear in the app's copy. The line text lives in the locale (`sticker.line.<id>`).
 */
export type StickerArt = { dish: DishKind } | { scene: SceneName; vehicle?: SceneVehicle };

export interface StickerSpec {
  /** File name and locale suffix: `<id>.webp`, `sticker.line.<id>`. */
  id: string;
  art: StickerArt;
  emojis: readonly string[];
}

export const STICKERS: readonly StickerSpec[] = [
  { id: 'bil_afia', art: { dish: 'tray' }, emojis: ['😋', '🍽️'] },
  { id: 'wasal_akil', art: { scene: 'door' }, emojis: ['🚪', '🛵'] },
  { id: 'yumma', art: { dish: 'dolma' }, emojis: ['😍', '❤️'] },
  { id: 'jay', art: { scene: 'safe_arrival', vehicle: 'tuktuk' }, emojis: ['🛺', '⏳'] },
  { id: 'wasalt', art: { scene: 'safe_arrival', vehicle: 'minibus' }, emojis: ['🏠', '🙏'] },
  { id: 'ala_hsabi', art: { dish: 'kebab' }, emojis: ['🤝', '🎁'] },
  { id: 'chai', art: { dish: 'tea' }, emojis: ['☕', '🫖'] },
  { id: 'sahha', art: { dish: 'rice' }, emojis: ['💪', '🍚'] },
];

/** WhatsApp's pack metadata (the sticker-pack `contents.json` its sample apps and providers read). */
export const STICKER_PACK = {
  identifier: 'driver_aziziyah_1',
  /** Shown by WhatsApp in the pack list: the brand, not app copy. */
  name: 'درايفر · العزيزية',
  publisher: 'درايفر',
  trayFile: 'tray.png',
  imageDataVersion: '1',
  /** WhatsApp's limits: 512×512 WebP under 100 KB, a 96×96 PNG tray under 50 KB, 3–30 stickers. */
  size: 512,
  traySize: 96,
  maxStickerBytes: 100 * 1024,
  maxTrayBytes: 50 * 1024,
  minStickers: 3,
  maxStickers: 30,
} as const;
