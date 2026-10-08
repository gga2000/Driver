import { describe, expect, it } from 'vitest';
import { RAJAA_REVIEW_MAX, RateBookingInput, reviewTextProblem } from './routes-io.js';

describe('«كلمة عن السفرة» (x14): what a public review line may carry', () => {
  it('ordinary lines pass, prices and seat counts included', () => {
    for (const ok of ['سايق محترم وسيارته نظيفة', 'وصلنا الساعة 9 بالضبط', 'الأجرة 10,000 دينار وتستاهل', 'أخذ 4 ركاب بس', 'Great driver!'])
      expect(reviewTextProblem(ok)).toBeNull();
  });

  it('a phone number is refused in Western or Arabic-Indic digits, spaced or dashed', () => {
    for (const bad of ['اتصلوا 07701234567', 'رقمه ٠٧٧٠ ١٢٣ ٤٥٦٧', '0770-123-4567', '۰۷۷۰۱۲۳۴۵۶۷', '+964 770 123 4567'])
      expect(reviewTextProblem(bad)).toBe('contact');
  });

  it('links and @handles are refused', () => {
    for (const bad of ['شوفوا https://x.co/a', 'www.example.com', 'صفحته taxi-wasit.iq', 'تابعوه @haider.taxi'])
      expect(reviewTextProblem(bad)).toBe('contact');
  });

  it('the input trims, drops an empty line and caps the length', () => {
    expect(RateBookingInput.parse({ bookingId: 'b', stars: 5, comment: '   ' }).comment).toBeUndefined();
    expect(RateBookingInput.parse({ bookingId: 'b', stars: 5, comment: '  زين  ' }).comment).toBe('زين');
    expect(RateBookingInput.safeParse({ bookingId: 'b', stars: 5, comment: 'ا'.repeat(RAJAA_REVIEW_MAX + 1) }).success).toBe(false);
  });
});
