import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@qrko/uikit/shadcn/alert-dialog";
import { Button } from "./button";

type ConfirmationOptions = {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
};

type ConfirmationRequest = ConfirmationOptions & { opener: HTMLElement | null };

export function useConfirmDialog(scope?: string) {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);
  const mounted = useRef(true);
  const finish = useCallback((confirmed: boolean) => {
    const resolve = pending.current;
    if (!resolve) return;
    pending.current = null;
    setRequest(null);
    resolve(confirmed);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.(false);
      pending.current = null;
    };
  }, []);
  useEffect(() => {
    finish(false);
  }, [scope, finish]);

  const confirm = useCallback(
    (options: ConfirmationOptions): Promise<boolean> => {
      if (!mounted.current || pending.current) return Promise.resolve(false);
      return new Promise((resolve) => {
        pending.current = resolve;
        setRequest({
          ...options,
          opener:
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null,
        });
      });
    },
    [],
  );

  const confirmationDialog = request ? (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) finish(false);
      }}
    >
      <AlertDialogContent
        presentation="unified"
        className="gap-5"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (request.opener?.isConnected) request.opener.focus();
        }}
      >
        <AlertDialogTitle className="pr-2 text-xl leading-7">
          {request.title}
        </AlertDialogTitle>
        <AlertDialogDescription className="max-h-[min(50dvh,24rem)] overflow-y-auto whitespace-pre-wrap break-words text-base leading-7">
          {request.description}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button
              type="button"
              variant="secondary"
              onClick={() => finish(false)}
            >
              Отмена
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction
            asChild
            className={
              request.danger
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            <Button
              type="button"
              variant={request.danger ? "danger" : "primary"}
              onClick={() => finish(true)}
            >
              {request.confirmLabel}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;
  return { confirm, confirmationDialog };
}
