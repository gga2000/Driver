/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets through require() */
/** The exported sticker files (joy g7), one `require` each so Metro bundles them. */
export const STICKER_FILES: Readonly<Record<string, number>> = {
  bil_afia: require('../../../assets/stickers/bil_afia.webp') as number,
  wasal_akil: require('../../../assets/stickers/wasal_akil.webp') as number,
  yumma: require('../../../assets/stickers/yumma.webp') as number,
  jay: require('../../../assets/stickers/jay.webp') as number,
  wasalt: require('../../../assets/stickers/wasalt.webp') as number,
  ala_hsabi: require('../../../assets/stickers/ala_hsabi.webp') as number,
  chai: require('../../../assets/stickers/chai.webp') as number,
  sahha: require('../../../assets/stickers/sahha.webp') as number,
};
