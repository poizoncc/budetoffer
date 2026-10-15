import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@qrko/shared/lib/utils';

import {
  CONTROL_HEIGHT_CLASS,
  type ControlDensity,
} from '../form/fieldSurface';
import { useUiPresentation } from '../layout/UiPresentation';

const Tabs = TabsPrimitive.Root;

type TabsPresentation = 'legacy' | 'segmented';

interface TabsListProps extends React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.List
> {
  presentation?: TabsPresentation;
}

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, presentation: explicitPresentation, ...props }, ref) => {
  const inheritedPresentation = useUiPresentation();
  const presentation =
    explicitPresentation ??
    (inheritedPresentation === 'unified' ? 'segmented' : 'legacy');
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        presentation === 'segmented'
          ? 'inline-flex w-fit items-center justify-center gap-1 rounded-[var(--radius-pill)] bg-muted/70 p-1 text-muted-foreground mb-2'
          : 'flex items-center justify-center rounded-md bg-muted p-1 text-muted-foreground mb-2',
        className,
      )}
      {...props}
    />
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

interface TabsTriggerProps extends React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.Trigger
> {
  density?: ControlDensity;
  presentation?: TabsPresentation;
}

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(
  (
    {
      className,
      density = 'dense',
      presentation: explicitPresentation,
      ...props
    },
    ref,
  ) => {
    const inheritedPresentation = useUiPresentation();
    const presentation =
      explicitPresentation ??
      (inheritedPresentation === 'unified' ? 'segmented' : 'legacy');
    return (
      <TabsPrimitive.Trigger
        ref={ref}
        className={cn(
          presentation === 'segmented'
            ? cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-[var(--radius-pill)] px-4 text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm cursor-pointer',
                CONTROL_HEIGHT_CLASS[density],
              )
            : 'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm cursor-pointer',
          className,
        )}
        {...props}
      />
    );
  },
);
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn(className)} {...props} />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
