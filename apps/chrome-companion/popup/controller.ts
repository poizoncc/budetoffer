import { isRecord } from "../shared/record.ts";

export type LocalApplication = {
  id: string;
  title: string;
  company?: string | null;
  status: string;
  version: number;
  source: string;
  externalId: string | number;
  canonicalUrl: string;
};
export type LocalPage = { url: string; title?: string; formDetected?: boolean };
export type LocalState = {
  application: LocalApplication | null;
  page: LocalPage | null;
  matches: number;
  total: number;
  busy: boolean;
  message: string;
  error: string;
  technicalError?: unknown;
  connection: { status: string } | null;
};
export type LocalControllerOptions = {
  request: (path: string, options?: RequestInit) => Promise<unknown>;
  readPage: () => Promise<LocalPage>;
  ready: () => Promise<unknown>;
  changed?: (state: LocalState) => void;
};

function applicationFrom(value: unknown): LocalApplication {
  if (!isRecord(value)) {
    throw new Error(
      "Некорректный ответ локального сервиса. Обновите выбранную заявку.",
    );
  }
  // The v1 API nests vacancy fields; retain compatibility with older flat records.
  const vacancy = isRecord(value.vacancy) ? value.vacancy : value;
  if (
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.status !== "string" ||
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    !(vacancy.title === null || typeof vacancy.title === "string") ||
    typeof vacancy.source !== "string" ||
    !(
      vacancy.canonicalUrl === null || typeof vacancy.canonicalUrl === "string"
    ) ||
    !(
      typeof vacancy.externalId === "string" ||
      typeof vacancy.externalId === "number"
    ) ||
    !(
      vacancy.company === undefined ||
      vacancy.company === null ||
      typeof vacancy.company === "string"
    )
  ) {
    throw new Error(
      "Некорректный ответ локального сервиса. Обновите выбранную заявку.",
    );
  }
  return {
    id: value.id,
    title: vacancy.title ?? "",
    status: value.status,
    version: value.version,
    source: vacancy.source,
    externalId: vacancy.externalId,
    canonicalUrl: vacancy.canonicalUrl ?? "",
    ...(vacancy.company === undefined ? {} : { company: vacancy.company }),
  };
}

function applicationPayload(value: unknown): { application: LocalApplication } {
  if (!isRecord(value)) {
    throw new Error(
      "Некорректный ответ локального сервиса. Обновите выбранную заявку.",
    );
  }
  return { application: applicationFrom(value.application) };
}

export function vacancyIdFromUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !(url.hostname === "hh.ru" || url.hostname.endsWith(".hh.ru"))
    ) {
      return null;
    }
    return /^\/vacancy\/(\d+)\/?$/u.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}
function matches(application: LocalApplication, id: string) {
  return (
    application.source === "hh.ru" &&
    String(application.externalId) === id &&
    vacancyIdFromUrl(application.canonicalUrl) === id
  );
}
// Sending remains in the main controlled apply workflow. The popup only
// stages/rejects/delays an explicitly matched application.
export function createCompanionController({
  request,
  readPage,
  ready,
  changed = () => {},
}: LocalControllerOptions) {
  const state: LocalState = {
    application: null,
    page: null,
    matches: 0,
    total: 0,
    busy: false,
    message: "",
    error: "",
    connection: null,
  };
  async function exclusive<T>(
    action: () => Promise<T>,
  ): Promise<T | undefined> {
    if (state.busy) return;
    state.busy = true;
    state.error = "";
    state.technicalError = null;
    changed(state);
    try {
      return await action();
    } catch (error) {
      state.technicalError = isRecord(error)
        ? (error.technicalDetail ?? null)
        : null;
      if (isRecord(error) && error.status === 409) {
        state.application = null;
        state.error =
          "Заявка изменилась. Обновите выбранную заявку и проверьте её перед повтором.";
      } else {
        state.error =
          (error instanceof Error && error.message) ||
          "Не удалось выполнить действие. Проверьте локальное подключение.";
      }
      throw error;
    } finally {
      state.busy = false;
      changed(state);
    }
  }
  async function load() {
    return exclusive(async () => {
      state.application = null;
      state.matches = 0;
      state.message = "";
      state.page = await readPage();
      const id = vacancyIdFromUrl(state.page?.url);
      if (!id) {
        throw new Error(
          "Откройте страницу конкретной вакансии HH, затем обновите выбранную заявку.",
        );
      }
      const found: LocalApplication[] = [];
      let total = 0;
      for (let offset = 0; ; offset += 100) {
        if (offset > 100000) {
          throw new Error(
            "Список слишком большой для проверки. Откройте точную карточку в локальном интерфейсе.",
          );
        }
        const payload = await request(
          `/applications?limit=100&offset=${offset}`,
        );
        if (!isRecord(payload) || !Array.isArray(payload.applications)) {
          throw new Error(
            "Некорректный список заявок. Обновите выбранную заявку.",
          );
        }
        const applications = payload.applications.map(applicationFrom);
        total += applications.length;
        found.push(
          ...applications.filter((application) => matches(application, id)),
        );
        if (applications.length < 100) break;
      }
      state.matches = found.length;
      state.total = total;
      if (found.length !== 1) {
        throw new Error(
          found.length
            ? "Для этой вакансии найдено несколько заявок. Выберите точную карточку в локальном интерфейсе."
            : "Для открытой вакансии заявка не найдена. Добавьте её через локальный интерфейс.",
        );
      }
      state.application = found[0];
      state.message =
        "Выбрана заявка открытой вакансии. Подготовка не отправляет отклик.";
      return state.application;
    });
  }
  async function check() {
    return exclusive(async () => {
      const connection = await ready();
      if (!isRecord(connection) || typeof connection.status !== "string") {
        throw new Error("Не удалось проверить состояние локального сервиса.");
      }
      state.connection = { status: connection.status };
      state.message =
        state.connection.status === "ok"
          ? "Локальные данные доступны. Готовность отправки проверяйте в карточке заявки."
          : "Локальные хранилища требуют внимания. Обновите состояние в интерфейсе.";
    });
  }
  async function act(action: "prepare" | "reject" | "delay", reason = "") {
    return exclusive(async () => {
      if (!["prepare", "reject", "delay"].includes(action)) {
        throw new Error(
          "Недопустимое действие. Отправка выполняется в локальном интерфейсе.",
        );
      }
      if (!state.application) {
        throw new Error(
          state.matches > 1
            ? "Для вакансии несколько заявок. Выберите точную карточку."
            : "Сначала обновите выбранную заявку открытой вакансии.",
        );
      }
      const page = await readPage();
      const id = vacancyIdFromUrl(page?.url);
      if (
        !id ||
        id !== vacancyIdFromUrl(state.page?.url) ||
        !matches(state.application, id)
      ) {
        state.application = null;
        throw new Error(
          "Активная страница изменилась. Обновите выбранную заявку.",
        );
      }
      const { application } = applicationPayload(
        await request(
          `/applications/${encodeURIComponent(state.application.id)}`,
        ),
      );
      if (
        !application ||
        !matches(application, id) ||
        application.version !== state.application.version ||
        application.status !== state.application.status
      ) {
        state.application = null;
        throw new Error(
          "Данные заявки изменились. Обновите выбранную заявку перед повтором.",
        );
      }
      if (action === "delay" && application.status !== "claimed") {
        throw new Error(
          "Сначала подготовьте заявку; отложить можно только заявку в работе.",
        );
      }
      if (action !== "delay" && application.status !== "pending") {
        throw new Error(
          "Это действие доступно только для заявки в очереди. Откройте её карточку.",
        );
      }
      if (action === "delay" && !reason.trim()) {
        throw new Error("Укажите причину, по которой заявка должна подождать.");
      }
      const toStatus = (
        { prepare: "claimed", reject: "cancelled", delay: "delayed" } as const
      )[action];
      let reasonDetail = reason.trim();
      if (action === "prepare") {
        reasonDetail = "Взято для ручной подготовки из локального помощника.";
      }
      if (action === "reject") {
        reasonDetail = "Отменено после проверки открытой вакансии.";
      }
      const payload = applicationPayload(
        await request(
          `/applications/${encodeURIComponent(application.id)}/transitions`,
          {
            method: "POST",
            headers: {
              "if-match": String(application.version),
              "idempotency-key": `companion-${action}-${application.id}-${application.version}`,
            },
            body: JSON.stringify({
              toStatus,
              reasonCode: `companion_${toStatus}`,
              reasonDetail,
            }),
          },
        ),
      );
      if (
        !matches(payload.application, id) ||
        payload.application.id !== application.id ||
        payload.application.status !== toStatus ||
        payload.application.version <= application.version
      ) {
        throw new Error(
          "Ответ об изменении заявки не подтверждён. Обновите её перед повтором.",
        );
      }
      state.application = payload.application;
      state.message = {
        prepare:
          "Заявка перенесена в работу. Отклик не отправлен; проверьте материалы в карточке.",
        reject: "Заявка отменена. Ничего не отправлялось.",
        delay: "Заявка отложена с указанной причиной. Отклик не отправлен.",
      }[action];
      return payload;
    });
  }
  return { state, load, check, act };
}
