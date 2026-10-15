import { SERVER_ORIGIN } from "./destinations.ts";
import { resolveCompanionEwans } from "../../../packages/ewans/src/index.ts";

export { SERVER_ORIGIN, COMPANION_ORIGINS } from "./destinations.ts";

// The packaged destination controls both the worker and the popup. Loopback
// is used only when an explicitly Local build sets SERVER_ORIGIN to null.
export const BFF_BASE_URL = SERVER_ORIGIN ?? "http://127.0.0.1:6970";
export const BFF_API_URL = `${BFF_BASE_URL}/api/v1`;

export const ACTIVE_VACANCY_STATE_MESSAGE = "chairs:get-active-vacancy-state";

export const POPUP_COPY = Object.freeze({
  offline: SERVER_ORIGIN
    ? resolveCompanionEwans("network_unavailable")
    : "Локальное подключение недоступно. Запустите приложение и повторите проверку.",
  ready: SERVER_ORIGIN ? "Сервис доступен." : "Локальные данные доступны.",
  noActiveTab:
    "Откройте страницу конкретной вакансии HH, затем обновите выбранную заявку.",
  delayedReason: "Отложено после ручной проверки открытой вакансии.",
  rejectedReason: "Отменено после ручной проверки открытой вакансии.",
});
