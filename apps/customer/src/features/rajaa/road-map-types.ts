import type { IntercityRoad, RoadTown } from '@driver/map/pieces/road';

/** How the road map is looked at: the pass's strip (C), the whole road (A), or the window seat (B). */
export type RoadMapMode = 'strip' | 'whole' | 'window';

export interface RoadMapProps {
  road: IntercityRoad;
  /** Metres driven; null before the car has left (the road and its towns, no car). */
  carM: number | null;
  mode: RoadMapMode;
  /** The name at the start of the road (the garage's town). */
  startName: string;
  /** The driver's initial, for the car pin ('' draws the minibus). */
  initial: string;
  /** The whole road: the car's tag («عديتوا بسماية» over «باقي 38 دقيقة»). */
  carTag?: { top: string; bottom: string } | null;
  /** The window seat: the card on the horizon («الجاية» over «جسر ديالى · 11 دقيقة»). */
  horizon?: { eyebrow: string; title: string } | null;
  /** Screen space the top bar and the sheet cover, so the camera frames the road in what is left. */
  topInset: number;
  bottomInset: number;
  /** Cheap phones and low-data mode: the flat map, no window seat. */
  lite: boolean;
  /** Our map file failed (or WebGL is missing): the screen goes on without the map. */
  onFail: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

/** Which town's chip goes on which side of the road, and how it reads. */
export type ChipTone = 'next' | 'end' | 'ahead' | 'passed';
export interface RoadChip {
  id: string;
  name: string;
  at: [number, number];
  tone: ChipTone;
  /** Alternate sides along the road, so neighbours don't sit on each other. */
  side: 'left' | 'right';
}

/** The chips for the start and every town, toned against the car (the piece's own "next" rule). */
export function roadChips(road: IntercityRoad, startName: string, nextTown: RoadTown | null, passed: readonly RoadTown[]): RoadChip[] {
  const end = road.path[road.path.length - 1]!;
  const chips: RoadChip[] = [{ id: 'start', name: startName, at: road.path[0]!, tone: 'ahead', side: 'right' }];
  road.towns.forEach((t, i) => {
    const tone: ChipTone = t === nextTown ? 'next' : t.kind === 'city' ? 'end' : passed.includes(t) ? 'passed' : 'ahead';
    chips.push({ id: `town_${i}`, name: t.nameAr, at: t.kind === 'city' ? end : t.at, tone, side: i % 2 === 0 ? 'left' : 'right' });
  });
  return chips;
}

/** The map's own town names that our chips already say: hidden, so a town is never named twice. */
export const LOCALITIES_LAYER = 'golden-localities';
export function withoutNamed(filter: unknown, names: readonly string[]): unknown {
  const not = ['!', ['in', ['get', 'name'], ['literal', [...names]]]];
  return filter ? ['all', filter, not] : not;
}
