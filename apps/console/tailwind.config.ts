import type { Config } from 'tailwindcss';
import { fontFamily, motion, radius, space } from '@driver/design-tokens';
import { CONSOLE_ROLES } from './src/theme/palette';

const px = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, `${v}px`]));

/**
 * Only semantic roles exist as colours (generated from @driver/design-tokens into CSS variables by
 * `src/theme/palette.ts`); raw scales are deliberately not exposed, so a page can't reach for
 * `danger-500` and drift from the theme. `bg-accent/10` etc. work: the variables are RGB channels.
 */
const roles = Object.fromEntries(
  CONSOLE_ROLES.map((r) => [r, `rgb(var(--c-${r}) / <alpha-value>)`]),
);

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ...roles,
        // Legacy role names kept as aliases so every page restyles at once.
        bg: 'rgb(var(--c-canvas) / <alpha-value>)',
        'accent-strong': 'rgb(var(--c-accent-hover) / <alpha-value>)',
      },
      boxShadow: {
        card: 'var(--shadow-1)',
        pop: 'var(--shadow-2)',
        overlay: 'var(--shadow-3)',
        none: 'none',
      },
      spacing: px(space),
      borderRadius: px(radius),
      fontFamily: {
        sans: [...fontFamily.sans],
        display: [...fontFamily.display],
        mono: [...fontFamily.mono],
      },
      /**
       * Arabic-tuned type scale (S-19): Latin leading (1.33) clips ي/ج descenders and stacked dots, so
       * every size carries ~1.55–1.65 line height. `text-dense` is the table/queue size.
       */
      fontSize: {
        xs: ['12px', '20px'],
        dense: ['13px', '21px'],
        sm: ['14px', '22px'],
        base: ['15px', '25px'],
        lg: ['17px', '28px'],
        xl: ['20px', '32px'],
        '2xl': ['24px', '36px'],
        '3xl': ['28px', '40px'],
        '4xl': ['36px', '50px'],
        '5xl': ['48px', '60px'],
      },
      transitionTimingFunction: {
        standard: motion.easing.standard,
        decelerate: motion.easing.decelerate,
      },
      transitionDuration: { fast: `${motion.duration.fast}ms`, base: `${motion.duration.base}ms` },
      keyframes: {
        'pop-in': {
          from: { opacity: '0', transform: 'translateY(4px) scale(0.98)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'sheet-in': {
          from: { transform: 'translateX(-16px)', opacity: '0' },
          to: { transform: 'none', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '100% 0' },
          '100%': { backgroundPosition: '-100% 0' },
        },
      },
      animation: {
        'pop-in': `pop-in ${motion.duration.fast}ms ${motion.easing.decelerate}`,
        'fade-in': `fade-in ${motion.duration.fast}ms ${motion.easing.standard}`,
        'sheet-in': `sheet-in ${motion.duration.base}ms ${motion.easing.decelerate}`,
        shimmer: `shimmer ${motion.duration.shimmer}ms linear infinite`,
      },
    },
  },
  plugins: [],
} satisfies Config;
