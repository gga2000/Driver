import type { ReactNode } from 'react';
import type { DepartureCard } from '@driver/contracts';
import type { GarageCar } from './garage-cars';

/** Seat colours of the bars (the screen's legend uses the same). */
export interface SeatColours {
  free: string;
  taken: string;
}

/** A car on the lot: where it stands, its seats, and its chip (the departure time, and what a screen reader says). */
export interface LotCar extends GarageCar {
  label: string;
  a11y: string;
}

export interface GarageLotProps {
  /** Which 3D garage (`garageKey`); its bays come from the map package. */
  lotKey: 'bab1' | 'bab2' | 'souq';
  garageId: string;
  /** This garage's bookable cars, soonest first (`garageLot`). */
  departures: DepartureCard[];
  /** The chip text and screen-reader line for a car. */
  labelOf: (d: DepartureCard) => { label: string; a11y: string };
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Screen space the top bar and the bottom card cover, so the camera frames the lot in what is left. */
  topInset: number;
  bottomInset: number;
  /** Cheap phones and low-data mode: flat map, no glide, no rising bars. */
  lite: boolean;
  /** Our map file failed (or WebGL is missing): the screen shows the list instead. */
  onFail: () => void;
  /** The screen's legend, drawn in the bars' own seat colours once the map knows its light. */
  legend?: (colours: SeatColours) => ReactNode;
}
