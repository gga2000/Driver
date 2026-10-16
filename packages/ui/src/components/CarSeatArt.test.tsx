import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderUI } from '../test/render';
import { artCoversLayout, type CarArtLayout, type SeatId, type SeatInfo } from '../logic/seats';
import { CarSeatArt } from './CarSeatArt';

const strip = (s: string | null | undefined) => (s ?? '').replace(/[⁦⁩]/g, '');

const SALOON: CarArtLayout = {
  aspect: 688 / 1024,
  background: '#FEF6E4',
  driver: { x: 36, y: 44 },
  seats: { front: { x: 63, y: 44 }, back_left: { x: 35, y: 65 }, back_middle: { x: 50, y: 65 }, back_right: { x: 64, y: 65 } },
};
const art = { ...SALOON, source: { uri: 'car.jpg' } };

describe('artCoversLayout', () => {
  it('a picture serves a layout only when every seat of it has a place inside the picture', () => {
    expect(artCoversLayout(SALOON, 4)).toBe(true);
    expect(artCoversLayout(SALOON, 7)).toBe(false);
    expect(artCoversLayout({ ...SALOON, seats: { ...SALOON.seats, back_right: { x: 120, y: 65 } } }, 4)).toBe(false);
  });
});

describe('CarSeatArt', () => {
  const car: SeatInfo[] = [
    { id: 'front', state: 'free', premium: 2000 },
    { id: 'back_left', state: 'taken' },
    { id: 'back_middle', state: 'free', blocked: true },
    { id: 'back_right', state: 'free' },
  ];

  function Harness({ onReject }: { onReject?: (id: SeatId, r: string) => void }) {
    const [sel, setSel] = useState<SeatId[]>([]);
    return (
      <>
        <CarSeatArt art={art} carName="النترا" layout={4} seats={car} selection={sel} onChange={setSel} onReject={onReject} />
        <span data-testid="sel">{sel.join(',')}</span>
      </>
    );
  }

  it('lays a spoken seat button on every seat of the car, with the front premium and the car named', () => {
    renderUI(<Harness />);
    for (const id of ['front', 'back_left', 'back_middle', 'back_right']) expect(screen.getByTestId(`seat-${id}`)).toBeTruthy();
    expect(strip(screen.getByTestId('seat-front').getAttribute('aria-label'))).toBe('قدام، فاضي، +2,000 دينار');
    expect(screen.getByTestId('seat-back_left').getAttribute('aria-label')).toBe('ورا يسار، محجوز');
    expect(strip(screen.getByTestId('car-seat-art').getAttribute('aria-label'))).toContain('النترا');
    expect(screen.getByText('+2,000')).toBeTruthy();
  });

  it('selecting a seat fills it with «مقعدك»; taken and not-for-you seats are refused with a reason', () => {
    const onReject = vi.fn();
    const haptic = vi.fn();
    renderUI(<Harness onReject={onReject} />, { haptics: haptic });
    fireEvent.click(screen.getByTestId('seat-back_right'));
    expect(screen.getByTestId('sel').textContent).toBe('back_right');
    expect(screen.getByTestId('seat-back_right').getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByText('مقعدك').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('seat-back_left'));
    fireEvent.click(screen.getByTestId('seat-back_middle'));
    expect(onReject.mock.calls).toEqual([
      ['back_left', 'taken'],
      ['back_middle', 'blocked'],
    ]);
    expect(haptic).toHaveBeenLastCalledWith('error');
    expect(screen.getByTestId('sel').textContent).toBe('back_right');
  });

  it('without onChange it is a picture of the car to look at, not to book', () => {
    renderUI(<CarSeatArt art={art} layout={4} seats={car} selection={['back_right']} driverLabel="أبو علي" />);
    expect(screen.getByTestId('seat-front').hasAttribute('disabled') || screen.getByTestId('seat-front').getAttribute('aria-disabled') === 'true').toBe(true);
    expect(screen.getByLabelText('أبو علي')).toBeTruthy();
  });
});
