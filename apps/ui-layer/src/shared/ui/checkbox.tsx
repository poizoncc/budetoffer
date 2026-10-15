import type { ComponentProps } from "react";
import { Checkbox as UiKitCheckbox } from "@qrko/uikit/shadcn/checkbox";
import { cn } from "@/shared/lib/cn";

type CheckboxProps = Omit<
  ComponentProps<typeof UiKitCheckbox>,
  "onCheckedChange"
> & {
  onCheckedChange?: (checked: boolean) => void;
};

export function Checkbox({
  onCheckedChange,
  className,
  ...props
}: CheckboxProps) {
  return (
    <UiKitCheckbox
      presentation="unified"
      {...props}
      className={cn("m-0", className)}
      onCheckedChange={(checked) => onCheckedChange?.(checked === true)}
    />
  );
}
