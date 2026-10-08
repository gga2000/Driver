import { existsSync, readFileSync } from 'node:fs';
import { themes } from '@driver/design-tokens';
import { describe, expect, it } from 'vitest';

// The installable web app (public/index.html, public/manifest.webmanifest, app.json `web`) cannot import
// tokens, so its colours are copied: this keeps them on the cream `bg` of the light theme.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('web app shell', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  const web = JSON.parse(read('app.json')).expo.web;

  it('uses the theme background for the browser bar and start screen', () => {
    expect(web.themeColor).toBe(themes.light.bg);
    expect(web.backgroundColor).toBe(themes.light.bg);
    expect(manifest.theme_color).toBe(themes.light.bg);
    expect(manifest.background_color).toBe(themes.light.bg);
  });

  it('is Arabic, right to left, and opens like an app', () => {
    expect(web.lang).toBe('ar');
    expect(manifest).toMatchObject({ lang: 'ar', dir: 'rtl', display: 'standalone', start_url: '/' });
    const html = read('public/index.html');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('href="/manifest.webmanifest"');
  });

  it('paints the brand on cream before the app has downloaded', () => {
    const html = read('public/index.html');
    expect(html).toContain(`background-color: ${themes.light.bg.toLowerCase()}`);
    const firstPaint = html.slice(html.indexOf('<div id="root">'));
    expect(firstPaint).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]{100,}" alt="درايفر"/);
    expect(firstPaint).toContain('لحظة…');
    expect(firstPaint).toContain(`color: ${themes.light.textMuted.toLowerCase()}`);
  });

  it('ships every icon it names', () => {
    const html = read('public/index.html');
    const linked = [...html.matchAll(/href="(\/icons\/[^"]+)"/g)].map((m) => m[1]);
    for (const src of [...manifest.icons.map((i: { src: string }) => i.src), ...linked]) {
      expect(existsSync(new URL(`../../public${src}`, import.meta.url)), src).toBe(true);
    }
  });
});
