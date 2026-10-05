import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderUI } from '../test/render';
import { AmountPad, amountPadNext } from './AmountPad';

describe('AmountPad ("غير" at the door)', () => {
  it('types whole dinars: no leading zeros, 000 for the thousands, delete, a digit limit', () => {
    expect(amountPadNext('', '0')).toBe('');
    expect(amountPadNext('', '000')).toBe('');
    expect(amountPadNext('2', '5')).toBe('25');
    expect(amountPadNext('25', '000')).toBe('25000');
    expect(amountPadNext('25000', 'back')).toBe('2500');
    expect(amountPadNext('', 'back')).toBe('');
    expect(amountPadNext('9999999', '1')).toBe('9999999');
    expect(amountPadNext('99999', '000', 7)).toBe('99999');
  });

  it('is twelve labelled 64-px keys; taps edit the value', () => {
    function Harness() {
      const [v, setV] = useState('');
      return (
        <>
          <AmountPad value={v} onChange={setV} deleteLabel="امسح" testID="pad" />
          <span data-testid="value">{v}</span>
        </>
      );
    }
    renderUI(<Harness />);
    expect(screen.getAllByRole('button')).toHaveLength(12);
    fireEvent.click(screen.getByTestId('pad-2'));
    fireEvent.click(screen.getByTestId('pad-5'));
    fireEvent.click(screen.getByTestId('pad-000'));
    expect(screen.getByTestId('value').textContent).toBe('25000');
    fireEvent.click(screen.getByLabelText('امسح'));
    expect(screen.getByTestId('value').textContent).toBe('2500');
  });
});
