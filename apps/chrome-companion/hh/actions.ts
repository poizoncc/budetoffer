import type {
  ResumeEvidence,
  VacancyEvidence,
} from "../shared/companion-protocol.ts";

export type {
  ResumeEvidence,
  VacancyEvidence,
} from "../shared/companion-protocol.ts";
export type HistoryFilter = "active" | "archived" | "deleted";
export interface HistoryObservation {
  negotiationId: string;
  vacancyId: string;
  resumeInternalId: string;
  initiatedByApplicant: boolean;
}
export interface HistoryPage {
  observations: HistoryObservation[];
  pageCount: number;
  hasNext: boolean;
  filter: HistoryFilter;
}
export interface SearchEvidence {
  vacancies: { vacancyId: string; title: string; company: string | null }[];
  hasNext: boolean;
}
export type PageEvidenceRequest =
  | { operation: "vacancy"; vacancyId: string }
  | { operation: "resume"; resumeId: string }
  | { operation: "history"; filter: HistoryFilter; page: number }
  | { operation: "search"; expectedUrl: string; page: number };
export type PageEvidenceResult =
  VacancyEvidence | ResumeEvidence | HistoryPage | SearchEvidence;

// Parsing these read-only signals does not establish identity or authorize sending.
function numericId(value: unknown): string | null {
  return (typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0) ||
    (typeof value === "string" && /^[1-9]\d{0,30}$/u.test(value))
    ? String(value)
    : null;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function plainDescription(node: Node | null): string {
  const pending: Node[] = node ? [node] : [];
  const parts: string[] = [];
  let count = 0;
  let length = 0;
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    if (++count > 100_000) return "";
    if (current.nodeType === 3) {
      const text = current.nodeValue || "";
      length += text.length;
      if (length > 250_000) return "";
      parts.push(text);
      continue;
    }
    const tag = current.nodeName.toLowerCase();
    if (
      [
        "style",
        "script",
        "noscript",
        "template",
        "link",
        "meta",
        "iframe",
        "object",
        "embed",
      ].includes(tag)
    ) {
      continue;
    }
    if (
      ["br", "p", "div", "li", "h1", "h2", "h3", "section", "article"].includes(
        tag,
      )
    ) {
      parts.push("\n");
    }
    for (let i = current.childNodes.length - 1; i >= 0; i--) {
      const child = current.childNodes.item(i);
      if (child) pending.push(child);
    }
  }
  return parts.join("").trim();
}
export function readInitialState(
  documentRef: Document,
): Record<string, unknown> {
  const template = documentRef.querySelector<HTMLTemplateElement>(
    "template#HH-Lux-InitialState",
  );
  const text = template?.innerHTML ?? template?.content?.textContent ?? "";
  if (!text || text.length > 5_000_000) throw new Error("unsupported_hh_page");
  try {
    const state: unknown = JSON.parse(text);
    if (record(state)) return state;
  } catch {
    /* Never report authenticated page text. */
  }
  throw new Error("unsupported_hh_page");
}
export function readResumeIdentity(
  documentRef: Document,
  expectedHash: string,
): { internalId: string; hash: string } {
  if (
    typeof expectedHash !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/u.test(expectedHash)
  ) {
    throw new Error("invalid_resume_id");
  }
  const resume = readInitialState(documentRef).applicantResume;
  const attrs =
    record(resume) && record(resume._attributes) ? resume._attributes : null;
  const internalId = numericId(attrs?.id);
  if (!internalId || attrs?.hash !== expectedHash) {
    throw new Error("resume_identity_mismatch");
  }
  return { internalId, hash: expectedHash };
}
export function readNegotiationsPage(
  documentRef: Document,
  expectedFilter: HistoryFilter = "active",
): HistoryPage {
  if (!["active", "archived", "deleted"].includes(expectedFilter)) {
    throw new Error("invalid_history_filter");
  }
  const data = readInitialState(documentRef).applicantNegotiations;
  if (
    !record(data) ||
    !Array.isArray(data.topicList) ||
    data.topicList.length > 1_000 ||
    data.filterInUse !== expectedFilter
  ) {
    throw new Error("unsupported_history_page");
  }
  const pageCount = Number(data.pageCount);
  const next =
    record(data.paging) && record(data.paging.next) ? data.paging.next : null;
  if (
    !Number.isSafeInteger(pageCount) ||
    pageCount < 0 ||
    pageCount > 10_000 ||
    typeof next?.disabled !== "boolean"
  ) {
    throw new Error("incomplete_history_page");
  }
  const observations = data.topicList.map(
    (topic: unknown): HistoryObservation => {
      if (!record(topic)) throw new Error("history_identity_missing");
      const negotiationId = numericId(topic.id);
      const vacancyId = numericId(topic.vacancyId);
      const resumeInternalId = numericId(topic.resumeId);
      if (!negotiationId || !vacancyId || !resumeInternalId) {
        throw new Error("history_identity_missing");
      }
      return {
        negotiationId,
        vacancyId,
        resumeInternalId,
        initiatedByApplicant: topic.initialState === "RESPONSE",
      };
    },
  );
  return {
    observations,
    pageCount,
    hasNext: !next.disabled,
    filter: expectedFilter,
  };
}
export function matchHistoricalApplication(
  page: HistoryPage,
  vacancyId: string,
  resumeInternalId: string,
): { outcome: "observed"; negotiationId: string } | { outcome: "unknown" } {
  if (!numericId(vacancyId) || !numericId(resumeInternalId)) {
    throw new Error("invalid_history_target");
  }
  const matches = page.observations.filter(
    (row) =>
      row.vacancyId === vacancyId &&
      row.resumeInternalId === resumeInternalId &&
      row.initiatedByApplicant,
  );
  // Missing entry on this page proves nothing about submission or other pages.
  const match = matches[0];
  return matches.length === 1 && match
    ? { outcome: "observed", negotiationId: match.negotiationId }
    : { outcome: "unknown" };
}
export function readVacancy(
  documentRef: Document,
  locationHref: string,
  expectedVacancyId: string,
): VacancyEvidence {
  const url = new URL(locationHref);
  if (
    !numericId(expectedVacancyId) ||
    url.protocol !== "https:" ||
    !/(^|\.)hh\.ru$/u.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.pathname !== `/vacancy/${expectedVacancyId}`
  ) {
    throw new Error("vacancy_identity_mismatch");
  }
  const title = documentRef
    .querySelector("[data-qa=vacancy-title]")
    ?.textContent?.trim();
  const text = plainDescription(
    documentRef.querySelector(
      "[data-qa=vacancy-description], [data-qa=vacancy-view-description]",
    ),
  );
  if (!title || !text || text.length > 250_000) {
    throw new Error("vacancy_text_unavailable");
  }
  return { vacancyId: expectedVacancyId, title: title.slice(0, 1_000), text };
}

/** Serialized by chrome.scripting: runtime helpers must stay inside this function. */
export function readPageEvidence(
  request: PageEvidenceRequest,
  documentRef: Document = globalThis.document,
  locationHref: string = globalThis.location?.href,
): PageEvidenceResult {
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
  function id(value: unknown): value is string {
    return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/u.test(value);
  }
  if (
    !request ||
    !["vacancy", "resume", "history", "search"].includes(request.operation)
  ) {
    fail("unsupported_read_operation");
  }
  const url = new URL(locationHref);
  if (
    url.protocol !== "https:" ||
    !/(^|\.)hh\.ru$/u.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    fail("unexpected_hh_navigation");
  }
  if (request.operation === "vacancy") {
    if (
      !numeric(request.vacancyId) ||
      url.pathname !== `/vacancy/${request.vacancyId}`
    ) {
      fail("vacancy_identity_mismatch");
    }
    const title = documentRef
      .querySelector("[data-qa=vacancy-title]")
      ?.textContent?.trim();
    const root = documentRef.querySelector(
      "[data-qa=vacancy-description], [data-qa=vacancy-view-description]",
    );
    const pending: Node[] = root ? [root] : [];
    const parts: string[] = [];
    let count = 0;
    let length = 0;
    while (pending.length) {
      const current = pending.pop();
      if (!current) break;
      if (++count > 100_000) fail("vacancy_text_unavailable");
      if (current.nodeType === 3) {
        const value = current.nodeValue || "";
        length += value.length;
        if (length > 250_000) fail("vacancy_text_unavailable");
        parts.push(value);
        continue;
      }
      const tag = current.nodeName.toLowerCase();
      if (
        [
          "style",
          "script",
          "noscript",
          "template",
          "link",
          "meta",
          "iframe",
          "object",
          "embed",
        ].includes(tag)
      ) {
        continue;
      }
      if (
        [
          "br",
          "p",
          "div",
          "li",
          "h1",
          "h2",
          "h3",
          "section",
          "article",
        ].includes(tag)
      ) {
        parts.push("\n");
      }
      for (let i = current.childNodes.length - 1; i >= 0; i--) {
        const child = current.childNodes.item(i);
        if (child) pending.push(child);
      }
    }
    const text = parts.join("").trim();
    if (!title || !text || title.length > 1_000 || text.length > 250_000) {
      fail("vacancy_text_unavailable");
    }
    return { vacancyId: request.vacancyId, title, text };
  }
  const template = documentRef.querySelector<HTMLTemplateElement>(
    "template#HH-Lux-InitialState",
  );
  const raw = template?.innerHTML ?? template?.content?.textContent;
  if (typeof raw !== "string" || !raw || raw.length > 5_000_000) {
    fail("unsupported_hh_page");
  }
  let state: unknown;
  try {
    state = JSON.parse(raw);
  } catch {
    fail("unsupported_hh_page");
  }
  if (!record(state)) fail("unsupported_hh_page");
  if (request.operation === "search") {
    // A regional HH redirect may change the host, but never the search or filters.
    let expected: URL;
    try {
      expected = new URL(request.expectedUrl);
    } catch {
      fail("unsupported_hh_page");
    }
    if (
      expected.protocol !== "https:" ||
      !/(^|\.)hh\.ru$/u.test(expected.hostname) ||
      expected.username ||
      expected.password ||
      expected.port ||
      expected.hash ||
      expected.pathname !== "/search/vacancy" ||
      url.pathname !== expected.pathname ||
      url.search !== expected.search ||
      !Number.isInteger(request.page) ||
      request.page < 0 ||
      request.page > 19
    ) {
      fail("unsupported_hh_page");
    }
    const data = state.vacancySearchResult;
    if (
      !record(data) ||
      !Array.isArray(data.vacancies) ||
      data.vacancies.length > 100 ||
      !record(data.paging) ||
      !record(data.paging.next) ||
      typeof data.paging.next.disabled !== "boolean"
    ) {
      fail("unsupported_hh_page");
    }
    const selected = Array.isArray(data.paging.pages)
      ? data.paging.pages.filter(
          (row: unknown) => record(row) && row.selected === true,
        )
      : null;
    if (
      !selected ||
      selected.length !== 1 ||
      !record(selected[0]) ||
      selected[0].page !== request.page ||
      (!data.paging.next.disabled && data.paging.next.page !== request.page + 1)
    ) {
      fail("unsupported_hh_page");
    }
    const vacancies = data.vacancies.map((row: unknown) => {
      if (!record(row)) fail("unsupported_hh_page");
      const vacancyId = numeric(row.vacancyId);
      const company = record(row.company)
        ? (row.company.visibleName ?? row.company.name ?? null)
        : null;
      if (
        !vacancyId ||
        vacancyId.length > 20 ||
        typeof row.name !== "string" ||
        !row.name.trim() ||
        row.name.length > 1_000 ||
        (company !== null &&
          (typeof company !== "string" || company.length > 1_000))
      ) {
        fail("unsupported_hh_page");
      }
      return { vacancyId, title: row.name, company };
    });
    return { vacancies, hasNext: !data.paging.next.disabled };
  }
  if (request.operation === "resume") {
    if (
      !id(request.resumeId) ||
      url.pathname !== `/resume/${request.resumeId}`
    ) {
      fail("resume_identity_mismatch");
    }
    const resume = record(state.applicantResume) ? state.applicantResume : null;
    const attrs =
      resume && record(resume._attributes) ? resume._attributes : null;
    const statuses =
      resume && record(resume.applicantUserStatuses)
        ? resume.applicantUserStatuses
        : null;
    const status =
      statuses &&
      typeof state.userId === "string" &&
      Object.hasOwn(statuses, state.userId)
        ? statuses[state.userId]
        : null;
    const internalId = numeric(attrs?.id);
    // Grounded on an own resume detail page, 2026-10-04. Identity is not ownership.
    if (
      state.userType !== "applicant" ||
      typeof state.userId !== "string" ||
      !numeric(state.userId) ||
      resume?.forbidden !== null ||
      attrs?.hash !== request.resumeId ||
      !internalId ||
      attrs?.user !== state.userId ||
      attrs.permission !== "edit" ||
      !record(status) ||
      !Object.hasOwn(status, "jobSearchStatus")
    ) {
      fail("resume_identity_mismatch");
    }
    return { resumeId: request.resumeId, internalId };
  }
  // Fixed MAX_HISTORY_PAGES=120 is checked against the protocol in boundary tests.
  if (
    url.pathname !== "/applicant/negotiations" ||
    !["active", "archived", "deleted"].includes(request.filter) ||
    url.searchParams.get("filter") !== request.filter ||
    !Number.isInteger(request.page) ||
    request.page < 0 ||
    request.page >= 120 ||
    url.searchParams.get("page") !== String(request.page)
  ) {
    fail("history_target_mismatch");
  }
  const data = state.applicantNegotiations;
  if (
    !record(data) ||
    !Array.isArray(data.topicList) ||
    data.topicList.length > 1_000 ||
    data.filterInUse !== request.filter
  ) {
    fail("unsupported_history_page");
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
  const observations = data.topicList.map(
    (row: unknown): HistoryObservation => {
      if (!record(row)) fail("history_identity_missing");
      const negotiationId = numeric(row.id);
      const vacancyId = numeric(row.vacancyId);
      const resumeInternalId = numeric(row.resumeId);
      if (!negotiationId || !vacancyId || !resumeInternalId) {
        fail("history_identity_missing");
      }
      return {
        negotiationId,
        vacancyId,
        resumeInternalId,
        initiatedByApplicant: row.initialState === "RESPONSE",
      };
    },
  );
  return {
    observations,
    pageCount,
    hasNext: !next.disabled,
    filter: request.filter,
  };
}
