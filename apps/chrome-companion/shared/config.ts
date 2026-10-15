export const BFF_BASE_URL = "http://127.0.0.1:6970";
export const BFF_API_URL = `${BFF_BASE_URL}/api/v1`;

export const ACTIVE_VACANCY_STATE_MESSAGE = "chairs:get-active-vacancy-state";

export const POPUP_COPY = Object.freeze({
  offline: "Локальное подключение недоступно. Запустите приложение и повторите проверку.",
  ready: "Локальные данные доступны.",
  noActiveTab: "Откройте страницу конкретной вакансии HH, затем обновите выбранную заявку.",
  delayedReason: "Отложено после ручной проверки открытой вакансии.",
  rejectedReason: "Отменено после ручной проверки открытой вакансии."
});
