import { describe, expect, it } from 'vitest';
import { orderTicketNumber, parseOrderTicket } from './order.js';

describe('orderTicketNumber / parseOrderTicket', () => {
  it('the ticket is four digits, stable per id', () => {
    const n = orderTicketNumber('ord_969');
    expect(n).toMatch(/^[1-9]\d{3}$/);
    expect(orderTicketNumber('ord_969')).toBe(n);
  });

  it('reads what people type or say: 1284, #1284, # 1284 and Eastern digits', () => {
    expect(parseOrderTicket('1284')).toBe('1284');
    expect(parseOrderTicket('#1284')).toBe('1284');
    expect(parseOrderTicket('  # 1284 ')).toBe('1284');
    expect(parseOrderTicket('١٢٨٤')).toBe('1284');
    expect(parseOrderTicket('#۱۲۸۴')).toBe('1284');
  });

  it('anything else is not a ticket: ids, names, other lengths, below 1000', () => {
    for (const s of ['ord_1284', '128', '12845', 'كباب', '', '#', '0999', '12 84']) expect(parseOrderTicket(s)).toBeNull();
  });

  it('every ticket parses back to itself', () => {
    for (const id of ['ord_1', 'ord_2', 'cmh3x9abc', 'trip-xyz']) expect(parseOrderTicket(`#${orderTicketNumber(id)}`)).toBe(orderTicketNumber(id));
  });
});
