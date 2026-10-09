// Generated from /mnt/project-files/dish-photo-library (Ali approved 2026-10-08): 640 px WebP, the weak takes left out.
// Regenerate with the same slugs; keep `photos` in the file's order (1 from above, 2 close-up, 3 on the table).
// The files live on the API (`apps/api/media/food/lib-<slug>-<n>.webp`, served by `GET /media/food/:name`),
// not in the app: the merchant download is about 4.9 MB smaller and a phone keeps each photo once seen.
import type { LibrarySection } from './library';

/** A library photo's path on the API. A name never changes its picture (a new picture gets a new name). */
const lib = (name: string): string => `/media/food/lib-${name}.webp`;

export interface LibraryDish {
  slug: string;
  nameAr: string;
  /** Words a dish name may use for it (spellings and synonyms), matched after normalising. */
  words: readonly string[];
  section: LibrarySection;
  /** API paths (`/media/food/lib-<slug>-<n>.webp`), drawn with `LibraryImage`. */
  photos: readonly string[];
}

export const LIBRARY: readonly LibraryDish[] = [
  { slug: 'masgouf', nameAr: 'مسكوف', words: ['مسكوف', 'سمك'], section: 'grill', photos: [lib('masgouf-1'), lib('masgouf-2'), lib('masgouf-3')] },
  { slug: 'kebab', nameAr: 'كباب', words: ['كباب'], section: 'grill', photos: [lib('kebab-1'), lib('kebab-2'), lib('kebab-3')] },
  { slug: 'tikka', nameAr: 'تكة', words: ['تكة', 'تكه'], section: 'grill', photos: [lib('tikka-1'), lib('tikka-2')] },
  { slug: 'mixed-grill', nameAr: 'مشويات مشكلة', words: ['مشويات', 'مشكل'], section: 'grill', photos: [lib('mixed-grill-1'), lib('mixed-grill-2'), lib('mixed-grill-3')] },
  { slug: 'chicken', nameAr: 'دجاج مشوي', words: ['دجاج', 'فروج'], section: 'grill', photos: [lib('chicken-1'), lib('chicken-2'), lib('chicken-3')] },
  { slug: 'liver', nameAr: 'معلاك', words: ['معلاك', 'كبدة', 'كبد'], section: 'grill', photos: [lib('liver-1'), lib('liver-2'), lib('liver-3')] },
  { slug: 'quzi', nameAr: 'قوزي', words: ['قوزي', 'قوزى'], section: 'rice', photos: [lib('quzi-1'), lib('quzi-2'), lib('quzi-3')] },
  { slug: 'timman-marag', nameAr: 'تمن ومرق', words: ['تمن', 'مرق', 'رز'], section: 'rice', photos: [lib('timman-marag-1'), lib('timman-marag-2'), lib('timman-marag-3')] },
  { slug: 'biryani', nameAr: 'برياني', words: ['برياني'], section: 'rice', photos: [lib('biryani-1'), lib('biryani-2')] },
  { slug: 'dolma', nameAr: 'دولمة', words: ['دولمة', 'دولمه', 'محشي'], section: 'rice', photos: [lib('dolma-1'), lib('dolma-2'), lib('dolma-3')] },
  { slug: 'bamia', nameAr: 'بامية', words: ['بامية', 'باميا'], section: 'rice', photos: [lib('bamia-1'), lib('bamia-2'), lib('bamia-3')] },
  { slug: 'qeema', nameAr: 'قيمة', words: ['قيمة', 'قيمه'], section: 'rice', photos: [lib('qeema-1'), lib('qeema-2'), lib('qeema-3')] },
  { slug: 'tashreeb', nameAr: 'تشريب', words: ['تشريب'], section: 'rice', photos: [lib('tashreeb-3')] },
  { slug: 'pacha', nameAr: 'باچة', words: ['باچة', 'باجة', 'پاچة', 'پاچه'], section: 'rice', photos: [lib('pacha-2'), lib('pacha-3')] },
  { slug: 'geymar', nameAr: 'كيمر', words: ['كيمر', 'قيمر', 'قيمك'], section: 'breakfast', photos: [lib('geymar-1'), lib('geymar-2'), lib('geymar-3')] },
  { slug: 'bagilla', nameAr: 'باگلة', words: ['باگلة', 'باقلاء', 'باقلة', 'باكلة'], section: 'breakfast', photos: [lib('bagilla-1'), lib('bagilla-2'), lib('bagilla-3')] },
  { slug: 'lentil-soup', nameAr: 'شوربة عدس', words: ['عدس', 'شوربة', 'شوربه'], section: 'breakfast', photos: [lib('lentil-soup-1'), lib('lentil-soup-2'), lib('lentil-soup-3')] },
  { slug: 'kubba', nameAr: 'كبة', words: ['كبة', 'كبه'], section: 'breakfast', photos: [lib('kubba-1'), lib('kubba-2'), lib('kubba-3')] },
  { slug: 'falafel', nameAr: 'فلافل', words: ['فلافل'], section: 'breakfast', photos: [lib('falafel-1'), lib('falafel-2'), lib('falafel-3')] },
  { slug: 'hummus', nameAr: 'حمص', words: ['حمص'], section: 'breakfast', photos: [lib('hummus-1'), lib('hummus-2'), lib('hummus-3')] },
  { slug: 'salad', nameAr: 'زلاطة', words: ['زلاطة', 'سلطة', 'سلطه', 'زلاطه'], section: 'breakfast', photos: [lib('salad-1'), lib('salad-2'), lib('salad-3')] },
  { slug: 'fries', nameAr: 'چبس', words: ['چبس', 'جبس', 'بطاطا', 'فرايز'], section: 'breakfast', photos: [lib('fries-1'), lib('fries-2'), lib('fries-3')] },
  { slug: 'shawarma', nameAr: 'شاورما', words: ['شاورما', 'شاورمة', 'شاورمه'], section: 'fast', photos: [lib('shawarma-1'), lib('shawarma-2'), lib('shawarma-3')] },
  { slug: 'zinger', nameAr: 'زنگر', words: ['زنگر', 'زنجر', 'زنكر'], section: 'fast', photos: [lib('zinger-1'), lib('zinger-2'), lib('zinger-3')] },
  { slug: 'burger', nameAr: 'برگر', words: ['برگر', 'برجر', 'بركر', 'همبركر'], section: 'fast', photos: [lib('burger-1'), lib('burger-2'), lib('burger-3')] },
  { slug: 'pizza', nameAr: 'بيتزا', words: ['بيتزا', 'پيتزا'], section: 'fast', photos: [lib('pizza-1'), lib('pizza-2'), lib('pizza-3')] },
  { slug: 'baklava', nameAr: 'بقلاوة', words: ['بقلاوة', 'بقلاوه'], section: 'sweets', photos: [lib('baklava-1'), lib('baklava-2'), lib('baklava-3')] },
  { slug: 'kunafa', nameAr: 'كنافة', words: ['كنافة', 'كنافه'], section: 'sweets', photos: [lib('kunafa-1'), lib('kunafa-2'), lib('kunafa-3')] },
  { slug: 'zalabia', nameAr: 'زلابية', words: ['زلابية', 'زلابيه'], section: 'sweets', photos: [lib('zalabia-1'), lib('zalabia-2'), lib('zalabia-3')] },
  { slug: 'kleicha', nameAr: 'كليچة', words: ['كليچة', 'كليجة', 'كليجه'], section: 'sweets', photos: [lib('kleicha-1')] },
  { slug: 'tea', nameAr: 'چاي', words: ['چاي', 'شاي', 'جاي'], section: 'drinks', photos: [lib('tea-1'), lib('tea-2'), lib('tea-3')] },
  { slug: 'laban', nameAr: 'لبن', words: ['لبن', 'شنينة', 'شنينه'], section: 'drinks', photos: [lib('laban-1'), lib('laban-2'), lib('laban-3')] },
  { slug: 'orange-juice', nameAr: 'عصير برتقال', words: ['برتقال', 'عصير'], section: 'drinks', photos: [lib('orange-juice-1'), lib('orange-juice-2'), lib('orange-juice-3')] },
  { slug: 'cocktail', nameAr: 'كوكتيل', words: ['كوكتيل'], section: 'drinks', photos: [lib('cocktail-1'), lib('cocktail-2'), lib('cocktail-3')] },
];
