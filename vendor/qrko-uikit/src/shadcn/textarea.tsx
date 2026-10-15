import * as React from 'react';

import { cn } from '@qrko/shared/lib/utils';

import {
  CONTROL_SURFACE_CLASS,
  TEXTAREA_MIN_HEIGHT_CLASS,
  type ControlDensity,
  type ControlPresentation,
} from '../form/fieldSurface';
import { useUiPresentation } from '../layout/UiPresentation';

const TEXTAREA_LEGACY_CLASS =
  'flex min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export interface TextareaProps extends React.ComponentProps<'textarea'> {
  density?: ControlDensity;
  presentation?: ControlPresentation;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      density = 'dense',
      rows = 4,
      presentation: explicitPresentation,
      ...props
    },
    ref,
  ) => {
    const presentation = useUiPresentation(explicitPresentation);

    return (
      <textarea
        rows={rows}
        className={cn(
          presentation === 'unified'
            ? cn(
                'flex w-full resize-y px-3 py-2 ring-offset-background placeholder:text-muted-foreground',
                TEXTAREA_MIN_HEIGHT_CLASS[density],
                CONTROL_SURFACE_CLASS,
              )
            : TEXTAREA_LEGACY_CLASS,
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
