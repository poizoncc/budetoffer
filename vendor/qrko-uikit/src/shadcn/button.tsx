import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { TbLoader } from 'react-icons/tb';

import { cn } from '@qrko/shared/lib/utils';

import {
  CONTROL_HEIGHT_CLASS,
  CONTROL_RADIUS_CLASS,
  type ControlPresentation,
} from '../form/fieldSurface';
import { useUiPresentation } from '../layout/UiPresentation';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-[var(--btn-h,2.5rem)] px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-8',
        icon: 'h-[var(--btn-h,2.5rem)] w-[var(--btn-h,2.5rem)]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  presentation?: ControlPresentation;
  shape?: keyof typeof CONTROL_RADIUS_CLASS;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      presentation: explicitPresentation,
      shape = 'standard',
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const presentation = useUiPresentation(explicitPresentation);

    const Comp = asChild ? Slot : 'button';
    const resolvedSize = size ?? 'default';
    const unifiedHeight =
      resolvedSize === 'lg'
        ? CONTROL_HEIGHT_CLASS.touch
        : CONTROL_HEIGHT_CLASS.dense;
    const buttonClassName =
      presentation === 'unified'
        ? cn(
            buttonVariants({ variant, size }),
            unifiedHeight,
            CONTROL_RADIUS_CLASS[shape],
            className,
          )
        : cn(buttonVariants({ variant, size, className }));
    // Slot requires exactly one React element child; the JSX expression
    // `{loading && <Loader/>}{children}` produces a two-element array even
    // when `loading` is false (`[false, children]`), tripping
    // `React.Children.only`. When `asChild` is set we forward `children`
    // unchanged — the spinner is incompatible with `asChild` anyway since
    // the consumer fully controls the rendered element.
    return (
      <Comp
        className={buttonClassName}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <TbLoader className="animate-spin" />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
