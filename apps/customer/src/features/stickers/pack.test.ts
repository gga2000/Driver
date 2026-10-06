import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { packStickers } from './pack';

const assets = fileURLToPath(new URL('../../../assets/stickers/', import.meta.url));
const filesTs = readFileSync(fileURLToPath(new URL('./files.ts', import.meta.url)), 'utf8');
const contents = JSON.parse(readFileSync(`${assets}contents.json`, 'utf8')) as {
  sticker_packs: Array<{ identifier: string; tray_image_file: string; stickers: Array<{ image_file: string; emojis: string[] }> }>;
};

describe('the bundled sticker pack (joy g7)', () => {
  const pack = contents.sticker_packs[0]!;

  it('every sticker in contents.json is exported, a WebP under WhatsApp’s 100 KB, with 1–3 emojis', () => {
    expect(pack.stickers.length).toBeGreaterThanOrEqual(3);
    for (const s of pack.stickers) {
      const file = `${assets}${s.image_file}`;
      expect(existsSync(file), s.image_file).toBe(true);
      expect(readFileSync(file).subarray(8, 12).toString('ascii'), s.image_file).toBe('WEBP');
      expect(statSync(file).size).toBeLessThan(100 * 1024);
      expect(s.emojis.length).toBeGreaterThanOrEqual(1);
      expect(s.emojis.length).toBeLessThanOrEqual(3);
    }
    expect(statSync(`${assets}${pack.tray_image_file}`).size).toBeLessThan(50 * 1024);
  });

  it('the app bundles each one', () => {
    for (const s of pack.stickers) expect(filesTs).toContain(`assets/stickers/${s.image_file}`);
  });

  it('only stickers whose file is bundled are shown, each with its line key', () => {
    const list = packStickers([{ id: 'bil_afia' }, { id: 'missing' }], { bil_afia: 7 });
    expect(list).toEqual([{ id: 'bil_afia', source: 7, line: 'sticker.line.bil_afia', fileName: 'driver-bil_afia.webp' }]);
  });
});
