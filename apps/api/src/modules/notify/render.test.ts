import { describe, expect, it } from 'vitest';
import { render } from './render.js';

/** A template with its own SMS words (c9: the rider's «حجزلك مشوار» with the live link). */
describe('render: the SMS of a template with its own words', () => {
  const params = { booker: 'علي', driver: 'حيدر', car: 'تويوتا كورولا · أبيض', plate: 'بغداد 12345', link: 'https://driver.iq/t/abc', orderId: 'ride_2' };

  it('says who booked, who is coming in which car, and the link; the push stays short', () => {
    const r = render('ride_for_rider', params, 'ar-IQ');
    expect(r.title).toBe('علي حجزلك مشوار');
    expect(r.body).toBe('السايق حيدر جاي · تويوتا كورولا · أبيض · بغداد 12345');
    expect(r.sms).toBe('درايفر: علي حجزلك مشوار. السايق حيدر جاي بـتويوتا كورولا · أبيض، اللوحة بغداد 12345. تابع المشوار: https://driver.iq/t/abc');
    expect(r.deepLink).toBe('driver://order/ride_2');
  });

  it('a night ride’s code switches to the words with the code', () => {
    const r = render('ride_for_rider', { ...params, code: '4821' }, 'ar-IQ');
    expect(r.sms).toContain('رمز المشوار 4821');
    expect(r.sms).toContain('https://driver.iq/t/abc');
    expect(r.sms.length).toBeLessThanOrEqual(300);
  });

  it('templates without their own words keep "title — body"', () => {
    expect(render('ride_rider_arrived', { name: 'ماما', time: '9:40 م', orderId: 'ride_2' }, 'ar-IQ').sms).toBe('درايفر: مشوار ماما وصل بالسلامة — وصل الساعة 9:40 م. الحمد لله على السلامة');
  });
});
