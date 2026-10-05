import { describe, expect, it } from 'vitest';
import { doorChips, doorHandover, doorState, tenderLine, WALLET_CAP_IQD } from './cash-door';

describe('"الخردة علينا" at the door', () => {
  it('chips: the customer\'s stated note first, then the exact amount and the notes above it', () => {
    expect(doorChips(17_750, 25_000)).toEqual([
      { amountIqd: 25_000, stated: true, exact: false },
      { amountIqd: 17_750, stated: false, exact: true },
      { amountIqd: 20_000, stated: false, exact: false },
      { amountIqd: 50_000, stated: false, exact: false },
    ]);
    expect(doorChips(14_000).map((c) => c.amountIqd)).toEqual([14_000, 20_000, 25_000, 50_000]);
    // A stated note that is the exact amount is one chip, marked as both.
    expect(doorChips(20_000, 20_000)).toEqual([
      { amountIqd: 20_000, stated: true, exact: true },
      { amountIqd: 25_000, stated: false, exact: false },
      { amountIqd: 50_000, stated: false, exact: false },
    ]);
  });

  it('the job card line names the note and the change to bring', () => {
    expect(tenderLine(17_750, 25_000)).toEqual({ tenderIqd: 25_000, changeIqd: 7_250 });
    expect(tenderLine(17_750, 17_750)).toEqual({ tenderIqd: 17_750, changeIqd: 0 });
    expect(tenderLine(17_750, null)).toBeNull();
    expect(tenderLine(0, 25_000)).toBeNull();
  });

  it('change to hand back; the wallet only when it fits the cap and the 250 step', () => {
    expect(doorState(17_750, 25_000)).toEqual({ paidIqd: 25_000, changeIqd: 7_250, walletAllowed: true, walletBlock: null, short: false });
    expect(doorState(17_750, 17_750)).toMatchObject({ changeIqd: 0, walletAllowed: false, walletBlock: null });
    expect(doorState(17_750, 50_000)).toMatchObject({ changeIqd: 32_250, walletAllowed: false, walletBlock: 'above_cap' });
    expect(doorState(17_750, 20_100)).toMatchObject({ changeIqd: 2_350, walletAllowed: false, walletBlock: 'not_step' });
    expect(doorState(17_750, 15_000)).toMatchObject({ changeIqd: 0, short: true });
    expect(WALLET_CAP_IQD).toBe(25_000);
  });

  it('records what he keeps, or the whole note with the rest to the wallet', () => {
    expect(doorHandover(17_750, 25_000, false)).toEqual({ cashCollectedIqd: 17_750 });
    expect(doorHandover(17_750, 25_000, true)).toEqual({ cashCollectedIqd: 25_000, changeToWalletIqd: 7_250 });
    // Not allowed (over the cap): he hands the change back, whatever the toggle says.
    expect(doorHandover(17_750, 50_000, true)).toEqual({ cashCollectedIqd: 17_750 });
    expect(doorHandover(17_750, 17_750, true)).toEqual({ cashCollectedIqd: 17_750 });
  });
});
