// The speed checks' fixed clock. What home shows (open kitchens, the hour's dishes, the day's offers)
// depends on the time of day in Aziziyah, so open_kb moved with the hour CI ran at (home 44 KB at
// 14:31Z, 47 KB at 17:30Z on identical code). The demo API (node --import this file) and every page
// (pinClock) start their clock at PERF_NOW and let it run on from there, so timers still fire.

/** Wednesday 21 Oct 2026, 17:30 in Aziziyah: the hour of the last green main run (14:31Z) the budgets match. */
export const PERF_NOW = '2026-10-21T14:30:00Z';

/** Shifts `Date` in this realm so it reads `iso` now and then runs on at real speed. */
export function shiftDate(iso) {
  const Real = Date;
  const offset = Real.parse(iso) - Real.now();
  /** @this {unknown} */
  function PinnedDate(...args) {
    const now = Real.now() + offset;
    if (!new.target) return new Real(now).toString();
    return args.length ? new Real(...args) : new Real(now);
  }
  PinnedDate.prototype = Real.prototype;
  PinnedDate.now = () => Real.now() + offset;
  PinnedDate.parse = Real.parse;
  PinnedDate.UTC = Real.UTC;
  Object.setPrototypeOf(PinnedDate, Real);
  globalThis.Date = /** @type {DateConstructor} */ (/** @type {unknown} */ (PinnedDate));
}

/** Pins a Playwright page's clock (before any app code runs). */
export const pinClock = (page, iso = PERF_NOW) =>
  page.addInitScript(`(${shiftDate})(${JSON.stringify(iso)})`);

// `node --import scripts/perf/clock.mjs`: pin this process (the demo API).
if (process.env.PERF_PIN_CLOCK) shiftDate(process.env.PERF_PIN_CLOCK);
