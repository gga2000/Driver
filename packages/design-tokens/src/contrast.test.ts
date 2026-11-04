import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.js';
import { contrastPairs, customerThemes, homeLook, liveStages, minFontSize, nonTextPairs, services, themes, type, type ThemeName } from './tokens.js';

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // #767676 on white is the classic 4.54:1 boundary grey.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });
});

describe.each(Object.keys(themes) as ThemeName[])('%s theme: WCAG AA for every text/background pair', (name) => {
  const theme = themes[name];
  it.each(contrastPairs.map((p) => [p.fg, p.bg, p] as const))('%s on %s', (_fg, _bg, pair) => {
    const ratio = contrastRatio(theme[pair.fg], theme[pair.bg]);
    const min = pair.large ? 3 : 4.5;
    if (ratio < min) {
      throw new Error(
        `${name}: ${pair.fg} ${theme[pair.fg]} on ${pair.bg} ${theme[pair.bg]} is ${ratio.toFixed(2)}:1 (< ${min}:1) — used for ${pair.use}`,
      );
    }
    expect(ratio).toBeGreaterThanOrEqual(min);
  });
});

describe.each(Object.keys(themes) as ThemeName[])('%s theme: 3:1 for every boundary, focus and selected-state cue (WCAG 1.4.11)', (name) => {
  const theme = themes[name];
  it.each(nonTextPairs.filter((p) => !p.only || p.only.includes(name)).map((p) => [p.fg, p.bg, p] as const))('%s against %s', (_fg, _bg, pair) => {
    const ratio = contrastRatio(theme[pair.fg], theme[pair.bg]);
    if (ratio < 3) {
      throw new Error(`${name}: ${pair.fg} ${theme[pair.fg]} against ${pair.bg} ${theme[pair.bg]} is ${ratio.toFixed(2)}:1 (< 3:1) — used for ${pair.use}`);
    }
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});

describe.each(Object.keys(services) as ThemeName[])('%s theme: the home service tiles read (Date & Saffron)', (name) => {
  const p = services[name];
  const fills = (k: keyof typeof p): string[] => {
    const s = p[k];
    return [s.fill, ...('light' in s ? [s.light] : []), ...('mesh' in s ? s.mesh : [])];
  };
  it.each(Object.keys(p) as (keyof typeof p)[])('%s: its title and live fact pass AA on every stop of the fill', (k) => {
    for (const ink of [p[k].on, p[k].sub].filter((x): x is string => !!x)) {
      for (const fill of fills(k)) {
        const ratio = contrastRatio(ink, fill);
        if (ratio < 4.5) throw new Error(`${name}: ${k} ${ink} on ${fill} is ${ratio.toFixed(2)}:1 (< 4.5:1)`);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it.each(Object.keys(p) as (keyof typeof p)[])('%s card: AA name and fact, 3:1 dot, on its wash', (k) => {
    const card = p[k].card;
    for (const bg of [card.bg, ...(card.top ? [card.top] : [])]) {
      for (const [ink, min, what] of [[card.on, 4.5, 'name'], [card.sub, 4.5, 'fact'], [card.dot, 3, 'dot']] as const) {
        const ratio = contrastRatio(ink, bg);
        if (ratio < min) throw new Error(`${name}: ${k} card ${what} ${ink} on ${bg} is ${ratio.toFixed(2)}:1 (< ${min}:1)`);
        expect(ratio).toBeGreaterThanOrEqual(min);
      }
    }
  });
  it('no two service cards share a wash', () => {
    const all = [p.food.card.bg, p.taxi.card.bg, p.tuktuk.card.bg, p.trips.card.bg, p.back.card.bg, p.parcel.card.bg, p.carts.card.bg];
    expect(new Set(all).size).toBe(all.length);
  });
  it('the tuktuk is not the error red, and no two services share a fill', () => {
    expect(p.tuktuk.fill).not.toBe(themes[name].danger);
    expect(p.parcel.fill).not.toBe(themes[name].danger);
    const all = [p.food.fill, p.taxi.fill, p.tuktuk.fill, p.trips.fill, p.back.fill, p.parcel.fill, p.carts.fill];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe.each(Object.keys(liveStages) as ThemeName[])('%s theme: every stage of the live-order card reads', (name) => {
  const p = liveStages[name];
  const ratio = (fg: string, bg: string, min: number, what: string) => {
    const r = contrastRatio(fg, bg);
    if (r < min) throw new Error(`${name}: ${what} ${fg} on ${bg} is ${r.toFixed(2)}:1 (< ${min}:1)`);
    expect(r).toBeGreaterThanOrEqual(min);
  };
  it.each(Object.keys(p) as (keyof typeof p)[])('%s: AA text, 3:1 bar and mark, on both stops of the card', (k) => {
    const s = p[k];
    for (const bg of [s.fill, s.light]) {
      ratio(s.on, bg, 4.5, `${k} title`);
      ratio(s.sub, bg, 4.5, `${k} name and time words`);
      ratio(s.accent, bg, 3, `${k} bar`);
      ratio(s.marker, bg, 3, `${k} mark`);
    }
    ratio(s.markerOn, s.marker, 3, `${k} mark icon`);
  });
  it('no two stages share a colour', () => {
    const all = Object.values(p).map((s) => s.fill);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('warning is not the brand (joy S2-02)', () => {
  it('the warning tint and the accent tint are different colours, and the late banner is ink, not a tint', () => {
    expect(themes.light.warningTint).not.toBe(themes.light.accentTint);
    expect(themes.light.warning).not.toBe(themes.light.accent);
    expect(themes.light.inverse).toBe(themes.light.text);
    expect(contrastRatio(themes.light.onInverseCaution, themes.light.inverse)).toBeGreaterThan(7);
  });
});

describe('controls stay visible (W12: REL-18, VIS-04)', () => {
  it('a switched-off toggle track and every code cell edge are 3:1 on the page and on a card, in both themes', () => {
    for (const [name, t] of Object.entries(themes)) {
      expect(contrastRatio(t.borderStrong, t.bg), `${name} borderStrong/bg`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(t.borderStrong, t.surface), `${name} borderStrong/surface`).toBeGreaterThanOrEqual(3);
    }
  });
  it('the focus ring is 3:1 on a card in both themes', () => {
    for (const [name, t] of Object.entries(themes)) expect(contrastRatio(t.focusRing, t.surface), name).toBeGreaterThanOrEqual(3);
  });
});

describe('type floor', () => {
  it('no text style is under 12 px (audit S-10)', () => {
    for (const [k, v] of Object.entries(type)) expect(v.size, k).toBeGreaterThanOrEqual(minFontSize);
  });
});

describe('brand rules', () => {
  it('never puts white text on the brand orange (2.68:1 fails even large text)', () => {
    expect(contrastRatio('#FFFFFF', themes.light.accent)).toBeLessThan(3);
    expect(themes.light.onAccent).toBe('#1F1A14');
  });
  it('field borders at rest are neutral 500 (audit S-04): 3.63:1 on cream, 3.90:1 on white', () => {
    expect(themes.light.borderStrong).toBe('#8C7F6F');
    expect(contrastRatio(themes.light.borderStrong, themes.light.bg)).toBeGreaterThan(3.6);
  });
  it('keeps the brand spec hexes for the light theme', () => {
    const l = themes.light;
    expect([l.bg, l.surface, l.text, l.textMuted, l.accent, l.accentTint, l.border]).toEqual([
      '#FBF6EE', '#FFFFFF', '#1F1A14', '#6B6157', '#E08A1E', '#FCEBD3', '#EADFCF',
    ]);
    // Warning moved off the brand hue to mustard (joy S2-02, 2026-10-06).
    expect([l.success, l.warning, l.danger, l.info]).toEqual(['#2F8F5B', '#B07F00', '#C2412D', '#2F6FB0']);
  });
  it('both themes define the same keys', () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });
});

/**
 * The customer home redesign's colour rules (docs/specs/2026-11-01-home-redesign.md §4, Ali
 * 2026-11-01). Each rule is its own case so a broken one names itself.
 */
describe('home redesign colours (sage and emerald night)', () => {
  const ORANGE = '#FF7A1F';
  const ON_ORANGE = '#160D05';
  const sage = themes.sage;
  const night = themes.emeraldNight;
  /** A colour is "light" when dark ink reads better on it than white does. */
  const isLight = (hex: string) => contrastRatio('#000000', hex) > contrastRatio('#FFFFFF', hex);
  /** The solid colour an `alpha` overlay of `fg` makes on `bg`. */
  const blend = (fg: string, bg: string, alpha: number) =>
    '#' + [1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * alpha + parseInt(bg.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('').toUpperCase();

  it('keeps the approved hexes of §4', () => {
    expect([sage.bg, sage.surface, sage.border, sage.text, sage.textMuted, sage.accent, sage.onAccent]).toEqual([
      '#E4EAE1', '#F1F4EF', '#E0E7DC', '#1A231C', '#4E5A50', ORANGE, ON_ORANGE,
    ]);
    expect(homeLook.sage.panel).toMatchObject({ fill: '#1F3A2B', raised: '#274836', on: '#F1F4EF', onSoft: '#E8EFE5', muted: '#BDCABE' });
    expect(homeLook.sage.river).toMatchObject({ line: '#9DB08A', inner: '#AAC096' });
    expect(homeLook.sage.map).toEqual({ land: '#EAE5D9', blocks: '#DED6C5', palms: ['#99A878', '#758655'], streets: '#FFFFFF', river: '#9DB08A' });
    const s = services.sage;
    expect([s.food.fill, s.taxi.fill, s.tuktuk.fill, s.parcel.fill, s.carts.fill]).toEqual([ORANGE, '#E3B23C', '#A9C25B', '#D2A46B', '#E07A8E']);
    expect(homeLook.sage.symbolOutline).toBe('#1A231C');

    expect([night.bg, night.surface, night.surfaceRaised, night.border, night.text, night.textMuted, night.accent, night.onAccent]).toEqual([
      '#09110D', '#0F1D16', '#15261D', '#1F372A', '#F2FFF6', '#9FB8A8', ORANGE, ON_ORANGE,
    ]);
    expect([night.live, night.liveText, night.infoText]).toEqual(['#00E575', '#6CFFAE', '#6CFFAE']);
    expect(homeLook.emeraldNight.map).toMatchObject({ land: '#0A160F', blocks: '#12241A', streets: '#1F3527', river: '#00E575' });
    expect(homeLook.emeraldNight.accentGlow).toBe('0 0 20px rgba(255, 122, 31, 0.35)');
    const n = services.emeraldNight;
    expect([n.food.fill, n.taxi.fill, n.tuktuk.fill, n.parcel.fill, n.carts.fill]).toEqual(['#C82828', '#FFE14D', '#00E575', '#FFB35C', '#FF5FB8']);
  });

  it('the same orange in both themes, with #160D05 text on it (7.4:1)', () => {
    for (const name of customerThemes) {
      expect(themes[name].accent, name).toBe(ORANGE);
      expect(themes[name].onAccent, name).toBe(ON_ORANGE);
      expect(contrastRatio(ON_ORANGE, ORANGE)).toBeGreaterThanOrEqual(7);
    }
  });

  it('orange is never text on a light page or card (2.1:1 on the page, 2.35:1 on a card)', () => {
    expect(contrastRatio(ORANGE, sage.bg)).toBeLessThan(3);
    expect(contrastRatio(ORANGE, sage.surface)).toBeLessThan(3);
    // No text role in either theme puts the orange on a light background.
    for (const name of customerThemes) {
      const t = themes[name];
      for (const p of contrastPairs) {
        if (isLight(t[p.bg])) expect(t[p.fg], `${name}: ${p.fg} on ${p.bg} (${p.use})`).not.toBe(ORANGE);
      }
    }
    // Sage's accent-, link- and live-coloured text is forest, never orange.
    expect([sage.accentText, sage.liveText, sage.infoText]).toEqual(['#1F3A2B', '#1F3A2B', '#1F3A2B']);
    // The service cards' words are never orange either.
    for (const sw of Object.values(services.sage)) for (const ink of [sw.card.on, sw.card.sub]) expect(ink).not.toBe(ORANGE);
  });

  it('in sage, orange text lives on the forest panel (4.7:1)', () => {
    const panel = homeLook.sage.panel;
    expect(panel.accent).toBe(ORANGE);
    expect(contrastRatio(ORANGE, panel.fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(sage.onInverseAccent, sage.inverse)).toBeGreaterThanOrEqual(4.5);
    // The raised box inside the panel is only 3.9:1: orange there is a mark or big type, never body text.
    expect(contrastRatio(ORANGE, panel.raised)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(ORANGE, panel.raised)).toBeLessThan(4.5);
  });

  it('never white text on orange (2.6:1)', () => {
    expect(contrastRatio('#FFFFFF', ORANGE)).toBeLessThan(3);
    for (const name of customerThemes) {
      const t = themes[name];
      for (const p of contrastPairs) if (t[p.bg] === ORANGE) expect(t[p.fg], `${name}: ${p.fg} on ${p.bg}`).toBe(ON_ORANGE);
      for (const sw of Object.values(services[name])) if (sw.fill === ORANGE) expect(sw.on, name).toBe(ON_ORANGE);
      for (const st of Object.values(liveStages[name])) if (st.fill === ORANGE) expect(st.on, name).toBe(ON_ORANGE);
    }
  });

  it('the upcoming step «وصل» on the forest panel: #75897A fails (3.3:1), #93A596 passes (4.75:1)', () => {
    const panel = homeLook.sage.panel;
    expect(contrastRatio('#75897A', panel.fill)).toBeLessThan(4.5);
    expect(panel.upcoming).toBe('#93A596');
    expect(contrastRatio(panel.upcoming, panel.fill)).toBeGreaterThanOrEqual(4.5);
    // Every word on either panel reads.
    for (const name of customerThemes) {
      const p = homeLook[name].panel;
      for (const ink of [p.on, p.onSoft, p.muted, p.upcoming, p.accent]) {
        expect(contrastRatio(ink, p.fill), `${name} ${ink} on ${p.fill}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('the dark search placeholder is the full #9FB8A8, not 60 % of it (3.5:1)', () => {
    const ph = homeLook.emeraldNight.searchPlaceholder;
    expect(ph).toBe('#9FB8A8');
    expect(ph).toMatch(/^#[0-9A-F]{6}$/);
    for (const bg of [night.bg, night.surface, night.surfaceRaised, night.surfaceSunken]) expect(contrastRatio(ph, bg), bg).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(blend(ph, night.surface, 0.6), night.surface)).toBeLessThan(4.5);
    for (const bg of [sage.bg, sage.surface, sage.surfaceSunken]) expect(contrastRatio(homeLook.sage.searchPlaceholder, bg), bg).toBeGreaterThanOrEqual(4.5);
  });

  it('stars on light cards are not plain orange: the orange star has an ink outline (2.35:1 alone)', () => {
    expect(contrastRatio(sage.star, sage.surface)).toBeLessThan(3);
    expect(sage.starOutline).toBe(sage.text);
    expect(contrastRatio(sage.starOutline, sage.surface)).toBeGreaterThanOrEqual(3);
  });

  it('emerald is never body text at night; light emerald carries prices and minutes (13.7:1)', () => {
    for (const p of contrastPairs) expect(night[p.fg], `${p.fg} (${p.use})`).not.toBe('#00E575');
    expect(contrastRatio('#6CFFAE', night.surface)).toBeGreaterThanOrEqual(13);
    expect(homeLook.emeraldNight.info).toBe('#6CFFAE');
  });

  it('dark muted text is 8.2:1 on cards; sage ink 13.2:1 and muted 5.9:1 on the page; muted on forest 7.3:1', () => {
    expect(contrastRatio(night.textMuted, night.surface)).toBeGreaterThanOrEqual(8);
    expect(contrastRatio(sage.text, sage.bg)).toBeGreaterThanOrEqual(13);
    expect(contrastRatio(sage.textMuted, sage.bg)).toBeGreaterThanOrEqual(5.9);
    expect(contrastRatio(homeLook.sage.panel.muted, homeLook.sage.panel.fill)).toBeGreaterThanOrEqual(7.2);
  });

  it('round 3 (2026-11-02): panel numbers and money, and board tiles, all read at AA in both themes', () => {
    for (const name of customerThemes) {
      const p = homeLook[name].panel;
      const b = homeLook[name].board;
      const th = themes[name];
      for (const bg of [p.fill, p.raised]) {
        expect(contrastRatio(p.fact, bg), `${name} fact on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.cash, bg), `${name} cash on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.on, bg), `${name} on on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.muted, bg), `${name} muted on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const fg of [b.fact, th.text, th.textMuted]) expect(contrastRatio(fg, b.tile), `${name} ${fg} on tile`).toBeGreaterThanOrEqual(4.5);
      // The food tile: dark ink on the orange.
      expect(contrastRatio(ON_ORANGE, ORANGE)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('live marks read where they are drawn: orange on the forest, emerald on the night page (3:1)', () => {
    expect(contrastRatio(homeLook.sage.live, homeLook.sage.panel.fill)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(homeLook.emeraldNight.live, night.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(homeLook.emeraldNight.live, night.surface)).toBeGreaterThanOrEqual(3);
  });

  it('audit round 2 (2026-11-04): cards stand off the page by fill, and every word and price on them reads', () => {
    for (const name of customerThemes) {
      const look = homeLook[name];
      const th = themes[name];
      expect(look.card.fill, name).not.toBe(th.bg);
      expect(look.board.tile, `${name}: tiles are cards`).toBe(look.card.fill);
      for (const fg of [th.text, th.textMuted, th.accentText, look.price]) {
        expect(contrastRatio(fg, look.card.fill), `${name} ${fg} on card`).toBeGreaterThanOrEqual(4.5);
      }
      // Never neon green for prices (it stays for live things).
      expect(look.price, name).not.toBe(look.live);
    }
    // Sage cards lift by a shadow; night cards are a step lighter than the page.
    expect(homeLook.sage.card.shadow).toBeTruthy();
    expect(contrastRatio(homeLook.emeraldNight.card.fill, night.bg)).toBeGreaterThan(1.05);
  });

  it('audit round 4 (2026-11-04): the late band reads, and small live marks reach 3:1 on their tiles', () => {
    for (const name of customerThemes) {
      const look = homeLook[name];
      expect(contrastRatio(look.late.on, look.late.fill), `${name} late band`).toBeGreaterThanOrEqual(7);
      expect(look.late.fill, `${name}: late is not the action orange`).not.toBe(ORANGE);
      expect(contrastRatio(look.board.dot, look.board.tile), `${name} live dot on tile`).toBeGreaterThanOrEqual(3);
    }
  });
});
