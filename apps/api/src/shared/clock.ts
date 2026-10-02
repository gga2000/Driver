import { Injectable } from '@nestjs/common';

/**
 * The only source of "now" in the API. Services take a `Clock` so timers, late meters,
 * skew checks and the simulator can run against a `FakeClock` deterministically.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Deterministic clock for tests and the simulator: starts where you say and moves only when told. */
export class FakeClock implements Clock {
  private current: number;

  constructor(start: Date | string | number = '2026-10-02T09:00:00Z') {
    this.current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(to: Date | string | number): void {
    this.current = new Date(to).getTime();
  }

  advance(ms: number): Date {
    this.current += ms;
    return this.now();
  }

  advanceSeconds(s: number): Date {
    return this.advance(s * 1000);
  }

  advanceMinutes(m: number): Date {
    return this.advance(m * 60_000);
  }
}
