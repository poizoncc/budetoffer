import type { FullHistoryObservation } from "../shared/companion-protocol.ts";
import type { HistoryFilter } from "./actions.ts";
export interface FullHistoryRequest {
  filter: HistoryFilter;
  page: number;
  hhAccountKey: string;
  observedAt: string;
}
export interface FullHistoryPage {
  observations: FullHistoryObservation[];
  pageCount: number;
  hasNext: boolean;
  filter: HistoryFilter;
}
/** Packaged read-only projection of the existing Local HH outcomes contract.
 * No list placement, missing row, or initial submission state implies rejection.
 * Serialized into the isolated page: all runtime helpers must stay local.
 */
export function readFullHistoryPage(
  request: FullHistoryRequest,
  documentRef: Document = globalThis.document,
  locationHref: string = globalThis.location?.href,
): FullHistoryPage {
  function fail(code: string): never {
    throw new Error(code);
  }
  function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function numeric(value: unknown): string | null {
    return (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value > 0) ||
      (typeof value === "string" && /^[1-9]\d{0,30}$/u.test(value))
      ? String(value)
      : null;
  }
  const url = new URL(locationHref);
  if (
    url.protocol !== "https:" ||
    !/(^|\.)hh\.ru$/u.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.pathname !== "/applicant/negotiations" ||
    !["active", "archived", "deleted"].includes(request.filter) ||
    !Number.isInteger(request.page) ||
    request.page < 0 ||
    request.page >= 120 ||
    url.search !== `?filter=${request.filter}&page=${request.page}`
  ) {
    fail("history_target_mismatch");
  }
  const raw = documentRef.querySelector(
    "template#HH-Lux-InitialState",
  )?.innerHTML;
  if (!raw || raw.length > 4_000_000) fail("unsupported_history_page");
  let state: unknown;
  try {
    state = JSON.parse(raw);
  } catch {
    fail("unsupported_history_page");
  }
  if (!record(state)) fail("account_identity_unverified");
  const data = state.applicantNegotiations;
  const session = record(state.session) ? state.session : null;
  if (
    state.userType !== "applicant" ||
    !state.account ||
    !state.hhidAccount ||
    session?.isFallback !== false ||
    session?.securityCheckFailed !== false ||
    session?.isMultiAccount !== false ||
    session?.hasExtraAccounts !== false
  ) {
    fail("account_identity_unverified");
  }
  if (
    !record(data) ||
    !Array.isArray(data.topicList) ||
    data.topicList.length > 1_000 ||
    data.filterInUse !== request.filter
  ) {
    fail("unsupported_history_page");
  }
  const owner = request.hhAccountKey?.match(
    /^hh-applicant-([1-9]\d{0,30})$/u,
  )?.[1];
  if (
    !owner ||
    (state.userId !== undefined && state.userId !== owner) ||
    data.topicList.some(
      (row: unknown) =>
        !record(row) ||
        !Number.isSafeInteger(row.applicantUserId) ||
        String(row.applicantUserId) !== owner,
    ) ||
    (!data.topicList.length && state.userId !== owner)
  ) {
    fail("account_identity_unverified");
  }
  const pageCount = Number(data.pageCount);
  const next =
    record(data.paging) && record(data.paging.next) ? data.paging.next : null;
  if (
    !Number.isInteger(pageCount) ||
    pageCount < 0 ||
    pageCount > 10_000 ||
    typeof next?.disabled !== "boolean"
  ) {
    fail("incomplete_history_page");
  }
  const observations: FullHistoryObservation[] = [];
  for (const row of data.topicList) {
    if (!record(row)) fail("history_identity_missing");
    const negotiationId = numeric(row.id);
    const vacancyId = numeric(row.vacancyId);
    const resumeInternalId = numeric(row.resumeId);
    if (!negotiationId || !vacancyId || !resumeInternalId) {
      fail("history_identity_missing");
    }
    let stage = "unknown";
    // Require explicit not-applicant-declined evidence, not truthiness.
    if (row.declinedByApplicant === false) {
      if (row.lastState === "RESPONSE" && row.viewedByOpponent === true) {
        stage = "viewed";
      } else if (row.lastState === "INVITATION") stage = "invited";
      else if (row.lastState === "DISCARD") stage = "rejected";
    }
    const shorts =
      record(state.vacanciesShort) &&
      Array.isArray(state.vacanciesShort.vacanciesList)
        ? state.vacanciesShort.vacanciesList.filter(record)
        : [];
    const matches = shorts.filter(
      (item) => numeric(item.vacancyId) === vacancyId,
    );
    const vacancy = matches.length === 1 ? matches[0] : null;
    const company = vacancy && record(vacancy.company) ? vacancy.company : null;
    const metadata = (value: unknown): string | null =>
      typeof value === "string" && value.trim()
        ? value.trim().slice(0, 500)
        : null;
    let millis = NaN;
    if (
      typeof row.creationTimeMillis === "number" &&
      Number.isSafeInteger(row.creationTimeMillis)
    ) {
      millis = row.creationTimeMillis;
    } else if (typeof row.creationTime === "string") {
      millis = Date.parse(row.creationTime);
    }
    const submittedAt =
      Number.isFinite(millis) &&
      millis > 0 &&
      Number.isFinite(new Date(millis).getTime())
        ? new Date(millis).toISOString()
        : null;
    let initiatedByApplicant: boolean | null = null;
    if (row.initialState === "RESPONSE") initiatedByApplicant = true;
    else if (row.initialState === "INVITATION") initiatedByApplicant = false;
    let label = "Результат неизвестен";
    if (row.declinedByApplicant === true) label = "Соискатель отказался";
    else if (stage === "viewed") label = "Просмотрен";
    else if (stage === "invited") label = "Приглашение";
    else if (stage === "rejected") label = "Отказ";
    observations.push({
      negotiationId,
      vacancyId,
      resumeId: `internal-${resumeInternalId}`,
      resumeInternalId,
      stage,
      resumeHash: null,
      title: metadata(vacancy?.name),
      company: metadata(company?.visibleName ?? company?.name),
      employerId: numeric(row.employerId),
      submittedAt,
      initiatedByApplicant,
      applicantDeclined:
        typeof row.declinedByApplicant === "boolean"
          ? row.declinedByApplicant
          : null,
      label,
      observedAt: request.observedAt,
      hhList: request.filter,
    });
  }
  return {
    observations,
    pageCount,
    hasNext: !next.disabled,
    filter: request.filter,
  };
}
