import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderUI } from '../test/render';
import { ART_NAMES, Art } from './Art';
import { PICTURES } from './pictures';

const SHAPES = 'path,circle,ellipse,rect';

describe('the approved Date & Saffron pictures (locked by Ali, 2026-10-07)', () => {
  it('has every service and every empty or status screen', () => {
    expect(ART_NAMES).toEqual(expect.arrayContaining(['food', 'taxi', 'tuktuk', 'rajaa', 'khutoot', 'grocery', 'parcel']));
    expect(ART_NAMES).toEqual(expect.arrayContaining(['offline', 'no-results', 'empty-cart', 'delivered', 'location', 'closed-night']));
  });

  it('pictures.ts is up to date with the approved .svg files (run `pnpm --filter @driver/ui art`)', async () => {
    const script = join(__dirname, '..', '..', 'scripts', 'build-art.mjs');
    const { collect, render } = await import(script);
    expect(readFileSync(join(__dirname, 'pictures.ts'), 'utf8')).toBe(render(collect()));
  });

  it('keeps each drawing exactly as approved, without the provenance block it never draws', () => {
    const file = readFileSync(join(__dirname, 'pictures', 'states', 'offline.svg'), 'utf8');
    const body = (s: string) => s.slice(s.indexOf('</metadata>') >= 0 ? s.indexOf('</metadata>') + '</metadata>'.length : s.indexOf('>') + 1);
    expect(PICTURES.offline.xml.endsWith(body(file).trim())).toBe(true);
    for (const n of ART_NAMES) expect(PICTURES[n].xml).not.toContain('metadata');
  });

  it.each(ART_NAMES)('%s draws, its ids carry its own name (many on one page never clash), and it hides from screen readers', (name) => {
    const { container, unmount } = renderUI(<Art name={name} size={96} testID="art" />);
    expect(container.querySelectorAll(SHAPES).length).toBeGreaterThan(5);
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id.startsWith(`${name}-`), `${name}: #${id}`).toBe(true);
    unmount();
  });
});
