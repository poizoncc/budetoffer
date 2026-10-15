import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { cva } from 'class-variance-authority';
import { TbCheck, TbX as XIcon } from 'react-icons/tb';

import { cn } from '@qrko/shared/lib/utils';

import type { ControlDensity, ControlPresentation } from '../form/fieldSurface';
import { useUiPresentation } from '../layout/UiPresentation';

const rootVariants = cva(
  'peer relative inline-flex shrink-0 cursor-pointer items-center border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
  {
    variants: {
      labeled: {
        true: 'h-9 w-18 rounded-xl p-1',
        false: 'h-6 w-11 rounded-full',
      },
    },
    defaultVariants: { labeled: false },
  },
);

const thumbVariants = cva(
  'pointer-events-none flex items-center justify-center bg-background shadow-lg ring-0 transition-transform',
  {
    variants: {
      labeled: {
        true: 'h-6 w-10 rounded-lg data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
        false:
          'h-5 w-5 rounded-full data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
      },
    },
    defaultVariants: { labeled: false },
  },
);

const unifiedTrackVariants = cva(
  'pointer-events-none relative inline-flex shrink-0 items-center border-2 border-transparent transition-colors group-data-[state=checked]:bg-primary group-data-[state=unchecked]:bg-input',
  {
    variants: {
      labeled: {
        true: 'h-9 w-18 rounded-xl p-1',
        false: 'h-6 w-11 rounded-full',
      },
    },
    defaultVariants: { labeled: false },
  },
);

const SWITCH_HIT_CLASS: Record<
  ControlDensity,
  Record<'labeled' | 'plain', string>
> = {
  dense: {
    labeled: 'h-[var(--control-height-dense)] w-18 -my-0.5',
    plain: 'h-[var(--control-height-dense)] w-11 -my-2',
  },
  touch: {
    labeled: 'h-[var(--control-height-touch)] w-18 -my-1',
    plain: 'h-[var(--control-height-touch)] w-11 -my-2.5',
  },
};

interface SwitchProps extends React.ComponentPropsWithoutRef<
  typeof SwitchPrimitives.Root
> {
  labeled?: boolean;
  labelChecked?: React.ReactNode;
  labelUnchecked?: React.ReactNode;
  density?: ControlDensity;
  presentation?: ControlPresentation;
}

const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitives.Root>,
  SwitchProps
>(
  (
    {
      className,
      labeled,
      labelChecked,
      labelUnchecked,
      presentation: explicitPresentation,
      density = 'dense',
      ...props
    },
    ref,
  ) => {
    const presentation = useUiPresentation(explicitPresentation);

    const thumb = (
      <SwitchPrimitives.Thumb className={thumbVariants({ labeled: !!labeled })}>
        {labeled &&
          (props.checked
            ? (labelChecked ?? (
                <TbCheck className="size-3.5 text-muted-foreground" />
              ))
            : (labelUnchecked ?? (
                <XIcon className="size-3.5 text-muted-foreground" />
              )))}
      </SwitchPrimitives.Thumb>
    );

    if (presentation === 'legacy') {
      return (
        <SwitchPrimitives.Root
          className={cn(rootVariants({ labeled: !!labeled }), className)}
          {...props}
          ref={ref}
        >
          {thumb}
        </SwitchPrimitives.Root>
      );
    }

    const hitKind = labeled ? 'labeled' : 'plain';
    return (
      <SwitchPrimitives.Root
        className={cn(
          'group peer relative inline-flex shrink-0 cursor-pointer items-center justify-center bg-transparent ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
          SWITCH_HIT_CLASS[density][hitKind],
          className,
        )}
        {...props}
        ref={ref}
      >
        <span
          data-slot="switch-track"
          className={unifiedTrackVariants({ labeled: !!labeled })}
        >
          {thumb}
        </span>
      </SwitchPrimitives.Root>
    );
  },
);
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
