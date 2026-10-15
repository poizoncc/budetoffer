import * as React from "react";
import { Button as UiKitButton } from "@qrko/uikit/shadcn/button";
import { cn } from "@/shared/lib/cn";

export type ButtonProps = Omit<React.ComponentProps<typeof UiKitButton>, "variant"> & {
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger";
};

export function Button({ children, loading = false, variant = "primary", className, ...props }: ButtonProps) {
  return (
    <UiKitButton
      aria-busy={loading || undefined}
      loading={loading}
      presentation="unified"
      className={cn('workspace-button', className)}
      variant={variant === "primary" ? "default" : variant === "danger" ? "destructive" : "secondary"}
      {...props}
    >
      {children}
    </UiKitButton>
  );
}
