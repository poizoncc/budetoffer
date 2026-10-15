export type ControlDensity = 'dense' | 'touch';
export type ControlPresentation = 'legacy' | 'unified';

export const CONTROL_HEIGHT_CLASS: Record<ControlDensity, string> = {
  dense: 'h-[var(--control-height-dense)]',
  touch: 'h-[var(--control-height-touch)]',
};

// Multiline controls derive their height from rows; density is only a minimum.
export const TEXTAREA_MIN_HEIGHT_CLASS: Record<ControlDensity, string> = {
  dense: 'min-h-20',
  touch: 'min-h-24',
};

export const CONTROL_RADIUS_CLASS = {
  pill: 'rounded-[var(--radius-pill)]',
  standard: 'rounded-[var(--radius-control)]',
} as const;

export const CONTROL_SURFACE_CLASS =
  'rounded-[var(--radius-control)] border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export const FIELD_SURFACE_BG = 'bg-white dark:bg-input/30';

export const FIELD_LEGEND_CLASS =
  'pointer-events-none absolute -top-2 left-3 px-2 text-xs leading-4 text-primary first-letter:uppercase';
