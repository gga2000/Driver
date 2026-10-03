import { useWindowDimensions } from 'react-native';

/** Tablet / wide web layout from this width up: side rail, board columns side by side, dialogs. */
export const WIDE_MIN_WIDTH = 900;

export function useLayout(): { wide: boolean; width: number; height: number } {
  const { width, height } = useWindowDimensions();
  return { wide: width >= WIDE_MIN_WIDTH, width, height };
}
