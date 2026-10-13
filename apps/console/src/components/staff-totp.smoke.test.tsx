import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QrCode, RecoveryCodes } from './second-step';
import { StaffLockRows } from './shell/staff-step';

describe('staff authenticator (docs/api/staff-totp.md)', () => {
  it('the set-up QR code is one black-on-white SVG path', () => {
    const html = renderToString(<QrCode text="otpauth://totp/Driver%3AConsole?secret=JBSWY3DPEHPK3PXP&issuer=Driver&algorithm=SHA1&digits=6&period=30" />);
    expect(html).toMatch(/<svg[^>]*role="img"/);
    expect(html).toMatch(/<path d="M\d+ \d+h1v1h-1z/);
  });

  it('recovery codes: all 8, left to right, with the copy and continue buttons', () => {
    const codes = ['ABCDE-FGHJK', 'MNPQR-STUVW', 'XYZ23-45678', '9ABCD-EFGHJ', 'KMNPQ-RSTUV', 'WXYZ2-34567', '89ABC-DEFGH', 'JKMNP-QRSTU'];
    const html = renderToString(<RecoveryCodes codes={codes} onDone={() => undefined} />);
    for (const c of codes) expect(html).toContain(c);
    expect(html).toMatch(/<ol dir="ltr"/);
    expect(html).toContain('حفظتهن، كمّل');
  });

  it('a locked staff member: his name and when the lock ends, linked to the staff page', () => {
    const html = renderToString(<StaffLockRows rows={[{ personId: 'p1', displayName: 'حيدر', lockedAt: new Date('2026-10-13T12:00:00Z'), lockedUntil: new Date('2026-10-13T12:15:00Z') }]} />);
    expect(html).toContain('حيدر: 5 رموز مصادقة غلط');
    expect(html).toContain('3:15');
    expect(html).toContain('href="/staff"');
  });

  it('a new authenticator set-up by someone else: his name and when, linked to the staff page', () => {
    const html = renderToString(<StaffLockRows rows={[]} enrolments={[{ personId: 'p2', displayName: 'نور', enrolledAt: new Date('2026-10-13T11:10:00Z') }]} />);
    expect(html).toContain('نور: ربط تطبيق مصادقة جديد');
    expect(html).toContain('2:10');
    expect(html).toContain('href="/staff"');
  });
});
