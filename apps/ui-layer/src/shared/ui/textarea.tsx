import type { ComponentProps } from 'react';
import { Textarea as UiKitTextarea } from '@qrko/uikit/shadcn/textarea';

export function Textarea(props: ComponentProps<typeof UiKitTextarea>) {
  return <UiKitTextarea presentation="unified" {...props} />;
}
