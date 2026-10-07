import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.js';
import { color, decor, fontFamily, haptic, identity, motion, scheme, services, space, themes, tokens, type ThemeName } from './tokens.js';

describe('design tokens', () => {
  it('spacing is a scale of 4', () => {
    for (const v of Object.values(space)) expect(v % 4).toBe(0);
  });
  it('colors are 6-digit hex', () => {
    const walk = (o: Record<string, unknown>) => {
      for (const v of Object.values(o)) {
        if (typeof v === 'string') expect(v).toMatch(/^#[0-9A-F]{6}$/);
        else walk(v as Record<string, unknown>);
      }
    };
    walk(color);
  });
  it('the photo viewer backdrop is solid near-black in every theme, never the see-through scrim', () => {
    for (const t of Object.values(themes)) {
      expect(t.photoBackdrop).toBe(themes.light.photoBackdrop);
      expect(contrastRatio(t.photoBackdrop, '#000000')).toBeLessThan(1.2);
      expect(contrastRatio(t.onPhotoBackdrop, t.photoBackdrop)).toBeGreaterThan(7);
    }
  });
  it('theme roles are hex, except the translucent scrim', () => {
    for (const t of Object.values(themes)) {
      for (const [k, v] of Object.entries(t)) {
        if (k === 'scrim') expect(v).toMatch(/^rgba\(/);
        else expect(v).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });
  it('light theme is the brand palette and onAccent is ink', () => {
    expect(themes.light.bg).toBe('#FBF6EE');
    expect(themes.light.accent).toBe(color.primary[500]);
    expect(themes.light.onAccent).toBe(color.neutral[900]);
  });
  it('font stacks start with an Arabic face', () => {
    expect(fontFamily.sans[0]).toBe('IBM Plex Sans Arabic');
    // Alexandria (joy J-D2) is an Arabic display face; Marhey the hand-lettered voice.
    expect(fontFamily.display[0]).toBe('Alexandria');
    expect(fontFamily.voice[0]).toBe('Marhey');
  });
  it('is JSON-serialisable', () => {
    expect(JSON.parse(JSON.stringify(tokens))).toEqual(tokens);
  });
});

/** Every role as it was before J3a (J1 values): the Partner, Merchant and Console must not change. */
const J1_LIGHT = {
  bg: '#FBF6EE', surface: '#FFFFFF', surfaceRaised: '#FFFFFF', surfaceSunken: '#F3EBDD', text: '#1F1A14', textMuted: '#6B6157',
  accent: '#E08A1E', onAccent: '#1F1A14', accentTint: '#FCEBD3', accentText: '#9A5200', border: '#EADFCF', borderStrong: '#8C7F6F',
  accentBorder: '#C27214', focusRing: '#1F1A14', success: '#2F8F5B', successTint: '#E3F2E8', successText: '#23744A', warning: '#B07F00',
  warningTint: '#FAF0C8', warningText: '#7A5A00', danger: '#C2412D', onDanger: '#FFFFFF', dangerTint: '#F9E3DE', dangerText: '#A8361F',
  info: '#2F6FB0', infoTint: '#E1ECF7', infoText: '#245C96', inverse: '#1F1A14', onInverse: '#FBF6EE', onInverseMuted: '#D6C8B4',
  onInverseCaution: '#F2C14E', onInverseSuccess: '#7ACF9D', seatTaken: '#E8DFD0', scrim: 'rgba(31, 26, 20, 0.45)', shimmer: '#FBF6EE', shadow: '#5A3A12',
};
const J1_DARK = {
  bg: '#16120E', surface: '#201A15', surfaceRaised: '#2A231C', surfaceSunken: '#120E0B', text: '#F6EFE4', textMuted: '#B8AA98',
  accent: '#EE9A32', onAccent: '#1F1A14', accentTint: '#3B2914', accentText: '#F5B45E', border: '#3A3027', borderStrong: '#8C7F6F',
  accentBorder: '#F5B45E', focusRing: '#F6EFE4', success: '#4DB27A', successTint: '#183224', successText: '#7ACF9D', warning: '#E5B53A',
  warningTint: '#3A3010', warningText: '#F2CF68', danger: '#E06A54', onDanger: '#1F1A14', dangerTint: '#3D1D16', dangerText: '#F2937F',
  info: '#5C9BD8', infoTint: '#152A40', infoText: '#8EBDEA', inverse: '#F6EFE4', onInverse: '#1F1A14', onInverseMuted: '#4A4239',
  onInverseCaution: '#8A5300', onInverseSuccess: '#23744A', seatTaken: '#3A3229', scrim: 'rgba(0, 0, 0, 0.6)', shimmer: '#2A231C', shadow: '#000000',
};

describe('the other apps look the same (light and dark keep their J1 values)', () => {
  it('every role that existed before J3a is unchanged', () => {
    expect(themes.light).toMatchObject(J1_LIGHT);
    expect(themes.dark).toMatchObject(J1_DARK);
  });
  it('new roles in light and dark reproduce what the shared components drew before', () => {
    for (const t of [themes.light, themes.dark]) {
      expect([t.selected, t.onSelected, t.selectedBorder]).toEqual([t.accent, t.onAccent, t.accentBorder]);
      expect([t.selectedSoft, t.onSelectedSoft, t.selectedMark, t.onSelectedMark]).toEqual([t.accentTint, t.text, t.accent, t.onAccent]);
      expect([t.segmentSelected, t.segmentSelectedBorder, t.onSegmentSelected]).toEqual([t.surface, t.accentText, t.text]);
      expect([t.stepperPlus, t.onStepperPlus, t.stepperPlusBorder]).toEqual([t.accent, t.onAccent, t.accent]);
      expect([t.star, t.starOutline, t.tintBorder]).toEqual([t.accent, t.accent, t.accent]);
      expect([t.tabSelected, t.onTabSelected]).toEqual([t.accentTint, t.accentText]);
    }
  });
  it('avatars in light keep the four semantic tones, in the old hash order', () => {
    const l = themes.light;
    expect(identity.light).toEqual([
      { fill: l.accentTint, on: l.accentText },
      { fill: l.infoTint, on: l.infoText },
      { fill: l.successTint, on: l.successText },
      { fill: l.warningTint, on: l.warningText },
    ]);
  });
  it('the Console and the Partner share card fall back to Plex where Alexandria is not loaded', () => {
    expect(fontFamily.display[1]).toBe('IBM Plex Sans Arabic');
  });
});

describe('istikan theme (joy J-D1; Date & Saffron, Ali 2026-10-06)', () => {
  const i = themes.istikan;
  it('ivory paper, white cards, ink and lines', () => {
    expect([i.bg, i.surface, i.surfaceSunken, i.text, i.textMuted, i.border, i.borderStrong]).toEqual([
      '#FFF8EF', '#FFFFFF', '#F6EADB', '#24170E', '#6E5A4B', '#EFDFC9', '#8A735C',
    ]);
  });
  it('saffron acts and feeds, cinnamon moves (no teal), ink chooses, yellow treats, palm is done, pomegranate stops, date anchors', () => {
    expect([i.accent, i.accentTint, i.accentText]).toEqual(['#F38A1B', '#FFE6C2', '#A24F08']);
    expect([i.live, i.liveTint, i.liveText]).toEqual(['#8A4C22', '#F3D9C0', '#6E3A1A']);
    expect([i.info, i.infoTint, i.infoText]).toEqual(['#8A4C22', '#F3D9C0', '#6E3A1A']);
    expect([i.selected, i.onSelected, i.selectedSoft, i.segmentSelected]).toEqual(['#24170E', '#FFF8EF', '#24170E', '#24170E']);
    expect([i.deal, i.onDeal, i.star, i.starOutline]).toEqual(['#F2C14E', '#24170E', '#F2C14E', '#24170E']);
    expect([i.success, i.successTint, i.successText]).toEqual(['#2F7D4E', '#DCEEDF', '#23653E']);
    expect([i.danger, i.dangerTint, i.dangerText]).toEqual(['#B23A2E', '#F7DCD6', '#9A2E23']);
    expect([i.inverse, i.onInverse, i.onInverseAccent]).toEqual(['#2A170C', '#FFF3E2', '#FFB547']);
  });
  it('the stepper + is neutral and a tint card has no accent border', () => {
    expect([i.stepperPlus, i.onStepperPlus, i.stepperPlusBorder]).toEqual([i.surface, i.text, i.borderStrong]);
    expect(i.tintBorder).toBe(i.accentTint);
  });
  it('every theme defines every role', () => {
    for (const n of Object.keys(themes) as ThemeName[]) expect(Object.keys(themes[n]).sort()).toEqual(Object.keys(themes.light).sort());
  });
  it('is a light scheme; its night palette is dark and kept ready, not used (J-D4)', () => {
    expect(scheme).toEqual({ light: 'light', dark: 'dark', istikan: 'light', istikanNight: 'dark' });
    expect(themes.istikanNight.bg).toBe('#1A100A');
  });
  it('identity colours are non-semantic, and every letter on them passes AA', () => {
    expect(identity.istikan.map((c) => c.fill)).toEqual(['#7A4A2A', '#AD5E36', '#6B7B2E', '#5C2A12', '#8E5A12', '#B23A2E']);
    for (const n of Object.keys(themes) as ThemeName[]) {
      for (const c of identity[n]) expect(contrastRatio(c.on, c.fill), `${n} ${c.fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('each service has its own colour: saffron food, yellow taxi, plum tuktuk, date-brown trips, gold الرجعة (no blue)', () => {
    const s = services.istikan;
    expect([s.food.fill, s.taxi.fill, s.tuktuk.fill, s.trips.fill, s.back.fill]).toEqual(['#F7A33B', '#FFD84D', '#8A3F93', '#2A170C', '#FFC155']);
    expect([s.trips.light, s.trips.pattern, s.back.light]).toEqual(['#5A3118', '#FFC155', '#FFE3A6']);
    expect(decor.istikan.stages.length).toBeGreaterThanOrEqual(6);
  });
});

describe('motion and haptics (report 5 §6)', () => {
  it('has the Pour & settle springs and durations', () => {
    expect(motion.spring.settle).toEqual({ damping: 14, stiffness: 170, mass: 0.9 });
    expect(motion.spring.celebrate).toEqual({ damping: 10, stiffness: 180, mass: 0.8 });
    expect(motion.spring.hop).toEqual({ damping: 16, stiffness: 220, mass: 0.7 });
    expect([motion.duration.camera, motion.duration.ambient, motion.duration.celebrate, motion.duration.digitRoll]).toEqual([600, 2000, 900, 220]);
    expect(motion.distance).toEqual({ enter: 12, nudge: 4 });
    expect(motion.stagger).toBe(40);
  });
  it('haptics are rare: success only for the big moments, heavy only for SOS, secondary buttons silent in istikan', () => {
    const successes = Object.entries(haptic.events)
      .filter(([, k]) => k === 'success')
      .map(([e]) => e)
      .sort();
    expect(successes).toEqual(['arrival', 'orderPlaced', 'pointsEarned', 'seatBooked', 'topUpConfirmed']);
    expect(Object.entries(haptic.events).filter(([, k]) => k === 'heavy').map(([e]) => e)).toEqual(['sos']);
    expect(haptic.secondaryButton).toEqual({ light: 'light', dark: 'light', istikan: null, istikanNight: null });
  });
});
