import { Surface } from "@qrko/uikit/layout/Surface";
import { RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
} from "@/shared/ui/disclosure";
import type { CompanionStatus } from "../model/companion-popup";

export function CompanionConnectionControls({
  status,
  origin,
  busy,
  checking,
  onRefresh,
  onDisconnect,
}: {
  status: CompanionStatus | null;
  origin: string;
  busy: boolean;
  checking: boolean;
  onRefresh: () => void;
  onDisconnect: () => void;
}) {
  const expires = status?.expiresAt ? new Date(status.expiresAt) : null;
  const deadline =
    expires && Number.isFinite(expires.getTime())
      ? expires.toLocaleString("ru-RU", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  return (
    <Disclosure className="border-t border-border pt-3">
      <DisclosureTrigger className="min-h-11 text-sm font-semibold">
        Управление подключением
      </DisclosureTrigger>
      <DisclosureContent className="space-y-3 pt-2">
        <Surface
          padding="compact"
          className="rounded-[var(--radius-panel)] text-sm"
        >
          <dl className="space-y-2">
            <div>
              <dt className="font-semibold">Адрес кабинета</dt>
              <dd className="mt-1 break-words text-muted-foreground [overflow-wrap:anywhere]">
                {status?.origin || origin}
              </dd>
            </div>
            {deadline ? (
              <div>
                <dt className="text-muted-foreground">Вход действует до</dt>
                <dd>
                  <time dateTime={expires?.toISOString()}>{deadline}</time>
                </dd>
              </div>
            ) : null}
          </dl>
        </Surface>
        <Button
          className="w-full"
          variant="secondary"
          disabled={busy || checking}
          loading={checking}
          onClick={onRefresh}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Обновить статус
        </Button>
        {status?.paired || status?.pendingLogin ? (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm text-muted-foreground">
              Отключение остановит получение новых заданий этим расширением.
              Результаты в кабинете сохранятся.
            </p>
            <Button
              className="w-full"
              variant="secondary"
              disabled={busy || checking}
              onClick={onDisconnect}
            >
              <Unplug className="size-4" aria-hidden="true" />
              {status.paired ? "Отключить расширение" : "Отменить вход"}
            </Button>
          </div>
        ) : null}
      </DisclosureContent>
    </Disclosure>
  );
}
