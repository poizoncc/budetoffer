import {useEffect, useRef, useState} from 'react';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@qrko/uikit/shadcn/tabs';
import {Button} from '@/shared/ui/button';
import {useConfirmDialog} from '@/shared/ui/confirm-dialog';
import {useCompanionConnection} from '../model/companion-connection';
import type {CompanionPopupClient, CompanionPopupConfig} from '../model/companion-popup';
import {CompanionFrame} from './CompanionFrame';
import {CompanionLogin} from './CompanionLogin';
import {CompanionOnboarding} from './CompanionOnboarding';
import {CompanionReady} from './CompanionReady';
import {CompanionLocalActions} from './CompanionLocalActions';
import {CompanionConnectionControls} from './CompanionConnectionControls';

export function CompanionPopup({client, config}: {client: CompanionPopupClient; config: CompanionPopupConfig}) {
  const {status, stage, busy, checking, error, loginExpired, update, change, open} = useCompanionConnection({client, config});
  const [code, setCode] = useState('');
  const content = useRef<HTMLDivElement>(null);
  const {confirm, confirmationDialog} = useConfirmDialog(`${config.origin}:${status?.origin}:${status?.expiresAt}:${status?.pendingLogin?.userCode}:${status?.pendingLogin?.expiresAt}:${stage}`);
  const localAvailable = !config.serverOnly && !!client.createLocalController;
  useEffect(() => {setCode('');}, [client, config.origin]);
  useEffect(() => {
    if (content.current?.parentElement) content.current.parentElement.scrollTop = 0;
    content.current?.querySelector<HTMLElement>('h2')?.focus({preventScroll: true});
  }, [stage]);

  async function pair() {
    if (await change('chairs:pair-device', {code})) setCode('');
  }
  async function disconnect() {
    if (!await confirm({title: status?.paired ? 'Отключить расширение?' : 'Отменить вход?', description: 'Новые задания перестанут поступать в это расширение. Данные кабинета и незавершённые результаты сохранятся.', confirmLabel: status?.paired ? 'Отключить' : 'Отменить вход'})) return;
    await change('chairs:disconnect-device');
  }
  const ready = status ? <CompanionReady status={status} busy={busy} onOpenCabinet={() => {void open(config.origin);}} /> : null;
  const onboardingKey = `${status?.origin}:${status?.expiresAt}:${status?.onboardingVersion}:${status?.legalLinks?.termsUrl}:${status?.legalLinks?.privacyUrl}`;
  return <CompanionFrame stage={stage} logoUrl={config.logoUrl}>
    <div ref={content}>
      {stage === 'loading' ? <section className="space-y-3"><h2 tabIndex={-1} className="text-xl font-semibold">Проверяем подключение</h2><p className="text-sm text-muted-foreground">Проверяем вход и настройки расширения.</p></section>
        : stage === 'unavailable' || stage === 'conflict' ? <section className="space-y-4" aria-labelledby="companion-unavailable-title">
          <h2 id="companion-unavailable-title" tabIndex={-1} className="text-xl font-semibold">{stage === 'conflict' ? 'Проверьте кабинет' : 'Не удалось проверить подключение'}</h2>
          <p role="alert" className="companion-notice text-sm">{stage === 'conflict' ? 'Состояние расширения не совпадает с выбранным кабинетом. Обновите статус или отключите расширение перед новым входом.' : error || 'Повторите проверку. До подтверждения подключения действия в этом окне недоступны.'}</p>
          <Button className="w-full" disabled={busy || checking} loading={checking} onClick={() => {void update();}}>Проверить повторно</Button>
          <Button className="w-full" variant="secondary" onClick={() => {void open(config.origin);}}>Открыть кабинет</Button>
          {status?.requiresReconciliation ? <p className="text-sm text-muted-foreground">Незавершённое задание сохранено. Его результат нужно сверить в кабинете.</p> : null}
        </section>
        : stage === 'login' && status ? <CompanionLogin config={config} status={status} busy={busy || checking} code={code} onCodeChange={setCode} onStart={() => {void change('chairs:start-device-login');}} onPair={() => {void pair();}} onRefresh={() => {void update();}} onOpen={url => {void open(url);}} loginExpired={loginExpired} error={error || status.backgroundError} />
        : stage === 'onboarding' && status ? <><CompanionOnboarding key={onboardingKey} origin={config.origin} legalLinks={status.legalLinks} busy={busy || checking} onAccept={() => {void change('chairs:accept-onboarding');}} onOpenDocument={url => {void open(url);}} />{error || status.backgroundError ? <p role="alert" className="companion-notice mt-4 text-sm">{error || status.backgroundError}</p> : null}</>
        : stage === 'ready' ? <>
          {error || status?.backgroundError ? <p role="alert" className="companion-notice mb-4 text-sm">{error || status?.backgroundError}</p> : null}
          {localAvailable ? <Tabs defaultValue="cabinet">
            <TabsList className="grid w-full grid-cols-2" aria-label="Работа расширения"><TabsTrigger value="cabinet" density="touch">Кабинет</TabsTrigger><TabsTrigger value="local" density="touch">Личная очередь</TabsTrigger></TabsList>
            <TabsContent value="cabinet" className="pt-3">{ready}</TabsContent>
            <TabsContent value="local" className="pt-3"><CompanionLocalActions client={client} /></TabsContent>
          </Tabs> : ready}
        </> : null}
    </div>
    <CompanionConnectionControls status={status} origin={config.origin} busy={busy} checking={checking} onRefresh={() => {void update();}} onDisconnect={() => {void disconnect();}} />
    {confirmationDialog}
  </CompanionFrame>;
}
