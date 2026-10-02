import { Injectable } from '@nestjs/common';
import type { ApiError } from '@driver/contracts';

/** Every API error has a stable code, an Iraqi-Arabic message and a retry hint (spec §12). */
export const ERRORS = {
  city_mismatch: { message_ar: 'المدينة غير مدعومة حالياً', message_en: 'City not supported yet', retry: 'never' },
  vertical_not_configured: { message_ar: 'هذي الخدمة مو متوفرة بمدينتك', message_en: 'Service unavailable in your city', retry: 'never' },
  no_drivers: { message_ar: 'ماكو سواق قريب هسة، جرب بعد شوية', message_en: 'No drivers nearby right now', retry: 'later' },
  cash_cap_reached: { message_ar: 'وصلت الحد الأعلى للكاش، سوي تسوية', message_en: 'Cash cap reached; settle up', retry: 'never' },
  seat_taken: { message_ar: 'المقعد انحجز، اختار غيره', message_en: 'Seat already taken', retry: 'now' },
  network: { message_ar: 'ماكو نت، جرب مرة ثانية', message_en: 'No connection', retry: 'now' },
  internal: { message_ar: 'صار خلل، جرب بعد شوية', message_en: 'Something went wrong', retry: 'later' },
} as const satisfies Record<string, Omit<ApiError, 'code'>>;

export type ErrorCode = keyof typeof ERRORS;

export function apiError(code: ErrorCode): ApiError {
  return { code, ...ERRORS[code] };
}

export interface Ticket {
  id: string;
  tripId?: string;
  openedBy: string;
  kind: 'complaint' | 'dispute' | 'incident' | 'question';
  status: 'open' | 'resolved';
  note: string;
  openedAt: Date;
}

@Injectable()
export class SupportService {
  private readonly tickets = new Map<string, Ticket>();
  private seq = 0;

  open(input: Omit<Ticket, 'id' | 'status' | 'openedAt'>): Ticket {
    this.seq += 1;
    const t: Ticket = { ...input, id: `tk_${this.seq}`, status: 'open', openedAt: new Date() };
    this.tickets.set(t.id, t);
    return t;
  }

  resolve(id: string): Ticket {
    const t = this.tickets.get(id);
    if (!t) throw new Error(`ticket ${id} not found`);
    const next = { ...t, status: 'resolved' as const };
    this.tickets.set(id, next);
    return next;
  }

  /** Safety data retention is extended while an incident ticket is open for the trip. */
  hasOpenIncident(tripId: string): boolean {
    return [...this.tickets.values()].some((t) => t.tripId === tripId && t.kind === 'incident' && t.status === 'open');
  }
}
