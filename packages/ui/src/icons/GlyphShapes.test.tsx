import Svg from 'react-native-svg';
import { describe, expect, it } from 'vitest';
import { renderUI } from '../test/render';
import { GlyphShapes } from './GlyphShapes';
import { Icon } from './Icon';
import { ICONS } from './paths';

describe('GlyphShapes (maps program b3)', () => {
  it('draws the shapes inside the parent Svg, centred on x, y and scaled from the 24 px grid', () => {
    const { container } = renderUI(
      <Svg width={100} height={100}>
        <GlyphShapes shapes={ICONS.garage} x={50} y={40} size={12} color="#4A4239" strokeWidth={2} />
      </Svg>,
    );
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container.querySelectorAll('path')).toHaveLength(ICONS.garage.length);
    const group = container.querySelector('g[transform]');
    expect(group?.getAttribute('transform')?.replace(/\s+/g, ' ')).toMatch(/translate\(44,? 34\).*scale\(0\.5\)/);
    expect(group?.getAttribute('stroke')).toBe('#4A4239');
  });

  it('Icon still draws circles and rects through the shared renderer', () => {
    const { container } = renderUI(<Icon name="seat" />);
    expect(container.querySelectorAll('rect')).toHaveLength(2);
    const { container: c2 } = renderUI(<Icon name="search" />);
    expect(c2.querySelectorAll('circle')).toHaveLength(1);
  });
});
