import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { resolveColor, useTheme, type ColorValue } from '@driver/ui';

/**
 * Line glyphs the account screens need that `@driver/ui`'s icon set doesn't carry (camera, ID card,
 * document, lock, alert, trends, upload, medal). Same 24-unit grid, round caps and stroke as `Icon`.
 */
export type GlyphName = 'camera' | 'id-card' | 'document' | 'lock' | 'alert' | 'trend-up' | 'trend-down' | 'upload' | 'medal' | 'face' | 'refresh' | 'calendar';

export function Glyph({ name, size = 20, color = 'text', strokeWidth = 2 }: { name: GlyphName; size?: number; color?: ColorValue; strokeWidth?: number }) {
  const theme = useTheme();
  const c = resolveColor(theme, color);
  const p = { stroke: c, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'camera' ? (
        <>
          <Path {...p} d="M3 8.5a2 2 0 0 1 2-2h2.2l1.4-2h6.8l1.4 2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <Circle {...p} cx={12} cy={13} r={3.6} />
        </>
      ) : null}
      {name === 'id-card' ? (
        <>
          <Rect {...p} x={3} y={5} width={18} height={14} rx={2.5} />
          <Circle {...p} cx={8.5} cy={10.8} r={2} />
          <Path {...p} d="M5.6 16.2c.6-1.5 1.7-2.3 2.9-2.3s2.3.8 2.9 2.3M14 10h4.5M14 13.5h3" />
        </>
      ) : null}
      {name === 'document' ? <Path {...p} d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 16.5h4" /> : null}
      {name === 'lock' ? (
        <>
          <Rect {...p} x={5} y={10.5} width={14} height={10} rx={2.2} />
          <Path {...p} d="M8.2 10.5V7.6a3.8 3.8 0 0 1 7.6 0v2.9M12 14.6v2" />
        </>
      ) : null}
      {name === 'alert' ? <Path {...p} d="M12 3.8 2.9 19.6h18.2zM12 10v4.4M12 17.1v.1" /> : null}
      {name === 'trend-up' ? <Path {...p} d="M3 17l6-6 4 4 8-8M15 7h6v6" /> : null}
      {name === 'trend-down' ? <Path {...p} d="M3 7l6 6 4-4 8 8M15 17h6v-6" /> : null}
      {name === 'upload' ? <Path {...p} d="M12 15.5V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /> : null}
      {name === 'medal' ? (
        <>
          <Circle {...p} cx={12} cy={14.5} r={5.5} />
          <Path {...p} d="M8.6 3.5l2 5.6M15.4 3.5l-2 5.6M12 12.4v4.2" />
        </>
      ) : null}
      {name === 'face' ? (
        <>
          <Path {...p} d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
          <Path {...p} d="M9 10v.6M15 10v.6M9.2 15c.8.8 1.8 1.2 2.8 1.2s2-.4 2.8-1.2" />
        </>
      ) : null}
      {name === 'refresh' ? <Path {...p} d="M20 11a8 8 0 1 0-2.3 5.7M20 4.5V11h-6.5" /> : null}
      {name === 'calendar' ? (
        <>
          <Rect {...p} x={3.5} y={5} width={17} height={15.5} rx={2.5} />
          <Path {...p} d="M3.5 10h17M8 3v4M16 3v4" />
        </>
      ) : null}
    </Svg>
  );
}
