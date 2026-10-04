import { t } from '@driver/i18n';

/**
 * The Driver mark (placeholder until the symbol is chosen — brand spec): the brand orange tile with
 * an ink route that draws the letter د — a pickup dot, the road, the drop-off.
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      focusable="false"
      className="shrink-0"
    >
      <rect x="0" y="0" width="32" height="32" rx="9" className="fill-accent" />
      <path
        d="M12.5 9.5c3.6 1.4 8 5.2 8.6 9.9.2 1.6-.8 2.6-2.4 2.6H10.5"
        fill="none"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-on-accent"
      />
      <circle cx="10.5" cy="9.5" r="2.1" className="fill-on-accent" />
    </svg>
  );
}

export function BrandWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <BrandMark />
      {compact ? null : (
        <span className="min-w-0 leading-tight">
          <span className="block text-[17px] font-bold tracking-[-0.01em] text-text">
            {t('console.brand')}
          </span>
          <span className="block truncate text-xs text-muted">{t('console.brand_sub')}</span>
        </span>
      )}
    </span>
  );
}
