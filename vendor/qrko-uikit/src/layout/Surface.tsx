import type { HTMLAttributes } from 'react';
import { cva } from 'class-variance-authority';

import { cn } from '@qrko/shared/lib/utils';

export type SurfaceTone = 'standard' | 'muted' | 'primary';
export type SurfacePadding = 'compact' | 'default' | 'spacious' | 'none';

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  tone?: SurfaceTone;
  padding?: SurfacePadding;
  elevated?: boolean;
}

const surfaceVariants = cva('rounded-[var(--radius-page)] border', {
  variants: {
    tone: {
      standard: 'border-border bg-card text-card-foreground',
      muted: 'border-border/60 bg-muted text-foreground',
      primary: 'border-primary/20 bg-primary text-primary-foreground',
    },
    padding: {
      compact: 'p-4',
      default: 'p-6',
      spacious: 'p-8',
      none: 'p-0',
    },
    elevated: {
      true: 'shadow-[var(--shadow-surface)]',
      false: '',
    },
  },
  compoundVariants: [
    {
      tone: 'primary',
      elevated: true,
      className: 'shadow-[var(--shadow-primary)]',
    },
  ],
  defaultVariants: {
    tone: 'standard',
    padding: 'default',
    elevated: false,
  },
});

export const Surface = ({
  className,
  tone = 'standard',
  padding = 'default',
  elevated = false,
  ...props
}: SurfaceProps) => (
  <div
    {...props}
    className={cn(surfaceVariants({ elevated, padding, tone }), className)}
    data-elevated={elevated ? 'true' : 'false'}
    data-padding={padding}
    data-slot="surface"
    data-tone={tone}
  />
);
