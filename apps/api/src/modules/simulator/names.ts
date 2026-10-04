/**
 * Iraqi names for the simulator's people, so the Console, chat and support show "حيدر ك." rather
 * than an id (K-01). Deterministic by index; written to the vault once (`nameIfMissing`), never
 * read by the simulator itself.
 */
const MEN = ['حيدر', 'علي', 'حسين', 'مصطفى', 'كرار', 'سجاد', 'مرتضى', 'عباس', 'أحمد', 'محمد', 'ياسر', 'منتظر', 'سيف', 'حسن', 'مهدي', 'باقر', 'جعفر', 'قاسم', 'عمار', 'زيد', 'أمير', 'ضرغام', 'وسام'];
const WOMEN = ['زينب', 'فاطمة', 'نور', 'رقية', 'مريم', 'زهراء', 'سارة', 'هدى', 'بنين', 'آيات', 'دعاء', 'غدير'];
const FATHERS = ['كاظم', 'جواد', 'صالح', 'جبار', 'ناصر', 'رحيم', 'حميد', 'فاضل', 'عدنان', 'ستار', 'كريم', 'هادي', 'ماجد', 'رزاق', 'طالب', 'نعمة', 'شاكر'];

export function simDriverName(index: number): string {
  return `${MEN[index % MEN.length]} ${FATHERS[(index * 7 + 3) % FATHERS.length]}`;
}

export function simCustomerName(index: number): string {
  const first = index % 3 === 1 ? WOMEN[Math.floor(index / 3) % WOMEN.length] : MEN[(index * 5 + 2) % MEN.length];
  return `${first} ${FATHERS[(index * 11 + 5) % FATHERS.length]}`;
}

/** Restaurant owners (they accept the simulator's orders, so they appear in order logs). */
export function simOwnerName(index: number): string {
  return `${MEN[(index * 3 + 7) % MEN.length]} ${FATHERS[(index * 5 + 1) % FATHERS.length]}`;
}
