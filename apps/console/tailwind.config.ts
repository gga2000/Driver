import type { Config } from 'tailwindcss';
import { color, fontFamily, radius, space } from '@driver/design-tokens';

const px = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, `${v}px`]));

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { primary: color.primary, neutral: color.neutral, success: color.success, warning: color.warning, danger: color.danger },
      spacing: px(space),
      borderRadius: px(radius),
      fontFamily: { sans: [...fontFamily.sans], display: [...fontFamily.display], mono: [...fontFamily.mono] },
    },
  },
  plugins: [],
} satisfies Config;
