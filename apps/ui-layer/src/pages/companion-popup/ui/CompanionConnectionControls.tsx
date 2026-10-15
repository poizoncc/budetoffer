import { Button } from "@/shared/ui/button";
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
    <details className="companion-connection-controls border-t border-border pt-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
        Управление подключением
      </summary>
      <div className="space-y-3 pt-2">
        <div className="rounded-lg border border-border p-3 text-sm">
          <p className="font-semibold">Адрес кабинета</p>
          <p className="mt-1 break-words text-muted-foreground [overflow-wrap:anywhere]">
            {status?.origin || origin}
          </p>
          {deadline ? (
            <p className="mt-2 text-muted-foreground">
              Вход действует до {deadline}
            </p>
          ) : null}
        </div>
        <Button
          className="w-full"
          variant="secondary"
          disabled={busy || checking}
          loading={checking}
          onClick={onRefresh}
        >
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
              {status.paired ? "Отключить расширение" : "Отменить вход"}
            </Button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
