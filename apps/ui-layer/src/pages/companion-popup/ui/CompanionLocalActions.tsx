import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { useConfirmDialog } from "@/shared/ui/confirm-dialog";
import type {
  CompanionPopupClient,
  LocalCompanionController,
  LocalCompanionState,
} from "../model/companion-popup";

const labels: Record<string, string> = {
  pending: "В очереди",
  claimed: "В работе",
  delayed: "Отложена",
  applied: "Записана как отправленная",
  cancelled: "Отменена",
  failed: "Завершилась ошибкой",
};
const readonlyHints: Record<string, string> = {
  applied:
    "Отклик уже отмечен как отправленный. Подробности доступны в карточке.",
  delayed: "Заявка отложена. Вернуть её в очередь можно в карточке.",
  cancelled: "Заявка отменена. Проверьте историю в карточке.",
  failed: "Проверьте причину ошибки и дальнейшие действия в карточке.",
};
type LocalAction = "check" | "load" | "prepare" | "reject" | "delay" | "open";
const activityLabels: Record<LocalAction, string> = {
  check: "Проверяем подключение…",
  load: "Ищем заявку открытой вакансии…",
  prepare: "Переносим заявку в работу…",
  reject: "Подтвердите отмену заявки в диалоге.",
  delay: "Откладываем заявку…",
  open: "Открываем карточку…",
};
function selectionKey(state: LocalCompanionState | null) {
  const application = state?.application;
  return `${application?.id ?? ""}:${application?.version ?? ""}:${application?.status ?? ""}:${state?.page?.url ?? ""}`;
}
function snapshot(state: LocalCompanionState): LocalCompanionState {
  return {
    ...state,
    application: state.application ? { ...state.application } : null,
    page: state.page ? { ...state.page } : null,
    connection: state.connection ? { ...state.connection } : null,
  };
}

function localActivityMessage(
  state: LocalCompanionState | null,
  error: string,
  working: LocalAction | null,
): string {
  if (state?.error) return state.error;
  if (error) return error;
  if (working) return activityLabels[working];
  if (state?.busy) return "Проверяем выбранную заявку…";
  return (
    state?.message ||
    "Откройте вакансию HH и обновите её заявку из личной очереди."
  );
}

export function CompanionLocalActions({
  client,
}: {
  client: CompanionPopupClient;
}) {
  const [state, setState] = useState<LocalCompanionState | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState<LocalAction | null>(null);
  const controller = useRef<LocalCompanionController | null>(null);
  const lifetime = useRef<object | null>(null);
  const operation = useRef<object | null>(null);
  const reasonRevision = useRef(0);
  const selectedKey = selectionKey(state);
  const { confirm, confirmationDialog } = useConfirmDialog(selectedKey);

  useEffect(() => {
    const currentLifetime = {};
    lifetime.current = currentLifetime;
    controller.current = null;
    operation.current = null;
    setState(null);
    setError("");
    setWorking(null);
    if (client.createLocalController) {
      void client
        .createLocalController((next) => {
          if (lifetime.current === currentLifetime) {
            setState(snapshot(next));
            setError("");
          }
        })
        .then((next) => {
          if (lifetime.current === currentLifetime) {
            controller.current = next;
            setState(snapshot(next.state));
          }
        })
        .catch(() => {
          if (lifetime.current === currentLifetime) {
            setError(
              "Не удалось открыть личную очередь. Проверьте подключение и откройте расширение заново.",
            );
          }
        });
    }
    return () => {
      if (lifetime.current === currentLifetime) {
        lifetime.current = null;
        controller.current = null;
        operation.current = null;
      }
    };
  }, [client]);
  useEffect(() => {
    setReason("");
    reasonRevision.current++;
    setError("");
  }, [selectedKey]);

  async function run(action: LocalAction) {
    const current = controller.current;
    if (!current || operation.current || current.state.busy) return;
    const selected = current.state.application
      ? { ...current.state.application }
      : null;
    if (
      (action === "prepare" || action === "reject") &&
      selected?.status !== "pending"
    ) {
      return;
    }
    if (
      action === "delay" &&
      (selected?.status !== "claimed" || !reason.trim())
    ) {
      return;
    }
    if (action === "open" && !selected) return;
    const token = {};
    const startedLifetime = lifetime.current;
    const startedSelection = selectionKey(current.state);
    const startedReason = reasonRevision.current;
    operation.current = token;
    setWorking(action);
    setError("");
    const isCurrent = () =>
      lifetime.current === startedLifetime &&
      controller.current === current &&
      operation.current === token;
    try {
      if (action === "check" || action === "load") {
        await current[action]();
        return;
      }
      if (action === "open") {
        if (!selected) return;
        await client.open(
          `http://127.0.0.1:5173/application?applicationId=${encodeURIComponent(selected.id)}`,
        );
        return;
      }
      if (action === "reject") {
        if (!selected) return;
        const accepted = await confirm({
          title: "Отменить заявку?",
          description: `Отменить заявку «${selected.title || "Вакансия"}» в личной очереди? Отклик не отправляется.`,
          confirmLabel: "Отменить заявку",
          danger: true,
        });
        // The selected row may change while the confirmation dialog is open.
        if (
          !accepted ||
          !isCurrent() ||
          current.state.busy ||
          selectionKey(current.state) !== startedSelection ||
          current.state.application?.status !== "pending"
        ) {
          return;
        }
      }
      if (!isCurrent()) return;
      await current.act(action, action === "delay" ? reason.trim() : "");
    } catch {
      if (
        isCurrent() &&
        selectionKey(current.state) === startedSelection &&
        (action !== "delay" || reasonRevision.current === startedReason) &&
        !current.state.error
      ) {
        setError(
          action === "open"
            ? "Не удалось открыть карточку. Повторите действие."
            : "Результат действия не подтверждён. Обновите выбранную заявку перед повтором.",
        );
      }
    } finally {
      if (isCurrent()) {
        operation.current = null;
        setWorking(null);
      }
    }
  }

  const busy = Boolean(working || state?.busy);
  const application = state?.application;
  function handleLoad() {
    void run("load");
  }
  function handlePrepare() {
    void run("prepare");
  }
  function handleReject() {
    void run("reject");
  }
  function handleDelay() {
    void run("delay");
  }
  function handleOpen() {
    void run("open");
  }
  function handleCheck() {
    void run("check");
  }
  function handleReasonChange(event: ChangeEvent<HTMLTextAreaElement>) {
    reasonRevision.current++;
    setReason(event.target.value);
    setError("");
  }
  function renderApplicationActions() {
    if (!application) return null;
    if (application.status === "pending") {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Подготовка перенесёт заявку в работу. Отклик не отправляется.
          </p>
          <Button className="w-full" disabled={busy} onClick={handlePrepare}>
            Подготовить эту заявку
          </Button>
          <Button
            className="w-full"
            variant="danger"
            disabled={busy}
            onClick={handleReject}
          >
            Отменить эту заявку в очереди
          </Button>
        </div>
      );
    }
    if (application.status === "claimed") {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Заявка в работе. Подготовьте материалы в карточке или отложите её с
            причиной.
          </p>
          <label htmlFor="companion-delay-reason" className="block text-sm">
            Причина ожидания
          </label>
          <Textarea
            id="companion-delay-reason"
            value={reason}
            disabled={busy}
            onChange={handleReasonChange}
            placeholder="Что нужно проверить перед отправкой?"
            aria-describedby="companion-delay-help"
          />
          <p
            id="companion-delay-help"
            className="text-xs text-muted-foreground"
          >
            Укажите причину, чтобы отложить заявку.
          </p>
          <Button
            className="w-full"
            variant="secondary"
            disabled={busy || !reason.trim()}
            onClick={handleDelay}
          >
            Отложить заявку в работе
          </Button>
        </div>
      );
    }
    return (
      <p className="text-sm text-muted-foreground">
        {readonlyHints[application.status] ||
          "Для этого состояния действия доступны в карточке заявки."}
      </p>
    );
  }
  const selectionHint =
    state?.page && !state.error ? (
      <p className="text-sm text-muted-foreground">
        Заявка ещё не выбрана. Обновите данные для открытой вакансии.
      </p>
    ) : null;
  return (
    <section className="space-y-4" aria-labelledby="companion-local-title">
      <div>
        <h2 id="companion-local-title" className="text-lg font-semibold">
          Личная очередь на этом компьютере
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Отдельная очередь личного приложения. Эти заявки не относятся к
          очереди вашего кабинета BudetOffer.
        </p>
      </div>
      <p
        role={state?.error || error ? "alert" : "status"}
        className="rounded-xl border border-border bg-background p-3 text-sm"
      >
        {localActivityMessage(state, error, working)}
      </p>

      <div
        className="space-y-3 rounded-xl border border-border p-4"
        aria-labelledby="companion-page-title"
      >
        <h3 id="companion-page-title" className="text-sm font-semibold">
          Открытая страница
        </h3>
        {state?.page ? (
          <>
            <p className="text-sm">{state.page.title || "Вакансия HH"}</p>
            <p className="break-all text-xs text-muted-foreground">
              {state.page.url}
            </p>
            <p className="text-xs text-muted-foreground">
              {state.page.formDetected
                ? "Форма отклика найдена. Отправку проверяйте в карточке заявки."
                : "Форма отклика не найдена. Откройте карточку для проверки."}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Откройте конкретную вакансию на HH. Расширение найдёт заявку только
            для этой страницы.
          </p>
        )}
        <Button
          className="w-full"
          variant={application ? "secondary" : "primary"}
          disabled={!state || busy}
          loading={working === "load"}
          onClick={handleLoad}
        >
          Обновить заявку открытой вакансии
        </Button>
      </div>

      {application ? (
        <div
          className="space-y-3 rounded-xl border border-border p-4"
          aria-labelledby="companion-application-title"
        >
          <div>
            <h3
              id="companion-application-title"
              className="text-sm font-semibold"
            >
              Выбранная заявка
            </h3>
            <p className="mt-2 text-sm font-medium">
              {application.title || "Вакансия"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {application.company || "Компания не указана"}
            </p>
          </div>
          <p className="inline-flex rounded-lg bg-muted px-2 py-1 text-xs font-medium">
            {labels[application.status] || "Проверьте состояние в карточке"}
          </p>
          {renderApplicationActions()}
          <Button
            className="w-full"
            variant="secondary"
            disabled={busy}
            onClick={handleOpen}
          >
            Открыть выбранную карточку
          </Button>
        </div>
      ) : (
        selectionHint
      )}

      <div className="space-y-2 border-t border-border pt-3">
        <Button
          className="w-full"
          variant="secondary"
          disabled={!state || busy}
          onClick={handleCheck}
        >
          Проверить локальное подключение
        </Button>
        <p className="text-xs text-muted-foreground">
          Личное приложение должно работать на этом компьютере. Изменение заявки
          не отправляет отклик на HH.
        </p>
      </div>
      {confirmationDialog}
    </section>
  );
}
