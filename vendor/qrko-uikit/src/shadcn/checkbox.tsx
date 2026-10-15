import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { TbCheck } from 'react-icons/tb';

import { cn } from '@qrko/shared/lib/utils';

import type { ControlDensity, ControlPresentation } from '../form/fieldSurface';
import { useUiPresentation } from '../layout/UiPresentation';

const CHECKBOX_HIT_CLASS: Record<ControlDensity, string> = {
  dense: 'size-[var(--control-height-dense)] -m-3',
  touch: 'size-[var(--control-height-touch)] -m-3.5',
};

interface CheckboxProps extends React.ComponentPropsWithoutRef<
  typeof CheckboxPrimitive.Root
> {
  density?: ControlDensity;
  presentation?: ControlPresentation;
}

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(
  (
    {
      className,
      presentation: explicitPresentation,
      density = 'dense',
      ...props
    },
    ref,
  ) => {
    const presentation = useUiPresentation(explicitPresentation);

    if (presentation === 'legacy') {
      return (
        <CheckboxPrimitive.Root
          ref={ref}
          className={cn(
            'peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
            className,
          )}
          {...props}
        >
          <CheckboxPrimitive.Indicator
            className={cn('flex items-center justify-center text-current')}
          >
            <TbCheck className="h-4 w-4" />
          </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
      );
    }

    return (
      <CheckboxPrimitive.Root
        ref={ref}
        className={cn(
          'group peer relative flex shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-transparent bg-transparent ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          CHECKBOX_HIT_CLASS[density],
          className,
        )}
        {...props}
      >
        <span
          data-slot="checkbox-surface"
          className="pointer-events-none flex size-4 items-center justify-center rounded-sm border border-primary text-primary-foreground group-data-[state=checked]:bg-primary"
        >
          <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
            <TbCheck className="h-4 w-4" />
          </CheckboxPrimitive.Indicator>
        </span>
      </CheckboxPrimitive.Root>
    );
  },
);
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
