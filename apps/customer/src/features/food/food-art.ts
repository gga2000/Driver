import { doorOf, onlyIceCream } from '@driver/contracts';
import type { DishKind } from '@driver/ui';

/**
 * Which drawing a dish gets (b3, UI/UX audit F-01 / S2-07; the J4 sketchbook set in `@driver/ui`)
 * until real photos replace them dish by dish. Pure: the motif follows the dish itself (its name, then its menu section),
 * never the kitchen, so a kebab menu is no longer nine identical plates; water is a bottle, laban and
 * شنينة a glass, soft drinks a can. Each dish also gets one of a few looks (tilt, garnish, plate
 * tint) from a hash of its id, and adjacent rows never share a drawing.
 */
export type Motif = DishKind;

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

/** How many looks each motif has (tilt, garnish, plate tint); equals `DISH_LOOKS` in `@driver/ui`. */
export const ART_LOOKS = 3;

export function motifForDish(name: string, section?: string): Motif {
  for (const [re, m] of BY_NAME) if (re.test(name)) return m;
  if (section) for (const [re, m] of BY_SECTION) if (re.test(section)) return m;
  return 'plate';
}

/** Kitchen words on home's cuisine circles that no dish name uses. */
const BY_CUISINE: ReadonlyArray<readonly [RegExp, Motif]> = [
  [/فطور|ريوك|ريوگ/, 'breakfast'],
  [/قهوة|كافيه|كوفي/, 'coffee'],
  [/آيس كريم|ايس كريم|دوندرمة/, 'icecream'],
  [/حلويات/, 'sweet'],
  [/مشويات/, 'kebab'],
  [/معجنات/, 'manakish'],
  [/عصائر/, 'juice'],
];

/** The dish a cuisine word on home stands for («كباب», «تمن ومرق», «فطور»): its round picture (joy b6). */
export function motifForCuisine(word: string): Motif {
  for (const [re, m] of BY_CUISINE) if (re.test(word)) return m;
  return motifForDish(word);
}

/**
 * A kitchen's picture (row, rail and menu hero alike), bugs b3/b4 of the food doors review: a café is a
 * coffee cup, a juice bar a glass, a sweets shop its tray and an ice cream shop a cone, never the rice
 * fallback. A restaurant shows the first word of its own cuisine line («كباب · تكة» → kebab), so two
 * grill kitchens differ: «مشويات» is the mixed-grill tray, not another kebab plate. Tags decide when the
 * line names nothing drawable.
 */
export function motifForKitchen(tags: readonly string[], cuisine?: string): Motif {
  const door = doorOf(tags);
  if (door === 'cafe') return 'coffee';
  if (door === 'cold') return 'juice';
  if (door === 'sweet') return onlyIceCream(tags) ? 'icecream' : 'sweet';
  const first = cuisine?.split(/[·،,]/)[0]?.trim();
  if (first) {
    if (/مشويات|مشاوي/.test(first)) return 'tray';
    const m = motifForCuisine(first);
    if (m !== 'plate') return m;
  }
  if (tags.includes('shawarma')) return 'shawarma';
  if (tags.includes('pacha')) return 'pacha';
  if (tags.includes('breakfast')) return 'breakfast';
  if (tags.includes('grill') || tags.includes('kebab')) return 'kebab';
  if (tags.includes('falafel')) return 'falafel';
  if (tags.includes('chicken')) return 'chicken';
  if (tags.includes('rice') || tags.includes('stew')) return 'rice';
  return 'plate';
}

export interface DishArt {
  motif: Motif;
  /** 0 … ART_LOOKS − 1. */
  look: number;
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

/** A kitchen's look (tilt, plate, garnish) from its id: two grill kitchens in a list don't show the same plate. */
export function kitchenLook(id: string): number {
  return hash(id) % ART_LOOKS;
}

/** One dish's drawing on its own (cart upsell, search, the item sheet). */
export function artOf(dish: { id: string; name: string; category?: string }): DishArt {
  return { motif: motifForDish(dish.name, dish.category), look: hash(dish.id) % ART_LOOKS };
}

export function sameDrawing(a: DishArt, b: DishArt): boolean {
  return a.motif === b.motif && a.look === b.look;
}

/** Drawings for a list in display order: a row that would repeat the one above takes the next look. */
export function dishArt(rows: ReadonlyArray<{ id: string; name: string; category?: string }>): DishArt[] {
  const out: DishArt[] = [];
  for (const row of rows) {
    const art = artOf(row);
    const prev = out[out.length - 1];
    out.push(prev && sameDrawing(prev, art) ? { motif: art.motif, look: (art.look + 1) % ART_LOOKS } : art);
  }
  return out;
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
