import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { identity, themes, type ThemeName } from '@driver/design-tokens';
import { renderUI } from '../test/render';
import { createTheme } from '../theme/ThemeProvider';
import { Avatar, identityIndex } from './Avatar';
import { Button } from './Button';
import { Card } from './Card';
import { Chip } from './Chip';
import { SegmentedControl } from './SegmentedControl';
import { Stepper } from './Stepper';
import { Text } from './Text';

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const el = (id: string) => screen.getByTestId(id) as HTMLElement;
const pill = (id: string) => el(id).firstElementChild as HTMLElement;

describe.each(['light', 'istikan'] as ThemeName[])('role-driven components in %s', (name) => {
  const c = themes[name];
  it('a selected chip is filled with `selected` and carries a check', () => {
    renderUI(<Chip label="كباب" selected testID="chip" />, { theme: name });
    expect(pill('chip').style.backgroundColor).toBe(rgb(c.selected));
    expect(pill('chip').style.borderTopColor).toBe(rgb(c.selectedBorder));
    expect(el('chip').querySelectorAll('svg').length).toBe(1);
  });
  it('a chosen person chip uses `selectedSoft` and its round mark', () => {
    renderUI(<Chip label="سارة" avatar={{ name: 'سارة' }} selected testID="chip" />, { theme: name });
    expect(pill('chip').style.backgroundColor).toBe(rgb(c.selectedSoft));
  });
  it('the chosen segment label reads `onSegmentSelected`', () => {
    renderUI(<SegmentedControl options={[{ value: 'a', label: 'توصيل' }, { value: 'b', label: 'استلام' }]} value="a" onChange={() => {}} />, { theme: name });
    expect((screen.getByText('توصيل') as HTMLElement).style.color).toBe(rgb(c.onSegmentSelected));
  });
  it('the stepper "+" is `stepperPlus` with its ring', () => {
    renderUI(<Stepper value={1} onChange={() => {}} />, { theme: name });
    expect(el('stepper-inc').style.backgroundColor).toBe(rgb(c.stepperPlus));
    expect(el('stepper-inc').style.borderTopColor).toBe(rgb(c.stepperPlusBorder));
  });
  it('a tint card is bordered by `tintBorder`', () => {
    renderUI(
      <Card tone="tint" testID="card">
        <Text>x</Text>
      </Card>,
      { theme: name },
    );
    expect(el('card').style.borderTopColor).toBe(rgb(c.tintBorder));
  });
  it('an avatar without a tone takes its colour from the identity palette', () => {
    renderUI(<Avatar name="خالد" />, { theme: name });
    const inner = screen.getByText('خ').parentElement as HTMLElement;
    expect(inner.style.backgroundColor).toBe(rgb(identity[name][identityIndex('خالد', identity[name].length)]!.fill));
  });
});

describe('button haptics (joy S2-18)', () => {
  it('light keeps today\'s tap on every button; istikan only buzzes primary and destructive', () => {
    for (const [name, secondary] of [
      ['light', ['light']],
      ['istikan', []],
    ] as const) {
      const buzz = vi.fn();
      const { unmount } = renderUI(
        <>
          <Button label="ثانوي" variant="secondary" testID="s" />
          <Button label="أساسي" testID="p" />
        </>,
        { theme: name, haptics: buzz },
      );
      fireEvent.click(el('s'));
      expect(buzz.mock.calls.map((a) => a[0])).toEqual(secondary);
      buzz.mockClear();
      fireEvent.click(el('p'));
      expect(buzz.mock.calls.map((a) => a[0])).toEqual(['light']);
      unmount();
    }
  });
});

describe('istikan theme plumbing (joy J3a)', () => {
  it('istikan leans light; the other themes keep their scheme', () => {
    expect(createTheme('istikan').scheme).toBe('light');
    expect(createTheme('light').scheme).toBe('light');
    expect(createTheme('dark').scheme).toBe('dark');
  });
  it('secondary buttons buzz in light (unchanged) and stay silent in istikan', () => {
    expect(createTheme('light').secondaryButtonHaptic).toBe('light');
    expect(createTheme('istikan').secondaryButtonHaptic).toBeNull();
  });
});

describe('Text faces (joy J-D2)', () => {
  const family = (id: string) => (screen.getByTestId(id) as HTMLElement).style.fontFamily;
  it('voice sets Marhey first, display Alexandria first, the default stays Plex', () => {
    renderUI(
      <>
        <Text testID="v" face="voice">
          مفتوح هسة
        </Text>
        <Text testID="d" face="display">
          6:15
        </Text>
        <Text testID="p">عادي</Text>
      </>,
      { theme: 'istikan' },
    );
    expect(family('v').startsWith('Marhey')).toBe(true);
    expect(family('d').startsWith('Alexandria')).toBe(true);
    expect(family('p').startsWith('"IBM Plex Sans Arabic"')).toBe(true);
  });
  it('a number never goes in Marhey: the line falls back to Alexandria', () => {
    renderUI(
      <Text testID="v" face="voice">
        يوصل 6:15
      </Text>,
    );
    expect(family('v').startsWith('Alexandria')).toBe(true);
  });
});
