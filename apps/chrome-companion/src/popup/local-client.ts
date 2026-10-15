import type {CompanionPopupClient, LocalCompanionController, LocalCompanionPage, LocalCompanionState} from '@/pages/companion-popup';

export type ChromeLocalApi = {runtime: {getURL: (path: string) => string; sendMessage: CompanionPopupClient['send']}; tabs: {query: (options: {active: boolean; currentWindow: boolean}) => Promise<{id?: number; url?: string; frozen?: boolean; discarded?: boolean}[]>; sendMessage: (id: number, message: {type: string}) => Promise<LocalCompanionPage>}; scripting: {executeScript: (options: {target: {tabId: number}; files: string[]}) => Promise<unknown>}};
type LocalControllerModule = {vacancyIdFromUrl: (url: string | undefined) => string | null; createCompanionController: (options: {request: (path: string, options?: RequestInit) => Promise<unknown>; readPage: () => Promise<LocalCompanionPage>; ready: () => Promise<unknown>; changed: (state: LocalCompanionState) => void}) => LocalCompanionController};

export function localControllerFactory(chromeApi: ChromeLocalApi, accountOrigin: string): NonNullable<CompanionPopupClient['createLocalController']> {
  async function requireSetup() {
    const status = await chromeApi.runtime.sendMessage({type: 'chairs:device-status', origin: accountOrigin});
    if (!status?.ok || !status.paired || status.onboardingRequired !== false) throw new Error('Войдите в расширение и подтвердите условия перед локальными действиями.');
    if (status.origin !== accountOrigin) throw new Error('Расширение подключено к другому кабинету. Отключите его и войдите в выбранный кабинет перед локальными действиями.');
  }
  async function localFetch(path: string, options: RequestInit = {}) {
    await requireSetup();
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 15_000);
    try {
      const response = await fetch(`http://127.0.0.1:6970${path}`, {cache: 'no-store', ...options, credentials: 'omit', redirect: 'error', signal: abort.signal, headers: {...(options.body ? {'content-type': 'application/json'} : {}), ...options.headers}});
      let payload: {detail?: string; error?: string};
      try {payload = await response.json();} catch {throw new Error('Не удалось прочитать ответ локального сервиса. Обновите выбранную заявку перед повтором.');}
      if (!response.ok && !(path === '/health/ready' && response.status === 503)) {
        const messages: Record<number, string> = {401: 'Нет доступа к локальному сервису. Проверьте настройки подключения.', 403: 'Действие запрещено локальными настройками. Откройте карточку заявки.', 404: 'Запись больше не найдена. Обновите выбранную заявку.', 409: 'Заявка изменилась. Обновите её перед повтором.', 503: 'Локальный сервис недоступен. Проверьте состояние в интерфейсе.'};
        throw Object.assign(new Error(messages[response.status] || 'Локальный сервис не выполнил действие. Проверьте карточку перед повтором.'), {status: response.status, technicalDetail: payload.detail ?? payload.error});
      }
      return payload;
    } catch (error) {
      if (error instanceof Error && !(error instanceof TypeError) && error.name !== 'AbortError') throw error;
      throw new Error(options.method === 'POST' ? 'Ответ на изменение не получен. Обновите заявку и проверьте результат перед повтором.' : 'Не удалось прочитать локальные данные. Проверьте подключение.');
    } finally {clearTimeout(timeout);}
  }
  return async changed => {
    await requireSetup();
    const controllerUrl = chromeApi.runtime.getURL('popup/controller.js');
    const controller = await import(/* @vite-ignore */ controllerUrl) as LocalControllerModule;
    async function activeVacancy() {
      const [tab] = await chromeApi.tabs.query({active: true, currentWindow: true});
      if (!Number.isInteger(tab?.id) || !controller.vacancyIdFromUrl(tab?.url)) throw new Error('Откройте страницу конкретной вакансии HH, затем обновите выбранную заявку.');
      if (tab.frozen || tab.discarded) throw new Error('Chrome приостановил вкладку HH. Откройте её и обновите выбранную заявку перед действием.');
      return tab as typeof tab & {id: number; url: string};
    }
    async function readPage() {
      await requireSetup();
      const tab = await activeVacancy();
      let page: LocalCompanionPage;
      try {page = await chromeApi.tabs.sendMessage(tab.id, {type: 'chairs:get-active-vacancy-state'});}
      catch (error) {
        if (!/Receiving end does not exist|Could not establish connection/.test(String((error as Error)?.message))) throw error;
        const current = await activeVacancy();
        if (current.id !== tab.id || current.url !== tab.url) throw new Error('Активная страница изменилась. Обновите выбранную заявку.');
        await chromeApi.scripting.executeScript({target: {tabId: tab.id}, files: ['hh/content.js']});
        page = await chromeApi.tabs.sendMessage(tab.id, {type: 'chairs:get-active-vacancy-state'});
      }
      const current = await activeVacancy();
      if (current.id !== tab.id || current.url !== tab.url || page?.url !== tab.url) throw new Error('Активная страница изменилась. Обновите выбранную заявку.');
      await requireSetup();
      return page;
    }
    return controller.createCompanionController({request: (path, options) => localFetch(`/api/v1${path}`, options), ready: () => localFetch('/health/ready'), readPage, changed});
  };
}
