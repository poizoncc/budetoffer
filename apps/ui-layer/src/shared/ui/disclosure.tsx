import {
  createContext,
  useContext,
  useState,
  type ComponentProps,
} from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@qrko/uikit/shadcn/collapsible";
import { cn } from "@/shared/lib/cn";

const DisclosureOpen = createContext(false);

export function Disclosure({
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  ...props
}: ComponentProps<typeof Collapsible>) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  return (
    <DisclosureOpen.Provider value={open}>
      <Collapsible
        {...props}
        open={open}
        onOpenChange={(next) => {
          setLocalOpen(next);
          onOpenChange?.(next);
        }}
      />
    </DisclosureOpen.Provider>
  );
}

export function DisclosureTrigger({
  className,
  children,
  asChild,
  ...props
}: ComponentProps<typeof CollapsibleTrigger>) {
  if (asChild) {
    return (
      <CollapsibleTrigger asChild className={className} {...props}>
        {children}
      </CollapsibleTrigger>
    );
  }
  return (
    <CollapsibleTrigger
      type="button"
      className={cn(
        "flex min-h-10 w-full items-center gap-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&[data-state=open]>svg]:rotate-180",
        className,
      )}
      {...props}
    >
      <ChevronDown
        aria-hidden="true"
        className="size-4 shrink-0 transition-transform"
      />
      {children}
    </CollapsibleTrigger>
  );
}

export function DisclosureContent(
  props: ComponentProps<typeof CollapsibleContent>,
) {
  const open = useContext(DisclosureOpen);
  // Retain drafts and state when folded, as native details did.
  return <CollapsibleContent {...props} forceMount hidden={!open} />;
}
