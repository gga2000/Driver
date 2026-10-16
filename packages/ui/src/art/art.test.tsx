import { View } from 'react-native';
import Svg from 'react-native-svg';
import { describe, expect, it } from 'vitest';
import { hasKey, t } from '@driver/i18n';
import { EmptyState } from '../components/EmptyState';
import { RetryState } from '../components/RetryState';
import { renderUI } from '../test/render';
import { DISH_KINDS, DishDrawing } from './dishes';
import { archPath } from './kit';
import { DISH_PHOTOS } from './photos/dishes';
import { SCENE_NAMES, SketchScene } from './SketchScene';

const SHAPES = 'path,circle,ellipse,rect,line,polygon';
/** Cheap-Android budget (spec §6): a screen shows one scene. (Dishes are pictures now: one element each.) */
const SCENE_BUDGET = 90;

describe('dish pictures (joy J4)', () => {
  it('has the food-funnel S-3 archetypes', () => {
    for (const k of ['kebab', 'tikka', 'liver', 'chicken', 'shawarma', 'falafel', 'wrap', 'plate', 'tray', 'rice', 'okra', 'beans', 'soup', 'pacha', 'dolma', 'fish', 'kubba', 'bread', 'salad', 'pickles', 'hummus', 'sweet', 'tea', 'laban', 'water', 'can'] as const) {
      expect(DISH_KINDS).toContain(k);
    }
  });

  it.each(DISH_KINDS)('%s paints its picture in every look', (kind) => {
    for (const look of [0, 1, 2]) {
      const { container, unmount } = renderUI(
        <Svg viewBox="0 0 200 200">
          <DishDrawing kind={kind} look={look} />
        </Svg>,
      );
      const image = container.querySelector('image');
      expect(image?.getAttribute('href')).toMatch(/\.webp$/);
      unmount();
    }
  });

  it('every picture in the folder is a kind of dish (none bundled for nothing)', () => {
    const shown = new Set(
      DISH_KINDS.map((kind) => {
        const { container, unmount } = renderUI(
          <Svg viewBox="0 0 200 200">
            <DishDrawing kind={kind} window={false} />
          </Svg>,
        );
        const href = container.querySelector('image')?.getAttribute('href');
        unmount();
        return href;
      }),
    );
    expect([...shown].sort()).toEqual(Object.values(DISH_PHOTOS).map(String).sort());
  });

  it('no two dishes share a drawing', () => {
    const drawn = new Set(
      DISH_KINDS.map((kind) => {
        const { container, unmount } = renderUI(
          <Svg viewBox="0 0 200 200">
            <DishDrawing kind={kind} window={false} />
          </Svg>,
        );
        const html = container.innerHTML;
        unmount();
        return html;
      }),
    );
    expect(drawn.size).toBe(DISH_KINDS.length);
  });
});

describe('sketchbook scenes (joy J4)', () => {
  it.each(SCENE_NAMES)('%s renders within budget and is decorative by default', (name) => {
    const { container, getByTestId } = renderUI(<SketchScene name={name} />);
    expect(container.querySelectorAll(SHAPES).length).toBeLessThanOrEqual(SCENE_BUDGET);
    expect(getByTestId(`scene-${name}`).getAttribute('aria-hidden')).toBe('true');
  });

  it('safe arrival draws each vehicle differently', () => {
    const html = (['minibus', 'tuktuk', 'car'] as const).map((vehicle) => {
      const { container, unmount } = renderUI(<SketchScene name="safe_arrival" vehicle={vehicle} />);
      const out = container.innerHTML;
      unmount();
      return out;
    });
    expect(new Set(html).size).toBe(3);
  });

  it('a labelled scene is an image with its Arabic label', () => {
    const label = t('art.scene.offline');
    const { getByLabelText } = renderUI(<SketchScene name="offline" label={label} />);
    const el = getByLabelText(label);
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-hidden')).toBeNull();
  });

  it('every scene has a label in the locale files', () => {
    for (const name of SCENE_NAMES) expect(hasKey(`art.scene.${name}`), name).toBe(true);
  });

  it('the arch is closed and starts at its foot', () => {
    expect(archPath(0, 0, 100, 160)).toMatch(/^M0 160L0 .*Z$/);
  });
});

describe('EmptyState and RetryState take a drawing instead of the icon tile', () => {
  it('EmptyState shows the art', () => {
    const { getByTestId, queryByTestId } = renderUI(<EmptyState icon="cart" title="سلتك فاضية" art={<View testID="art" />} />);
    expect(getByTestId('art')).toBeTruthy();
    expect(queryByTestId('empty-state-icon')).toBeNull();
  });

  it('EmptyState without art keeps its icon tile', () => {
    const { getByTestId } = renderUI(<EmptyState icon="cart" title="سلتك فاضية" />);
    expect(getByTestId('empty-state-icon')).toBeTruthy();
  });

  it('RetryState shows the art for offline', () => {
    const { getByTestId, queryByTestId } = renderUI(<RetryState kind="offline" art={<View testID="art" />} />);
    expect(getByTestId('art')).toBeTruthy();
    expect(queryByTestId('retry-state-icon')).toBeNull();
  });
});
