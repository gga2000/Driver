import { describe, expect, it } from 'vitest';
import { hasKey } from '@driver/i18n';
import { DISH_KINDS } from './dishes';
import { SCENE_NAMES } from './scenes';
import { STICKER_PACK, STICKERS } from './stickers';

describe('ستيكرات درايفر (joy g7)', () => {
  it('a pack WhatsApp accepts: 3–30 stickers, unique file-safe ids', () => {
    expect(STICKERS.length).toBeGreaterThanOrEqual(STICKER_PACK.minStickers);
    expect(STICKERS.length).toBeLessThanOrEqual(STICKER_PACK.maxStickers);
    const ids = STICKERS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z_]+$/);
  });

  it('each sticker has 1–3 emojis for WhatsApp search and a line in the locale', () => {
    for (const s of STICKERS) {
      expect(s.emojis.length, s.id).toBeGreaterThanOrEqual(1);
      expect(s.emojis.length, s.id).toBeLessThanOrEqual(3);
      expect(hasKey(`sticker.line.${s.id}`), s.id).toBe(true);
    }
  });

  it('every drawing comes from the sketchbook set', () => {
    for (const s of STICKERS) {
      if ('dish' in s.art) expect(DISH_KINDS).toContain(s.art.dish);
      else expect(SCENE_NAMES).toContain(s.art.scene);
    }
  });
});
