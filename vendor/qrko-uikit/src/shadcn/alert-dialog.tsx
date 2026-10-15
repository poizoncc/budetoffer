import * as React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';

import { cn } from '@qrko/shared/lib/utils';

import { useUiPresentation } from '../layout/UiPresentation';
import { buttonVariants } from './button';

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
const AlertDialogPortal = AlertDialogPrimitive.Portal;

type AlertDialogPresentation = 'legacy' | 'unified';

const AlertDialogPresentationContext =
  React.createContext<AlertDialogPresentation>('legacy');

const ALERT_DIALOG_OVERLAY_LEGACY_CLASS =
  'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0';

const ALERT_DIALOG_OVERLAY_UNIFIED_CLASS =
  'fixed inset-0 z-50 bg-black/80 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none motion-reduce:duration-0';

const AlertDialogOverlay = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => {
  const presentation = React.useContext(AlertDialogPresentationContext);

  return (
    <AlertDialogPrimitive.Overlay
      className={cn(
        presentation === 'unified'
          ? ALERT_DIALOG_OVERLAY_UNIFIED_CLASS
          : ALERT_DIALOG_OVERLAY_LEGACY_CLASS,
        className,
      )}
      {...props}
      ref={ref}
    />
  );
});
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

interface AlertDialogContentProps extends React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Content
> {
  presentation?: AlertDialogPresentation;
}

const ALERT_DIALOG_CONTENT_LEGACY_CLASS =
  'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg';

const ALERT_DIALOG_CONTENT_UNIFIED_CLASS =
  'fixed left-[50%] top-[50%] z-50 grid max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-[var(--radius-page)] border border-border bg-background p-6 shadow-[var(--shadow-surface)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] motion-reduce:animate-none motion-reduce:duration-0';

const AlertDialogContent = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Content>,
  AlertDialogContentProps
>(({ className, presentation: explicitPresentation, ...props }, ref) => {
  const presentation = useUiPresentation(explicitPresentation);
  return (
    <AlertDialogPresentationContext.Provider value={presentation}>
      <AlertDialogPortal>
        <AlertDialogOverlay />
        <AlertDialogPrimitive.Content
          ref={ref}
          className={cn(
            presentation === 'unified'
              ? ALERT_DIALOG_CONTENT_UNIFIED_CLASS
              : ALERT_DIALOG_CONTENT_LEGACY_CLASS,
            className,
          )}
          {...props}
        />
      </AlertDialogPortal>
    </AlertDialogPresentationContext.Provider>
  );
});
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const presentation = React.useContext(AlertDialogPresentationContext);

  return (
    <div
      className={cn(
        presentation === 'unified'
          ? 'flex flex-col gap-2 text-center sm:text-left'
          : 'flex flex-col space-y-2 text-center sm:text-left',
        className,
      )}
      {...props}
    />
  );
};
AlertDialogHeader.displayName = 'AlertDialogHeader';

const AlertDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const presentation = React.useContext(AlertDialogPresentationContext);

  return (
    <div
      className={cn(
        presentation === 'unified'
          ? 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'
          : 'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
        className,
      )}
      {...props}
    />
  );
};
AlertDialogFooter.displayName = 'AlertDialogFooter';

const AlertDialogTitle = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold', className)}
    {...props}
  />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName;

const AlertDialogAction = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => {
  const presentation = React.useContext(AlertDialogPresentationContext);

  return (
    <AlertDialogPrimitive.Action
      ref={ref}
      className={cn(
        buttonVariants(),
        presentation === 'unified' &&
          'min-h-[var(--control-height-touch)] w-full sm:w-auto',
        className,
      )}
      {...props}
    />
  );
});
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => {
  const presentation = React.useContext(AlertDialogPresentationContext);

  return (
    <AlertDialogPrimitive.Cancel
      ref={ref}
      className={cn(
        buttonVariants({ variant: 'outline' }),
        presentation === 'unified'
          ? 'min-h-[var(--control-height-touch)] w-full sm:w-auto'
          : 'mt-2 sm:mt-0',
        className,
      )}
      {...props}
    />
  );
});
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
