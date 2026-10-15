import * as React from 'react';
import { TbEye, TbEyeOff } from 'react-icons/tb';

import { cn } from '@qrko/shared/lib/utils';

import {
  CONTROL_HEIGHT_CLASS,
  CONTROL_SURFACE_CLASS,
  type ControlDensity,
  type ControlPresentation,
} from '../form/fieldSurface';
import { useUiPresentation } from '../layout/UiPresentation';

const INPUT_LEGACY_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const FLOATING_INPUT_LEGACY_CLASS =
  'peer flex h-12 w-full rounded-md border border-input bg-white dark:bg-input/30 p-3 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const PASSWORD_ACTION_SIZE_CLASS: Record<ControlDensity, string> = {
  dense: 'size-[var(--control-height-dense)]',
  touch: 'size-[var(--control-height-touch)]',
};

const PASSWORD_INPUT_PADDING_CLASS: Record<ControlDensity, string> = {
  dense: 'pr-[var(--control-height-dense)]',
  touch: 'pr-[var(--control-height-touch)]',
};

const UNIFIED_PASSWORD_ACTION_CLASS =
  'absolute right-0 top-0 flex items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export interface PasswordVisibilityLabels {
  show: string;
  hide: string;
}

type NativeInputType = React.ComponentProps<'input'>['type'];

interface InputBaseProps extends Omit<React.ComponentProps<'input'>, 'type'> {
  density?: ControlDensity;
}

interface LegacyInputProps extends InputBaseProps {
  passwordVisibilityLabels?: PasswordVisibilityLabels;
  presentation?: 'legacy';
  type?: NativeInputType;
}

type UnifiedPasswordVisibilityProps<TType extends NativeInputType> =
  TType extends 'password'
    ? { passwordVisibilityLabels: PasswordVisibilityLabels }
    : { passwordVisibilityLabels?: PasswordVisibilityLabels };

type PresentedInputProps<TType extends NativeInputType> = InputBaseProps &
  UnifiedPasswordVisibilityProps<TType> & {
    presentation: ControlPresentation;
    type?: TType;
  };

export type InputProps<TType extends NativeInputType = NativeInputType> =
  LegacyInputProps | PresentedInputProps<TType>;

interface InputImplementationProps extends InputBaseProps {
  passwordVisibilityLabels?: PasswordVisibilityLabels;
  presentation?: ControlPresentation;
  type?: NativeInputType;
}

const hasPasswordVisibilityLabels = (
  labels: PasswordVisibilityLabels | undefined,
): labels is PasswordVisibilityLabels =>
  typeof labels?.show === 'string' &&
  labels.show.trim().length > 0 &&
  typeof labels.hide === 'string' &&
  labels.hide.trim().length > 0;

const resolvePasswordPaddingClass = ({
  density,
  hasUnifiedAction,
  isPassword,
  presentation,
}: {
  density: ControlDensity;
  hasUnifiedAction: boolean;
  isPassword: boolean;
  presentation: ControlPresentation;
}) => {
  if (!isPassword) return undefined;
  if (presentation === 'legacy') return 'pr-10';
  return hasUnifiedAction ? PASSWORD_INPUT_PADDING_CLASS[density] : undefined;
};

const InputImplementation = React.forwardRef<
  HTMLInputElement,
  InputImplementationProps
>(
  (
    {
      className,
      density = 'dense',
      passwordVisibilityLabels,
      presentation: explicitPresentation,
      type,
      ...props
    },
    ref,
  ) => {
    const presentation = useUiPresentation(explicitPresentation);

    const [showPassword, setShowPassword] = React.useState(false);
    const isPassword = type === 'password';
    const hasUnifiedPasswordAction =
      presentation === 'unified' &&
      isPassword &&
      hasPasswordVisibilityLabels(passwordVisibilityLabels);
    // An inherited visual change must not remove an existing password action.
    const hasLegacyPasswordAction =
      isPassword &&
      (presentation === 'legacy' ||
        (explicitPresentation === undefined && !hasUnifiedPasswordAction));

    const handleToggle = () => setShowPassword((prev) => !prev);
    const handleToggleMouseDown: React.MouseEventHandler<HTMLButtonElement> = (
      event,
    ) => {
      event.preventDefault();
    };

    return (
      <div className="relative">
        <input
          type={isPassword && showPassword ? 'text' : type}
          className={cn(
            presentation === 'unified'
              ? cn(
                  'flex w-full px-3 py-2 ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground',
                  CONTROL_HEIGHT_CLASS[density],
                  CONTROL_SURFACE_CLASS,
                )
              : INPUT_LEGACY_CLASS,
            // See FloatingInput below — same autofill-tint suppression.
            'autofill:[-webkit-text-fill-color:inherit] autofill:[transition:background-color_9999s_ease-in-out_0s]',
            resolvePasswordPaddingClass({
              density,
              hasUnifiedAction: hasUnifiedPasswordAction,
              isPassword,
              presentation: hasLegacyPasswordAction ? 'legacy' : presentation,
            }),
            className,
          )}
          ref={ref}
          {...props}
        />
        {hasUnifiedPasswordAction && (
          <button
            type="button"
            aria-label={
              showPassword
                ? passwordVisibilityLabels.hide
                : passwordVisibilityLabels.show
            }
            aria-pressed={showPassword}
            disabled={props.disabled}
            onClick={handleToggle}
            onMouseDown={handleToggleMouseDown}
            className={cn(
              UNIFIED_PASSWORD_ACTION_CLASS,
              PASSWORD_ACTION_SIZE_CLASS[density],
            )}
          >
            {showPassword ? (
              <TbEyeOff aria-hidden="true" className="size-4" />
            ) : (
              <TbEye aria-hidden="true" className="size-4" />
            )}
          </button>
        )}
        {hasLegacyPasswordAction && (
          <button
            type="button"
            tabIndex={-1}
            onClick={handleToggle}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPassword ? (
              <TbEyeOff className="h-4 w-4" />
            ) : (
              <TbEye className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
    );
  },
);
interface InputComponent {
  (
    props: InputProps<undefined> & React.RefAttributes<HTMLInputElement>,
  ): React.ReactElement | null;
  <const TType extends NativeInputType>(
    props: InputProps<TType> & React.RefAttributes<HTMLInputElement>,
  ): React.ReactElement | null;
  displayName?: string;
}

const Input = InputImplementation as InputComponent;
Input.displayName = 'Input';

interface FloatingInputBaseProps extends Omit<
  React.ComponentProps<'input'>,
  'type'
> {
  density?: ControlDensity;
  label?: string;
  labelClassName?: string;
}

interface LegacyFloatingInputProps extends FloatingInputBaseProps {
  passwordVisibilityLabels?: PasswordVisibilityLabels;
  presentation?: 'legacy';
  type?: NativeInputType;
}

type UnifiedFloatingInputProps<TType extends NativeInputType> =
  FloatingInputBaseProps &
    UnifiedPasswordVisibilityProps<TType> & {
      presentation: ControlPresentation;
      type?: TType;
    };

export type FloatingInputProps<
  TType extends NativeInputType = NativeInputType,
> = LegacyFloatingInputProps | UnifiedFloatingInputProps<TType>;

interface FloatingInputImplementationProps extends FloatingInputBaseProps {
  passwordVisibilityLabels?: PasswordVisibilityLabels;
  presentation?: ControlPresentation;
  type?: NativeInputType;
}

const FloatingInputImplementation = React.forwardRef<
  HTMLInputElement,
  FloatingInputImplementationProps
>(
  (
    {
      className,
      density = 'dense',
      label,
      id,
      labelClassName,
      passwordVisibilityLabels,
      type,
      presentation: explicitPresentation,
      placeholder,
      onBlur,
      onFocus,
      ...props
    },
    ref,
  ) => {
    const presentation = useUiPresentation(explicitPresentation);

    const [showPassword, setShowPassword] = React.useState(false);
    const [isFocused, setIsFocused] = React.useState(false);
    const isPassword = type === 'password';
    const hasUnifiedPasswordAction =
      presentation === 'unified' &&
      isPassword &&
      hasPasswordVisibilityLabels(passwordVisibilityLabels);
    // An inherited visual change must not remove an existing password action.
    const hasLegacyPasswordAction =
      isPassword &&
      (presentation === 'legacy' ||
        (explicitPresentation === undefined && !hasUnifiedPasswordAction));

    const handleToggle = () => setShowPassword((prev) => !prev);
    const handleToggleMouseDown: React.MouseEventHandler<HTMLButtonElement> = (
      event,
    ) => {
      event.preventDefault();
    };
    const handleFocus: React.FocusEventHandler<HTMLInputElement> = (event) => {
      setIsFocused(true);
      onFocus?.(event);
    };
    const handleBlur: React.FocusEventHandler<HTMLInputElement> = (event) => {
      setIsFocused(false);
      onBlur?.(event);
    };
    const visiblePlaceholder = isFocused && placeholder ? placeholder : ' ';

    return (
      <div className="relative">
        <input
          id={id}
          type={isPassword && showPassword ? 'text' : type}
          placeholder={visiblePlaceholder}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={cn(
            presentation === 'unified'
              ? cn(
                  'peer flex w-full p-3 ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
                  CONTROL_HEIGHT_CLASS[density],
                  CONTROL_SURFACE_CLASS,
                )
              : FLOATING_INPUT_LEGACY_CLASS,
            // Suppress Chrome's blue/yellow autofill background. The
            // `transition: background-color 9999s` trick defers the UA
            // paint indefinitely, while -webkit-text-fill-color keeps
            // the text colour from being overridden too.
            'autofill:[-webkit-text-fill-color:inherit] autofill:[transition:background-color_9999s_ease-in-out_0s]',
            resolvePasswordPaddingClass({
              density,
              hasUnifiedAction: hasUnifiedPasswordAction,
              isPassword,
              presentation: hasLegacyPasswordAction ? 'legacy' : presentation,
            }),
            className,
          )}
          ref={ref}
          {...props}
        />
        {hasUnifiedPasswordAction && (
          <button
            type="button"
            aria-label={
              showPassword
                ? passwordVisibilityLabels.hide
                : passwordVisibilityLabels.show
            }
            aria-pressed={showPassword}
            disabled={props.disabled}
            onClick={handleToggle}
            onMouseDown={handleToggleMouseDown}
            className={cn(
              UNIFIED_PASSWORD_ACTION_CLASS,
              'z-10',
              PASSWORD_ACTION_SIZE_CLASS[density],
            )}
          >
            {showPassword ? (
              <TbEyeOff aria-hidden="true" className="size-4" />
            ) : (
              <TbEye aria-hidden="true" className="size-4" />
            )}
          </button>
        )}
        {hasLegacyPasswordAction && (
          <button
            type="button"
            tabIndex={-1}
            onClick={handleToggle}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-muted-foreground hover:text-foreground"
          >
            {showPassword ? (
              <TbEyeOff className="h-4 w-4" />
            ) : (
              <TbEye className="h-4 w-4" />
            )}
          </button>
        )}
        {/* Floating label — float-up rules + bg-masking the border live
            in `.floating-label` (theme.css) so we only ship the modifier
            class here. */}
        <label htmlFor={id} className={cn('floating-label', labelClassName)}>
          {label}
        </label>
      </div>
    );
  },
);
interface FloatingInputComponent {
  (
    props: FloatingInputProps<undefined> &
      React.RefAttributes<HTMLInputElement>,
  ): React.ReactElement | null;
  <const TType extends NativeInputType>(
    props: FloatingInputProps<TType> & React.RefAttributes<HTMLInputElement>,
  ): React.ReactElement | null;
  displayName?: string;
}

const FloatingInput = FloatingInputImplementation as FloatingInputComponent;
FloatingInput.displayName = 'FloatingInput';

export { Input, FloatingInput };
