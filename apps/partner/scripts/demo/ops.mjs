// Field ops seed (wave 2): an ops staffer with stored tasks, couriers holding customers' cash (one
// near his cap, one over it: computed cash tasks) and landmark places to photograph.
//
//   who=ops   0770 111 0006  ياسر عبد الله  field_ops
//
//   couriers holding cash: حيدر كاظم 45,000 (core) · سجاد ناصر 61,000 · مرتضى سالم 82,000 (over cap)
//   landmarks: centre ×4, شارع 30, محدود ثانية, الهاشمي, السعدونية
//
//   GET /demo/ops/code?who=<courier key>|personId=…   → { code } the courier's daily hand-over code
//   GET /demo/ops/couriers                           → { key: personId } of the cash couriers
const DAY = 86_400_000;

export default async function register(demo) {
  const { services, Accounts, CITY } = demo;
  const { OPS_REPOSITORY } = await demo.load('modules/ops/index.js');
  const { DriverAccountService } = await demo.load('modules/driver-account/index.js');
  const { PlacesService } = await demo.load('modules/places/index.js');
  const repo = demo.app.get(OPS_REPOSITORY);
  const accounts = demo.app.get(DriverAccountService);
  const places = demo.app.get(PlacesService);

  const opsId = await demo.person({ key: 'ops', phone: '07701110006', name: 'ياسر عبد الله', roles: ['field_ops'] });

  // Couriers with cash (the two "other couriers" from the core seed get names here as keys).
  const sajjad = await demo.person({ key: 'c_sajjad', phone: '07701110022', name: 'سجاد ناصر', roles: ['courier'], vehicle: 'bike' });
  const murtadha = await demo.person({ key: 'c_murtadha', phone: '07701110021', name: 'مرتضى سالم', roles: ['courier'], vehicle: 'bike' });
  await services.ledger.recordAll([
    demo.group('demo:ops:sajjad:cash', demo.hoursAgo(2), [{ type: 'cash_collected', amount: 61_000, fromAccount: Accounts.cash(sajjad), toAccount: Accounts.customer('demo-buyer') }]),
    demo.group('demo:ops:murtadha:cash', demo.hoursAgo(3), [{ type: 'cash_collected', amount: 82_000, fromAccount: Accounts.cash(murtadha), toAccount: Accounts.customer('demo-buyer') }]),
  ]);

  // Stored tasks for today and tomorrow.
  const now = Date.now();
  const task = (kind, title, dueInH, payload = {}) =>
    repo.addTask({ cityId: CITY, kind, refId: null, title, state: 'open', assigneeId: opsId, dueAt: new Date(now + dueInH * 3_600_000), payload, completedAt: null, completedById: null, createdAt: new Date(now - DAY) });
  await task('landmark_photo', 'صوّر مدخل كلية التربية الأساسية من الشارع العام', 1.5);
  await task('merchant_followup', 'كمّل تسجيل فرن الأمير: المنيو من الصور وهوية صاحب المحل', 20);
  await task('document_check', 'تأكد من سنوية فان زيد ناصر قبل الأحد', 26);

  // Landmarks (shared city knowledge) to photograph.
  const lm = (name, lat, lng, photos = 0) =>
    places.save({ cityId: CITY, pin: { lat, lng }, name, photos: Array.from({ length: photos }, (_, i) => ({ id: `ph_${name}_${i}`, url: 'https://example.com/landmark.jpg' })), confidence: 1, sharedWith: [], landmark: true });
  lm('الجامع الكبير', 32.9052, 45.0598, 3);
  lm('سوق العزيزية الكبير', 32.9046, 45.0612, 1);
  lm('مستشفى العزيزية العام', 32.9041, 45.0575);
  lm('كراج بغداد القديم', 32.9058, 45.0625);
  lm('دوّار شارع 30', 32.9097, 45.0637, 2);
  lm('حديقة الشاشة', 32.9165, 45.0585);
  lm('جامع الرسول', 32.8962, 45.0671, 1);
  lm('كلية التربية الأساسية', 32.9003, 45.0468);

  demo.route('/demo/ops/code', async ({ res, query }) => {
    const p = demo.who(query);
    const c = await accounts.handoverCode({ personId: p.personId, sessionId: 'demo' });
    demo.json(res, 200, { personId: p.personId, code: c.code });
  });
  demo.route('/demo/ops/couriers', async ({ res }) => demo.json(res, 200, { courier: demo.people.get('courier')?.personId, c_sajjad: sajjad, c_murtadha: murtadha }));
}
