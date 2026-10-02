import { Injectable } from '@nestjs/common';

export type RoleKind =
  | 'customer' | 'courier' | 'driver' | 'merchant_staff' | 'merchant_owner' | 'fleet_owner'
  | 'guardian' | 'field_ops' | 'dispatcher' | 'support' | 'finance' | 'admin';

export interface Person {
  id: string;
  phone: string;
  name: string;
  locale: string;
  roles: Array<{ kind: RoleKind; orgId?: string }>;
}

export class IdentityError extends Error {
  constructor(readonly code: 'invalid_phone' | 'not_found', message: string) {
    super(message);
    this.name = 'IdentityError';
  }
}

/** Normalises Iraqi numbers to E.164 (+964…). Accepts 07xx…, 7xx…, 9647xx…, +9647xx…. */
export function normalizeIraqiPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  let national: string;
  if (digits.startsWith('964')) national = digits.slice(3);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else national = digits;
  if (!/^7\d{9}$/.test(national)) throw new IdentityError('invalid_phone', `not an Iraqi mobile number: ${raw}`);
  return `+964${national}`;
}

/** One identity per phone number; roles are grants, never duplicate accounts. */
@Injectable()
export class IdentityService {
  private readonly byPhone = new Map<string, Person>();
  private seq = 0;

  findOrCreateByPhone(rawPhone: string, name = '', locale = 'ar-IQ'): Person {
    const phone = normalizeIraqiPhone(rawPhone);
    const existing = this.byPhone.get(phone);
    if (existing) return existing;
    this.seq += 1;
    const person: Person = { id: `p_${this.seq}`, phone, name, locale, roles: [{ kind: 'customer' }] };
    this.byPhone.set(phone, person);
    return person;
  }

  grant(personId: string, kind: RoleKind, orgId?: string): Person {
    const person = this.byId(personId);
    if (!person.roles.some((r) => r.kind === kind && r.orgId === orgId)) person.roles.push({ kind, orgId });
    return person;
  }

  has(personId: string, kind: RoleKind, orgId?: string): boolean {
    return this.byId(personId).roles.some((r) => r.kind === kind && (orgId === undefined || r.orgId === orgId));
  }

  byId(personId: string): Person {
    for (const p of this.byPhone.values()) if (p.id === personId) return p;
    throw new IdentityError('not_found', `person ${personId} not found`);
  }
}
