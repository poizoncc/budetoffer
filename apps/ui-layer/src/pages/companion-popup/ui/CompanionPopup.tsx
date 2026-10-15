import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@qrko/uikit/shadcn/tabs";
import { Button } from "@/shared/ui/button";
import { useConfirmDialog } from "@/shared/ui/confirm-dialog";
import { useCompanionConnection } from "../model/companion-connection";
import type {
  CompanionPopupClient,
  CompanionPopupConfig,
} from "../model/companion-popup";
import { CompanionFrame } from "./CompanionFrame";
import { CompanionLogin } from "./CompanionLogin";
import { CompanionOnboarding } from "./CompanionOnboarding";
import { CompanionReady } from "./CompanionReady";
import { CompanionLocalActions } from "./CompanionLocalActions";
import { CompanionConnectionControls } from "./CompanionConnectionControls";

export function CompanionPopup({
  client,
  config,
}: {
  client: CompanionPopupClient;
  config: CompanionPopupConfig;
}) {
  const {
    status,
    stage,
    busy,
    checking,
    error,
    loginExpired,
    update,
    change,
    open,
  } = useCompanionConnection({ client, config });
  const [code, setCode] = useState("");
  const content = useRef<HTMLDivElement>(null);
  const { confirm, confirmationDialog } = useConfirmDialog(
    `${config.origin}:${status?.origin}:${status?.expiresAt}:${status?.pendingLogin?.userCode}:${status?.pendingLogin?.expiresAt}:${stage}`,
  );
  const localAvailable = !config.serverOnly && !!client.createLocalController;
  useEffect(() => {
    setCode("");
  }, [client, config.origin]);
  useEffect(() => {
    if (content.current?.parentElement) {
      content.current.parentElement.scrollTop = 0;
    }
    content.current
      ?.querySelector<HTMLElement>("h2")
      ?.focus({ preventScroll: true });
  }, [stage]);

  async function pair() {
    if (await change("chairs:pair-device", { code })) setCode("");
  }
  async function disconnect() {
    if (
      !(await confirm({
        title: status?.paired ? "Отключить расширение?" : "Отменить вход?",
        description:
          "Новые задания перестанут поступать в это расширение. Данные кабинета и незавершённые результаты сохранятся.",
        confirmLabel: status?.paired ? "Отключить" : "Отменить вход",
      }))
    ) {
      return;
    }
    await change("chairs:disconnect-device");
  }
  function handleRefresh() {
    void update();
  }
  function handleOpenCabinet() {
    void open(config.origin);
  }
  function handleStartLogin() {
    void change("chairs:start-device-login");
  }
  function handlePair() {
    void pair();
  }
  function handleAcceptOnboarding() {
    void change("chairs:accept-onboarding");
  }
  function handleDisconnect() {
    void disconnect();
  }
  function handleOpen(url: string) {
    void open(url);
  }
  const ready = status ? (
    <CompanionReady
      status={status}
      busy={busy}
      onOpenCabinet={handleOpenCabinet}
    />
  ) : null;
  const onboardingKey = `${status?.origin}:${status?.expiresAt}:${status?.onboardingVersion}:${status?.legalLinks?.termsUrl}:${status?.legalLinks?.privacyUrl}`;
  let connectionContent: ReactNode = null;
  switch (stage) {
    case "loading":
      connectionContent = (
        <section className="space-y-3">
          <h2 tabIndex={-1} className="text-xl font-semibold">
            Проверяем подключение
          </h2>
          <p className="text-sm text-muted-foreground">
            Проверяем вход и настройки расширения.
          </p>
        </section>
      );
      break;
    case "unavailable":
    case "conflict":
      connectionContent = (
        <section
          className="space-y-4"
          aria-labelledby="companion-unavailable-title"
        >
          <h2
            id="companion-unavailable-title"
            tabIndex={-1}
            className="text-xl font-semibold"
          >
            {stage === "conflict"
              ? "Проверьте кабинет"
              : "Не удалось проверить подключение"}
          </h2>
          <p role="alert" className="companion-notice text-sm">
            {stage === "conflict"
              ? "Состояние расширения не совпадает с выбранным кабинетом. Обновите статус или отключите расширение перед новым входом."
              : error ||
                "Повторите проверку. До подтверждения подключения действия в этом окне недоступны."}
          </p>
          <Button
            className="w-full"
            disabled={busy || checking}
            loading={checking}
            onClick={handleRefresh}
          >
            Проверить повторно
          </Button>
          <Button
            className="w-full"
            variant="secondary"
            onClick={handleOpenCabinet}
          >
            Открыть кабинет
          </Button>
          {status?.requiresReconciliation ? (
            <p className="text-sm text-muted-foreground">
              Незавершённое задание сохранено. Его результат нужно сверить в
              кабинете.
            </p>
          ) : null}
        </section>
      );
      break;
    case "login":
      if (status) {
        connectionContent = (
          <CompanionLogin
            config={config}
            status={status}
            busy={busy || checking}
            code={code}
            onCodeChange={setCode}
            onStart={handleStartLogin}
            onPair={handlePair}
            onRefresh={handleRefresh}
            onOpen={handleOpen}
            loginExpired={loginExpired}
            error={error || status.backgroundError}
          />
        );
      }
      break;
    case "onboarding":
      if (status) {
        connectionContent = (
          <>
            <CompanionOnboarding
              key={onboardingKey}
              origin={config.origin}
              legalLinks={status.legalLinks}
              busy={busy || checking}
              onAccept={handleAcceptOnboarding}
              onOpenDocument={handleOpen}
            />
            {error || status.backgroundError ? (
              <p role="alert" className="companion-notice mt-4 text-sm">
                {error || status.backgroundError}
              </p>
            ) : null}
          </>
        );
      }
      break;
    case "ready":
      connectionContent = (
        <>
          {error || status?.backgroundError ? (
            <p role="alert" className="companion-notice mb-4 text-sm">
              {error || status?.backgroundError}
            </p>
          ) : null}
          {localAvailable ? (
            <Tabs defaultValue="cabinet">
              <TabsList
                className="grid w-full grid-cols-2"
                aria-label="Работа расширения"
              >
                <TabsTrigger value="cabinet" density="touch">
                  Кабинет
                </TabsTrigger>
                <TabsTrigger value="local" density="touch">
                  Личная очередь
                </TabsTrigger>
              </TabsList>
              <TabsContent value="cabinet" className="pt-3">
                {ready}
              </TabsContent>
              <TabsContent value="local" className="pt-3">
                <CompanionLocalActions client={client} />
              </TabsContent>
            </Tabs>
          ) : (
            ready
          )}
        </>
      );
      break;
  }
  return (
    <CompanionFrame stage={stage} logoUrl={config.logoUrl}>
      <div ref={content}>{connectionContent}</div>
      <CompanionConnectionControls
        status={status}
        origin={config.origin}
        busy={busy}
        checking={checking}
        onRefresh={handleRefresh}
        onDisconnect={handleDisconnect}
      />
      {confirmationDialog}
    </CompanionFrame>
  );
}
