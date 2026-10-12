import type { CartCard } from '@driver/contracts';

export interface CartsMapProps {
  carts: readonly CartCard[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Screen space the top bar and the bottom card cover, so the camera frames the carts in what is left. */
  topInset: number;
  bottomInset: number;
  /** Our map file failed (or WebGL is missing): the screen shows the list instead. */
  onFail: () => void;
}
