import {CheckCircle2, ExternalLink, Monitor, ShieldAlert} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import type {CompanionStatus} from '../model/companion-popup';

export function CompanionReady({status, busy, onOpenCabinet}: {status: CompanionStatus; busy: boolean; onOpenCabinet: () => void}) {
  return <section className="space-y-4" aria-labelledby="companion-ready-title">
    <div className="flex items-start gap-3">
      <CheckCircle2 className="mt-1 size-6 shrink-0 text-primary" aria-hidden="true" />
      <div><h2 id="companion-ready-title" tabIndex={-1} className="text-xl font-semibold">Вход завершён</h2><p className="mt-1 text-sm text-muted-foreground">Расширение подключено к вашему кабинету.</p></div>
    </div>
    {status.requiresReconciliation ? <div className="rounded-xl border border-border bg-muted/50 p-4" role="status">
      <div className="flex items-center gap-2"><ShieldAlert className="size-5 shrink-0" aria-hidden="true" /><h3 className="font-semibold">Требуется сверка задания</h3></div>
      <p className="mt-2 text-sm">Проверьте результат в кабинете. Отправка с неизвестным результатом не повторяется автоматически.</p>
    </div> : <div className="rounded-xl border border-border p-4">
      <h3 className="font-semibold">Следующий шаг — в кабинете</h3>
      <p className="mt-2 text-sm text-muted-foreground">Проверьте аккаунт HH, резюме и настройки заданий. Вход в расширение сам по себе не запускает отправку откликов.</p>
    </div>}
    <Button className="w-full" disabled={busy} onClick={onOpenCabinet}>Открыть кабинет<ExternalLink className="size-4" aria-hidden="true" /></Button>
    <div className="flex items-start gap-3 rounded-xl bg-muted/50 p-3">
      <Monitor className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm">Компьютер должен быть включён, Chrome — открыт. Свернуть вкладку HH и это окно можно. Сон компьютера приостанавливает работу.</p>
    </div>
  </section>;
}
