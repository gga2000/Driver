/// <reference path="./images.d.ts" />
/**
 * The AI dish pictures (Ali, 2026-10-07: "let's use them all in the app"): one painted picture per kind of dish,
 * made with GPT Image in Higgsfield from one brief (`/mnt/project-files/illustrations/AI-ART-DIRECTION.md`), 512 px
 * webp with a transparent background. The 1024 px originals are in `/mnt/project-files/illustrations/ai/dishes/`.
 * To add one: export it 512 px webp into `photos/dishes/`, import it here, and give its kind a name in `dishes.tsx`.
 */
import baklava from './dishes/baklava.webp';
import bananamilk from './dishes/bananamilk.webp';
import beans from './dishes/beans.webp';
import biryani from './dishes/biryani.webp';
import breakfast from './dishes/breakfast.webp';
import cake from './dishes/cake.webp';
import chicken from './dishes/chicken.webp';
import cocktail from './dishes/cocktail.webp';
import coffee from './dishes/coffee.webp';
import dallah from './dishes/dallah.webp';
import dolma from './dishes/dolma.webp';
import falafel from './dishes/falafel.webp';
import fish from './dishes/fish.webp';
import grillTray from './dishes/grill-tray.webp';
import hummus from './dishes/hummus.webp';
import icecream from './dishes/icecream.webp';
import iced from './dishes/iced.webp';
import juice from './dishes/juice.webp';
import kebab from './dishes/kebab.webp';
import kleicha from './dishes/kleicha.webp';
import kubba from './dishes/kubba.webp';
import laban from './dishes/laban.webp';
import lemonade from './dishes/lemonade.webp';
import liver from './dishes/liver.webp';
import manakish from './dishes/manakish.webp';
import okra from './dishes/okra.webp';
import pacha from './dishes/pacha.webp';
import pickles from './dishes/pickles.webp';
import plate from './dishes/plate.webp';
import pomegranate from './dishes/pomegranate.webp';
import rice from './dishes/rice.webp';
import salad from './dishes/salad.webp';
import samoon from './dishes/samoon.webp';
import shawarma from './dishes/shawarma.webp';
import soda from './dishes/soda.webp';
import soup from './dishes/soup.webp';
import sweets from './dishes/sweets.webp';
import tea from './dishes/tea.webp';
import tikka from './dishes/tikka.webp';
import water from './dishes/water.webp';
import wrap from './dishes/wrap.webp';
import zalabia from './dishes/zalabia.webp';

export const DISH_PHOTOS = {
  baklava,
  bananamilk,
  beans,
  biryani,
  breakfast,
  cake,
  chicken,
  cocktail,
  coffee,
  dallah,
  dolma,
  falafel,
  fish,
  'grill-tray': grillTray,
  hummus,
  icecream,
  iced,
  juice,
  kebab,
  kleicha,
  kubba,
  laban,
  lemonade,
  liver,
  manakish,
  okra,
  pacha,
  pickles,
  plate,
  pomegranate,
  rice,
  salad,
  samoon,
  shawarma,
  soda,
  soup,
  sweets,
  tea,
  tikka,
  water,
  wrap,
  zalabia,
} as const;

export type DishPhotoName = keyof typeof DISH_PHOTOS;
