import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderUI } from '../test/render';
import { LocalPhoto, PhotoImage } from './PhotoImage';

/** A stand-in IntersectionObserver the test drives by hand. */
function fakeObserver() {
  const made: { cb: IntersectionObserverCallback; margin: string | undefined; observed: Element[]; off: boolean }[] = [];
  class FakeIO {
    entry: (typeof made)[number];
    constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
      this.entry = { cb, margin: opts?.rootMargin, observed: [], off: false };
      made.push(this.entry);
    }
    observe(el: Element) {
      this.entry.observed.push(el);
    }
    disconnect() {
      this.entry.off = true;
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeIO);
  const show = (visible: boolean) =>
    act(() => {
      for (const m of made) if (!m.off) m.cb(m.observed.map((target) => ({ isIntersecting: visible, target }) as IntersectionObserverEntry), {} as IntersectionObserver);
    });
  return { made, show };
}

const box = { width: 120, height: 90 };

describe('photos below the screen wait until they are near it (speed w2)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a network photo holds its place, then loads once it comes within about a screen', () => {
    const io = fakeObserver();
    const { queryByTestId } = renderUI(<PhotoImage uri="https://x.test/a.webp" style={box} testID="p" />);
    expect(queryByTestId('p-waiting')).not.toBeNull();
    expect(queryByTestId('p')).toBeNull();
    expect(io.made[0]?.margin).toBe('600px');
    io.show(false);
    expect(queryByTestId('p')).toBeNull();
    io.show(true);
    expect(queryByTestId('p')).not.toBeNull();
    expect(queryByTestId('p-waiting')).toBeNull();
    expect(io.made[0]?.off).toBe(true);
  });

  it('the waiting box keeps the photo size, so nothing moves when it arrives', () => {
    fakeObserver();
    const { getByTestId } = renderUI(<LocalPhoto source={{ uri: 'https://x.test/b.webp' }} style={[box, { resizeMode: 'cover' }]} testID="l" />);
    const style = getComputedStyle(getByTestId('l-waiting'));
    expect(style.width).toBe('120px');
    expect(style.height).toBe('90px');
  });

  it('eager photos (the first screen) load at once', () => {
    const io = fakeObserver();
    const { queryByTestId } = renderUI(<LocalPhoto source={{ uri: 'https://x.test/c.webp' }} style={box} eager testID="e" />);
    expect(queryByTestId('e')).not.toBeNull();
    expect(io.made).toHaveLength(0);
  });

  it('without IntersectionObserver every photo loads at once', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { queryByTestId } = renderUI(<PhotoImage uri="https://x.test/d.webp" style={box} testID="d" />);
    expect(queryByTestId('d')).not.toBeNull();
  });
});
