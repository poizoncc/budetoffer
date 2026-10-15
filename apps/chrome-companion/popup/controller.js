export function vacancyIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' ||url.username||url.password||url.port||url.hash|| !(url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru'))) return null;
    return /^\/vacancy\/(\d+)\/?$/u.exec(url.pathname)?.[1] ?? null;
  } catch { return null; }
}
function matches(application, id) {
  return application.source === 'hh.ru' && String(application.externalId) === id && vacancyIdFromUrl(application.canonicalUrl) === id;
}
// Sending remains in the main controlled apply workflow. The popup only
// stages/rejects/delays an explicitly matched application.
export function createCompanionController({ request, readPage, ready, changed = () => {} }) {
  const state = { application: null, page: null, matches: 0, total: 0, busy: false, message: '', error: '', connection: null };
  async function exclusive(action) {
    if (state.busy) return;
    state.busy = true; state.error = ''; state.technicalError = null; changed(state);
    try { return await action(); }
    catch (error) {
      state.technicalError = error.technicalDetail ?? null;
      if (error.status === 409) { state.application = null; state.error = 'Заявка изменилась. Обновите выбранную заявку и проверьте её перед повтором.'; }
      else state.error = error.message || 'Не удалось выполнить действие. Проверьте локальное подключение.';
      throw error;
    } finally { state.busy = false; changed(state); }
  }
  async function load() {
    return exclusive(async () => {
      state.application = null; state.matches = 0; state.message = '';
      state.page = await readPage();
      const id = vacancyIdFromUrl(state.page?.url);
      if (!id) throw new Error('Откройте страницу конкретной вакансии HH, затем обновите выбранную заявку.');
      const found = []; let total = 0;
      for (let offset = 0; ; offset += 100) {
        if (offset > 100000) throw new Error('Список слишком большой для проверки. Откройте точную карточку в локальном интерфейсе.');
        const { applications = [] } = await request(`/applications?limit=100&offset=${offset}`);
        total += applications.length; found.push(...applications.filter(application => matches(application, id)));
        if (applications.length < 100) break;
      }
      state.matches = found.length; state.total = total;
      if (found.length !== 1) throw new Error(found.length ? 'Для этой вакансии найдено несколько заявок. Выберите точную карточку в локальном интерфейсе.' : 'Для открытой вакансии заявка не найдена. Добавьте её через локальный интерфейс.');
      state.application = found[0]; state.message = 'Выбрана заявка открытой вакансии. Подготовка не отправляет отклик.';
      return state.application;
    });
  }
  async function check() {
    return exclusive(async () => {
      state.connection = await ready();
      state.message = state.connection.status === 'ok' ? 'Локальные данные доступны. Готовность отправки проверяйте в карточке заявки.' : 'Локальные хранилища требуют внимания. Обновите состояние в интерфейсе.';
    });
  }
  async function act(action, reason = '') {
    return exclusive(async () => {
      if (!['prepare', 'reject', 'delay'].includes(action)) throw new Error('Недопустимое действие. Отправка выполняется в локальном интерфейсе.');
      if (!state.application) throw new Error(state.matches > 1 ? 'Для вакансии несколько заявок. Выберите точную карточку.' : 'Сначала обновите выбранную заявку открытой вакансии.');
      const page = await readPage(); const id = vacancyIdFromUrl(page?.url);
      if (!id || id !== vacancyIdFromUrl(state.page?.url) || !matches(state.application, id)) {
        state.application = null; throw new Error('Активная страница изменилась. Обновите выбранную заявку.');
      }
      const { application } = await request(`/applications/${encodeURIComponent(state.application.id)}`);
      if (!application || !matches(application, id) || application.version !== state.application.version || application.status !== state.application.status) {
        state.application = null; throw new Error('Данные заявки изменились. Обновите выбранную заявку перед повтором.');
      }
      if (action === 'delay' && application.status !== 'claimed') throw new Error('Сначала подготовьте заявку; отложить можно только заявку в работе.');
      if (action !== 'delay' && application.status !== 'pending') throw new Error('Это действие доступно только для заявки в очереди. Откройте её карточку.');
      if (action === 'delay' && !reason.trim()) throw new Error('Укажите причину, по которой заявка должна подождать.');
      const toStatus = action === 'prepare' ? 'claimed' : action === 'reject' ? 'cancelled' : 'delayed';
      const payload = await request(`/applications/${encodeURIComponent(application.id)}/transitions`, {
        method: 'POST', headers: { 'if-match': String(application.version), 'idempotency-key': `companion-${action}-${application.id}-${application.version}` },
        body: JSON.stringify({ toStatus, reasonCode: `companion_${toStatus}`, reasonDetail: action === 'delay' ? reason.trim() : action === 'prepare' ? 'Взято для ручной подготовки из локального помощника.' : 'Отменено после проверки открытой вакансии.' })
      });
      state.application = payload.application;
      state.message = action === 'prepare' ? 'Заявка перенесена в работу. Отклик не отправлен; проверьте материалы в карточке.' : action === 'reject' ? 'Заявка отменена. Ничего не отправлялось.' : 'Заявка отложена с указанной причиной. Отклик не отправлен.';
      return payload;
    });
  }
  return { state, load, check, act };
}
