import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderUI } from '../test/render';
import { createTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

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
