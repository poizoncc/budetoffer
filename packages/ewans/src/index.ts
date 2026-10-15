export type EwansStatus =
  "error" | "warning" | "alert" | "notification" | "success";

/** The six-field QRKO EWANS wire contract, independent of HTTP frameworks. */
export type EwansDescriptor = Readonly<{
  code: string;
  message: string;
  status: EwansStatus;
  group: string;
  key: string;
  httpStatus: number;
}>;

type CatalogEntry = Readonly<{
  descriptor: EwansDescriptor;
  nextAction: string;
}>;

function entry(
  code: string,
  key: string,
  httpStatus: number,
  message: string,
  nextAction: string,
  status: EwansStatus = "error",
): CatalogEntry {
  return Object.freeze({
    descriptor: Object.freeze({
      code,
      message,
      status,
      group: "COMPANION",
      key,
      httpStatus,
    }),
    nextAction,
  });
}

// Codes are persistent support identifiers. New entries must not renumber them.
const ENTRIES: readonly CatalogEntry[] = [
  entry(
    "BO-COMP-001",
    "invalid_pairing",
    400,
    "Код подключения введён неверно.",
    "Скопируйте код из кабинета или получите новый код входа в расширении.",
  ),
  entry(
    "BO-COMP-002",
    "pairing_rejected",
    409,
    "Подключение не подтверждено.",
    "Получите новый код входа в расширении и подтвердите его в своём кабинете.",
  ),
  entry(
    "BO-COMP-003",
    "login_expired",
    410,
    "Срок кода входа истёк.",
    "Получите новый код в расширении и подтвердите вход, пока код действует.",
    "warning",
  ),
  entry(
    "BO-COMP-004",
    "companion_busy",
    409,
    "Расширение уже выполняет действие.",
    "Дождитесь завершения и проверьте состояние подключения перед повтором.",
    "warning",
  ),
  entry(
    "BO-COMP-005",
    "device_not_paired",
    401,
    "Chrome ещё не подключён к кабинету.",
    "Получите код входа в расширении и подтвердите его в своём кабинете.",
  ),
  entry(
    "BO-COMP-006",
    "invalid_response",
    502,
    "Ответ сервиса не удалось проверить.",
    "Обновите состояние в кабинете. Перед повтором действия проверьте, сохранился ли результат.",
  ),
  entry(
    "BO-COMP-007",
    "device_login_unavailable",
    503,
    "Сервис подключения Chrome временно недоступен.",
    "Проверьте интернет и повторите получение кода позже.",
  ),
  entry(
    "BO-COMP-008",
    "network_unavailable",
    503,
    "Ответ сервера не получен.",
    "Проверьте интернет и состояние задания в кабинете перед повтором действия.",
  ),
  entry(
    "BO-COMP-009",
    "connection_unavailable",
    503,
    "Не удалось проверить подключение Chrome.",
    "Откройте расширение BudetOffer на компьютере и повторите проверку подключения.",
  ),
  entry(
    "BO-COMP-010",
    "onboarding_required",
    409,
    "Настройка расширения ещё не завершена.",
    "Откройте BudetOffer в Chrome и подтвердите обязательные условия подключения.",
    "warning",
  ),
  entry(
    "BO-COMP-011",
    "hh_account_unverified",
    409,
    "Аккаунт HH ещё не подтверждён.",
    "Войдите в HH в подключённом Chrome, затем обновите состояние проверки в кабинете.",
    "warning",
  ),
  entry(
    "BO-COMP-012",
    "device_unauthorized",
    401,
    "Подключение расширения отозвано или срок входа истёк.",
    "Войдите в расширение заново. Незавершённые задания сохраняются для сверки.",
  ),
  entry(
    "BO-COMP-013",
    "account_inactive",
    401,
    "Аккаунт кабинета недоступен.",
    "Войдите в свой кабинет и проверьте доступ у команды BudetOffer.",
  ),
  entry(
    "BO-COMP-014",
    "device_login_rate_limited",
    429,
    "Слишком много попыток подключения.",
    "Подождите и повторите проверку. Не запрашивайте новые коды подряд.",
    "warning",
  ),
  entry(
    "BO-COMP-015",
    "invalid_device_login",
    400,
    "Запрос входа в расширение некорректен.",
    "Получите новый код в расширении и подтвердите его в своём кабинете.",
  ),
  entry(
    "BO-COMP-016",
    "invalid_device_login",
    404,
    "Код входа не найден или уже недействителен.",
    "Получите новый код в расширении и подтвердите его в своём кабинете.",
    "warning",
  ),
  entry(
    "BO-COMP-017",
    "device_not_found",
    404,
    "Подключение Chrome не найдено.",
    "Обновите список подключений в кабинете и выберите действующее устройство.",
    "warning",
  ),
  entry(
    "BO-COMP-018",
    "hh_account_mismatch",
    409,
    "В Chrome открыт другой аккаунт HH.",
    "Войдите в нужный аккаунт HH и проверьте подключение перед продолжением.",
    "warning",
  ),
  entry(
    "BO-COMP-019",
    "tenant_runtime_unavailable",
    503,
    "Рабочее пространство временно недоступно.",
    "Проверьте состояние кабинета позже. Если ошибка повторяется, сообщите команде BudetOffer код ошибки.",
  ),
  entry(
    "BO-COMP-020",
    "job_not_found",
    404,
    "Задание не найдено.",
    "Обновите список заданий в кабинете и проверьте выбранную запись.",
    "warning",
  ),
  entry(
    "BO-COMP-021",
    "job_conflict",
    409,
    "Состояние задания изменилось.",
    "Обновите задание и проверьте его результат. Не повторяйте отправку отклика вслепую.",
    "warning",
  ),
  entry(
    "BO-COMP-022",
    "automation_access_required",
    403,
    "Автоматическое действие сейчас недоступно для аккаунта.",
    "Проверьте доступ в профиле кабинета. Подключение Chrome и сохранённые данные остаются на месте.",
  ),
  entry(
    "BO-COMP-023",
    "resume_ownership_evidence_required",
    409,
    "Выбранное резюме ещё не подтверждено.",
    "Откройте своё резюме в подключённом Chrome и запустите его проверку в кабинете.",
    "warning",
  ),
  entry(
    "BO-COMP-024",
    "resume_ownership_evidence_stale",
    409,
    "Проверка выбранного резюме устарела.",
    "Проверьте это резюме заново в кабинете, оставив его открытым в подключённом Chrome.",
    "warning",
  ),
  entry(
    "BO-COMP-025",
    "request_invalid",
    400,
    "Сервис не принял запрос.",
    "Проверьте обязательные поля и выбранную запись, затем обновите состояние.",
  ),
  entry(
    "BO-COMP-026",
    "request_unauthorized",
    401,
    "Для этого действия требуется вход.",
    "Войдите в кабинет и проверьте подключение расширения.",
  ),
  entry(
    "BO-COMP-027",
    "request_forbidden",
    403,
    "Для этого действия недостаточно доступа.",
    "Проверьте права и доступ в профиле кабинета. Повторная привязка Chrome не требуется.",
  ),
  entry(
    "BO-COMP-028",
    "request_not_found",
    404,
    "Запись не найдена.",
    "Обновите список и выберите существующую запись.",
    "warning",
  ),
  entry(
    "BO-COMP-029",
    "request_conflict",
    409,
    "Действие сейчас нельзя завершить: состояние изменилось.",
    "Обновите запись, проверьте её состояние и сохранённый результат перед повтором.",
    "warning",
  ),
  entry(
    "BO-COMP-030",
    "request_expired",
    410,
    "Срок действия запроса истёк.",
    "Обновите состояние и создайте новый запрос, если действие ещё требуется.",
    "warning",
  ),
  entry(
    "BO-COMP-031",
    "request_unprocessable",
    422,
    "Введённые данные не удалось обработать.",
    "Проверьте поля и выбранную запись. Ваши данные в редакторе можно исправить.",
  ),
  entry(
    "BO-COMP-032",
    "request_rate_limited",
    429,
    "Слишком много запросов.",
    "Подождите перед следующей попыткой и проверьте состояние текущего задания.",
    "warning",
  ),
  entry(
    "BO-COMP-033",
    "request_failed",
    500,
    "Сервис не смог завершить запрос.",
    "Проверьте сохранённый результат в кабинете. Если ошибка повторяется, сообщите команде BudetOffer код ошибки.",
  ),
  entry(
    "BO-COMP-034",
    "request_bad_gateway",
    502,
    "Сервис получил некорректный ответ.",
    "Проверьте состояние задания в кабинете перед повтором действия.",
  ),
  entry(
    "BO-COMP-035",
    "request_unavailable",
    503,
    "Сервис временно недоступен.",
    "Проверьте подключение и повторите проверку состояния позже.",
  ),
  entry(
    "BO-COMP-036",
    "request_timeout",
    504,
    "Сервис не ответил вовремя.",
    "Проверьте состояние задания и сохранённый результат перед повтором действия.",
  ),
  entry(
    "BO-COMP-037",
    "request_media_unsupported",
    415,
    "Формат запроса не поддерживается.",
    "Обновите расширение BudetOffer и повторите проверку подключения.",
  ),
  entry(
    "BO-COMP-038",
    "request_timeout",
    408,
    "Время ожидания запроса истекло.",
    "Проверьте состояние задания и сохранённый результат перед повтором действия.",
  ),
  entry(
    "BO-COMP-039",
    "resume_draft_proof_required",
    409,
    "Черновик сохранён, но проверку резюме нужно обновить.",
    "Проверьте выбранное резюме заново и получите сохранённый текст без повторной генерации.",
    "warning",
  ),
  entry(
    "BO-COMP-040",
    "resume_draft_failed",
    409,
    "Генерация черновика завершилась ошибкой.",
    "Проверьте состояние генерации в кабинете. Новую попытку нужно запустить отдельно.",
  ),
  entry(
    "BO-COMP-041",
    "vacancy_source_closed",
    409,
    "Источник подтвердил закрытие вакансии.",
    "Выберите другую вакансию. История работы с этой вакансией сохранена.",
    "warning",
  ),
  entry(
    "BO-COMP-042",
    "vacancy_lifecycle_unavailable",
    503,
    "Доступность вакансии пока не подтверждена.",
    "Повторите проверку состояния вакансии позже.",
  ),
  entry(
    "BO-COMP-043",
    "request_misdirected",
    421,
    "Запрос отправлен не в тот кабинет.",
    "Откройте свой кабинет по правильному адресу и проверьте адрес подключения в расширении.",
  ),
  entry(
    "BO-COMP-044",
    "request_too_large",
    413,
    "Запрос превышает допустимый размер.",
    "Сократите объём отправляемых данных и проверьте выбранную запись перед повтором.",
  ),
  entry(
    "BO-COMP-045",
    "request_method_not_allowed",
    405,
    "Этот способ запроса не поддерживается.",
    "Обновите расширение BudetOffer и повторите проверку подключения.",
  ),
];

const BY_CODE = new Map(ENTRIES.map((item) => [item.descriptor.code, item]));
const ALIASES = new Map<string, string>([
  ["invalid_pairing_response", "invalid_response"],
  ["invalid_login_response", "invalid_response"],
  ["invalid_recovery_response", "invalid_response"],
  ["invalid_companion_status", "invalid_response"],
  ["invalid_companion_job", "invalid_response"],
  ["device_login_expired", "login_expired"],
  ["device_login_not_found", "invalid_device_login"],
  ["pairing_expired", "login_expired"],
  ["invalid_companion_origin", "invalid_pairing"],
  ["unauthorized", "request_unauthorized"],
  ["device_revoked", "device_unauthorized"],
  ["device_expired", "device_unauthorized"],
  ["account_mismatch", "hh_account_mismatch"],
  ["connection_lost", "network_unavailable"],
  ["request_network_unavailable", "network_unavailable"],
  ["request_connection_lost", "network_unavailable"],
  ["device_json_required", "request_media_unsupported"],
  ["hh_account_reservations_unavailable", "tenant_runtime_unavailable"],
  ["tenant_generation_unavailable", "tenant_runtime_unavailable"],
  ["tenant_scoring_unavailable", "tenant_runtime_unavailable"],
  ["application_changed", "job_conflict"],
  ["payload_changed", "job_conflict"],
  ["lease_expired", "job_conflict"],
  ["lease_mismatch", "job_conflict"],
  ["lease_or_payload_changed", "job_conflict"],
  ["lease_candidate_changed", "job_conflict"],
  ["receipt_conflict", "job_conflict"],
  ["idempotency_conflict", "job_conflict"],
  ["reconciliation_target_changed", "job_conflict"],
  ["hh_account_reservation_not_held", "job_conflict"],
  ["resume_artifact_result_stale", "resume_ownership_evidence_stale"],
]);
const FALLBACK_KEYS = new Map<number, string>([
  [400, "request_invalid"],
  [401, "request_unauthorized"],
  [403, "request_forbidden"],
  [404, "request_not_found"],
  [405, "request_method_not_allowed"],
  [408, "request_timeout"],
  [409, "request_conflict"],
  [410, "request_expired"],
  [413, "request_too_large"],
  [415, "request_media_unsupported"],
  [421, "request_misdirected"],
  [422, "request_unprocessable"],
  [429, "request_rate_limited"],
  [500, "request_failed"],
  [502, "request_bad_gateway"],
  [503, "request_unavailable"],
  [504, "request_timeout"],
]);
const DESCRIPTOR_KEYS = [
  "code",
  "message",
  "status",
  "group",
  "key",
  "httpStatus",
] as const;
const PROTOTYPE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function catalogEntry(
  key: string,
  httpStatus?: number,
): CatalogEntry | undefined {
  const normalized = ALIASES.get(key) ?? key;
  return ENTRIES.find(
    (item) =>
      item.descriptor.key === normalized &&
      (httpStatus === undefined || item.descriptor.httpStatus === httpStatus),
  );
}

function fallbackEntry(httpStatus?: number): CatalogEntry {
  const key = FALLBACK_KEYS.get(httpStatus ?? 503) ?? "request_unavailable";
  return catalogEntry(key, httpStatus) ?? catalogEntry(key) ?? ENTRIES[34];
}

/** Unknown keys and mismatching status codes never introduce remote messages. */
export function companionEwans(
  key: string,
  httpStatus?: number,
): EwansDescriptor {
  return {
    ...(catalogEntry(key, httpStatus) ?? fallbackEntry(httpStatus)).descriptor,
  };
}

function objectValue(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownValue(value: object, key: string): unknown {
  const property = Object.getOwnPropertyDescriptor(value, key);
  return property && "value" in property ? property.value : undefined;
}

function safeObject(value: object): boolean {
  return !Reflect.ownKeys(value).some(
    (key) => typeof key === "string" && PROTOTYPE_KEYS.has(key),
  );
}

function descriptorOf(
  value: object,
  httpStatus?: number,
): EwansDescriptor | null {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Reflect.ownKeys(value).length !== DESCRIPTOR_KEYS.length) return null;
  const code = ownValue(value, "code");
  if (typeof code !== "string") return null;
  const expected = BY_CODE.get(code)?.descriptor;
  if (
    !expected ||
    (httpStatus !== undefined && expected.httpStatus !== httpStatus) ||
    DESCRIPTOR_KEYS.some((key) => ownValue(value, key) !== expected[key])
  ) {
    return null;
  }
  return { ...expected };
}

/** Read flat, success-content and problem-extension forms without evaluating getters. */
export function readCompanionEwans(
  value: unknown,
  httpStatus?: number,
): EwansDescriptor | null {
  try {
    if (!objectValue(value) || !safeObject(value)) return null;
    const direct = descriptorOf(value, httpStatus);
    if (direct) return direct;
    for (const key of ["ewans", "content"]) {
      const wrapped = ownValue(value, key);
      if (!objectValue(wrapped) || !safeObject(wrapped)) continue;
      const descriptor = descriptorOf(wrapped, httpStatus);
      if (descriptor) return descriptor;
    }
  } catch {
    // Untrusted proxies or accessors cannot supply user-facing text.
  }
  return null;
}

function knownLegacyEntry(
  value: unknown,
  httpStatus?: number,
): CatalogEntry | undefined {
  const candidates: unknown[] = [];
  if (typeof value === "string") candidates.push(value);
  else if (objectValue(value) && safeObject(value)) {
    for (const key of ["code", "title", "message"]) {
      candidates.push(ownValue(value, key));
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length > 128) continue;
    const found = catalogEntry(candidate, httpStatus);
    if (found) return found;
  }
  return undefined;
}

/** Only catalog-owned text is shown, including when a caller supplies an Error. */
export function resolveCompanionEwans(
  value: unknown,
  fallbackKey = "connection_unavailable",
): string {
  let chosen: CatalogEntry | undefined;
  const descriptor = readCompanionEwans(value);
  if (descriptor) chosen = BY_CODE.get(descriptor.code);
  try {
    chosen ??= knownLegacyEntry(value);
  } catch {
    // A hostile throwable is treated like an unavailable connection.
  }
  chosen ??= catalogEntry(fallbackKey) ?? fallbackEntry();
  return `${chosen.descriptor.message} ${chosen.nextAction} (${chosen.descriptor.code})`;
}

/** Keep legacy Error.message for worker control flow; render only the EWANS field. */
export function createCompanionRequestError(
  value: unknown,
  httpStatus: number,
  legacyMessage: string,
): Error & { status: number; ewans: EwansDescriptor } {
  let descriptor = readCompanionEwans(value, httpStatus);
  if (!descriptor) {
    let known: CatalogEntry | undefined;
    try {
      known = knownLegacyEntry(value, httpStatus);
    } catch {
      // Error bodies may be invalid or absent on old servers.
    }
    known ??=
      catalogEntry(legacyMessage, httpStatus) ?? fallbackEntry(httpStatus);
    descriptor = { ...known.descriptor };
  }
  return Object.assign(new Error(legacyMessage), {
    status: httpStatus,
    ewans: descriptor,
  });
}

/** Public catalog copies contain no recovery instructions or mutable internal entries. */
export function companionEwansCatalog(): Record<string, EwansDescriptor> {
  return Object.fromEntries(
    ENTRIES.map(({ descriptor }) => [descriptor.code, { ...descriptor }]),
  );
}
