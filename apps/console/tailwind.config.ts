import type { Config } from 'tailwindcss';
import { color, fontFamily, radius, space } from '@driver/design-tokens';

const px = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, `${v}px`]));

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: color.primary,
        neutral: color.neutral,
        success: color.success,
        warning: color.warning,
        danger: color.danger,
        // Theme roles: CSS variables defined once in globals.css (brand swap = one file).
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-2': 'var(--color-surface-2)',
        line: 'var(--color-line)',
        text: 'var(--color-text)',
        muted: 'var(--color-muted)',
        faint: 'var(--color-faint)',
        accent: 'var(--color-accent)',
        'accent-strong': 'var(--color-accent-strong)',
        'on-accent': 'var(--color-on-accent)',
        ok: 'var(--color-success)',
        bad: 'var(--color-danger)',
      },
      boxShadow: { card: 'var(--shadow-card)' },
      spacing: px(space),
      borderRadius: px(radius),
      fontFamily: { sans: [...fontFamily.sans], display: [...fontFamily.display], mono: [...fontFamily.mono] },
    },
  },
  plugins: [],
} satisfies Config;
