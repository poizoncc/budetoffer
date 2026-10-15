import * as React from "react";
import { Input as UiKitInput } from "@qrko/uikit/shadcn/input";

export function Input(props: React.ComponentProps<typeof UiKitInput>) {
  return <UiKitInput presentation="unified" {...props} />;
}
