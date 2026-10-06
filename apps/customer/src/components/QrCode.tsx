import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { qrMatrix, qrPath } from '@/lib/qr';
import { color } from '@driver/design-tokens';

/** A QR code drawn as one SVG path (crisp at any size, no image assets). Dark ink on white, 4-module quiet zone. */
export function QrCode({ value, size = 176, ink = color.neutral[900], testID }: { value: string; size?: number; ink?: string; testID?: string }) {
  const { path, size: modules } = useMemo(() => qrPath(qrMatrix(value)), [value]);
  return (
    <Svg testID={testID} width={size} height={size} viewBox={`0 0 ${modules} ${modules}`} accessibilityLabel={value}>
      <Rect x={0} y={0} width={modules} height={modules} fill={color.neutral[0]} />
      <Path d={path} fill={ink} />
    </Svg>
  );
}
