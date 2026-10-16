import { DISH_LOOKS, type DishKind } from './dishes';

/**
 * Which drawing a dish gets from its name (then its menu section), and whether a drink is hot or cold:
 * the same rules the customer app uses (`apps/customer/src/features/food/food-art.ts`), here so the
 * merchant's glass display (counter step 4) shows each tray with the very picture and «حار / بارد» mark
 * its customers see. Pure; keep the two in step until the customer app reads these.
 */
type Motif = DishKind;

/** Name rules, first match wins (drinks before food words: «ليمون بالنعناع» is a drink, «لفة كبد» a wrap). */
const BY_NAME: ReadonlyArray<readonly [RegExp, Motif]> = [
  // Food doors (2026-10-07): coffee is a café cup, not the tea glass; ice cream before the sweets words.
  // Their own pictures (idea o4) before the general coffee, juice and sweets words.
  [/مثلج|آيس لاتيه|ايس لاتيه|آيسد|ايسد|فرابيه|فرابتشينو/, 'iced'],
  [/قهوة عربية|قهوة عربي|قهوة مرة|قهوة مره|دلة/, 'dallah'],
  [/قهوة|كوفي|لاتيه|كابتشينو|كابوتشينو|اسبريسو|إسبريسو|موكا|نسكافيه|نسكفي/, 'coffee'],
  [/چاي|شاي|استكان/, 'tea'],
  [/آيس كريم|ايس كريم|أيس كريم|ايسكريم|آيسكريم|دوندرمة|دندرمة|بوظة|جيلاتي|ميلك شيك/, 'icecream'],
  [/رمان/, 'pomegranate'],
  [/كوكتيل/, 'cocktail'],
  [/موز بالحليب|موز وحليب|موز بحليب|حليب بالموز/, 'bananamilk'],
  [/ليمون بالنعناع|ليمون ونعناع|ليمون نعناع|موهيتو|ليموناضة|لیمونادة|ليمونادة/, 'lemonade'],
  [/بقلاوة|بقلاوه/, 'baklava'],
  [/زلابية|زلابيا|زلابيه/, 'zalabia'],
  [/كليچة|كليجة|كليچه|كليجه/, 'kleicha'],
  [/كيك|كعكة|كعكه|تورتة|تورته/, 'cake'],
  [/ماي|مياه/, 'water'],
  [/لبن|شنينة|عيران/, 'laban'],
  [/بيبسي|ببسي|كولا|سفن|ميرندا|غازي/, 'can'],
  [/عصير|ليمون|برتقال|رمان|موهيتو|كوكتيل|موز بالحليب/, 'juice'],
  [/فلافل/, 'falafel'],
  [/لفة|سندويش|ساندويج/, 'wrap'],
  [/شاورما|صاج/, 'shawarma'],
  [/كنافة|زلابية|زلابيا|بقلاوة|حلو|كيك|مهلبي|كليچة|كليجة|بسبوسة/, 'sweet'],
  [/طرشي|مخلل|عمبة/, 'pickles'],
  // J4: the Iraqi dishes that now have their own drawing, before the general words they contain.
  [/باچة|باجة|پاچة|پاجة/, 'pacha'],
  [/دولمة|دولمه|محشي|يبرق/, 'dolma'],
  [/مسگوف|مسكوف|سمچ|سمك/, 'fish'],
  [/كبة|كبه|كبّة/, 'kubba'],
  [/بامية|باميا|بامياء/, 'okra'],
  [/فاصوليا|لوبيا/, 'beans'],
  [/حمص/, 'hummus'],
  [/كيلو|صينية|سفرة|مشكّل|مشكل/, 'tray'],
  [/وجبة كباب|صحن كباب/, 'plate'],
  [/شوربة|عدس|تشريب/, 'soup'],
  [/برياني/, 'biryani'],
  [/تمن|قوزي|مقلوبة|مرق|قيمة/, 'rice'],
  [/سلطة|جاجيك|فتوش|تبولة/, 'salad'],
  [/كبد|معلاك|قلوب/, 'liver'],
  [/طماطة مشوية|طماطم مشوي/, 'salad'],
  [/دجاج|طاووق|فروج|مسحب/, 'chicken'],
  [/تكة|تكه/, 'tikka'],
  [/كباب|مشوي|شيش/, 'kebab'],
  [/بيض|مخلمة|كاهي|قيمر|كيمر|ريوك|ريوگ/, 'breakfast'],
  [/منقوشة|مناقيش|لحم بعجين|فطيرة|فطاير/, 'manakish'],
  [/صمون|خبز|عجين/, 'bread'],
];

/** Menu-section fallbacks for names the rules don't know. */
const BY_SECTION: ReadonlyArray<readonly [RegExp, Motif]> = [
  [/قهوة/, 'coffee'],
  [/چاي|شاي/, 'tea'],
  [/آيس كريم|ايس كريم|ميلك شيك/, 'icecream'],
  [/عصير|بارد/, 'juice'],
  [/كليچة|كليجة/, 'kleicha'],
  [/كيك/, 'cake'],
  [/كنافة/, 'sweet'],
  [/مشروب/, 'can'],
  [/حلو/, 'sweet'],
  [/شاورما/, 'shawarma'],
  [/فلافل/, 'falafel'],
  [/مقبلات|سلط/, 'salad'],
  [/شوربة/, 'soup'],
  [/ريوك|ريوگ|فطور/, 'breakfast'],
  [/معجنات|مناقيش/, 'manakish'],
  [/خبز/, 'bread'],
  [/مشويات|لفات/, 'kebab'],
];

export function motifForDish(name: string, section?: string): Motif {
  for (const [re, m] of BY_NAME) if (re.test(name)) return m;
  if (section) for (const [re, m] of BY_SECTION) if (re.test(section)) return m;
  return 'plate';
}

/** FNV-1a: a small, stable hash of a dish id (same look on every phone and every visit). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One of DISH_LOOKS looks per dish, stable by id (two kebab trays side by side don't sit the same). */
export function dishLook(id: string): number {
  return hash(id) % DISH_LOOKS;
}

/** Hot or cold, for the marks on a café's drinks (food doors m5): «ساخن» / «بارد». Null = not a drink. */
export type Temperature = 'hot' | 'cold';
const HOT: ReadonlySet<Motif> = new Set(['tea', 'coffee', 'dallah']);
const COLD: ReadonlySet<Motif> = new Set(['iced', 'juice', 'pomegranate', 'lemonade', 'bananamilk', 'cocktail', 'laban', 'can', 'water']);

export function temperatureOf(name: string, section?: string): Temperature | null {
  if (/مثلج|بارد|ثلج|آيس|ايس|فرابيه|فرابتشينو|سموذي|ميلك شيك/.test(name) && !/آيس كريم|ايس كريم/.test(name)) return 'cold';
  const m = motifForDish(name, section);
  if (HOT.has(m)) return 'hot';
  if (COLD.has(m)) return 'cold';
  return null;
}
