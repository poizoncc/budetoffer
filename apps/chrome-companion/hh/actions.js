// Packaged READ-ONLY adapters, based on content.js and outcomes/hh-outcome-provider.ts.
// Parsing these signals does not establish account identity or authorize sending.
function numericId(value) { return (typeof value === "number" && Number.isSafeInteger(value) && value > 0) || (typeof value === "string" && /^[1-9]\d{0,30}$/u.test(value)) ? String(value) : null; }
function record(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function plainDescription(node){
  const pending=node?[node]:[],parts=[];let count=0,length=0;
  while(pending.length){const current=pending.pop();if(++count>100000)return '';
    if(current.nodeType===3){const text=current.nodeValue||'';length+=text.length;if(length>250000)return '';parts.push(text);continue;}
    const tag=current.tagName?.toLowerCase();if(['style','script','noscript','template','link','meta','iframe','object','embed'].includes(tag))continue;
    if(['br','p','div','li','h1','h2','h3','section','article'].includes(tag))parts.push('\n');
    const children=current.childNodes||[];for(let i=children.length-1;i>=0;i--)pending.push(children[i]);
  }return parts.join('').trim();
}
export function readInitialState(documentRef) {
  const template = documentRef.querySelector("template#HH-Lux-InitialState");
  const text = template?.innerHTML ?? template?.content?.textContent ?? "";
  if (!text || text.length > 5000000) throw new Error("unsupported_hh_page");
  try { const state = JSON.parse(text); if (record(state)) return state; } catch { /* Never report authenticated page text. */ }
  throw new Error("unsupported_hh_page");
}
export function readResumeIdentity(documentRef, expectedHash) {
  if (typeof expectedHash !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(expectedHash)) throw new Error("invalid_resume_id");
  const attrs = readInitialState(documentRef).applicantResume?._attributes;
  const internalId = numericId(attrs?.id);
  if (!internalId || attrs?.hash !== expectedHash) throw new Error("resume_identity_mismatch");
  return { internalId, hash: expectedHash };
}
export function readNegotiationsPage(documentRef, expectedFilter = "active") {
  if (!["active", "archived", "deleted"].includes(expectedFilter)) throw new Error("invalid_history_filter");
  const data = readInitialState(documentRef).applicantNegotiations;
  if (!record(data) || !Array.isArray(data.topicList) || data.topicList.length > 1000 || data.filterInUse !== expectedFilter) throw new Error("unsupported_history_page");
  const pageCount = Number(data.pageCount);
  if (!Number.isSafeInteger(pageCount) || pageCount < 0 || pageCount > 10000 || typeof data.paging?.next?.disabled !== "boolean") throw new Error("incomplete_history_page");
  const observations = data.topicList.map(topic => {
    const negotiationId = numericId(topic?.id), vacancyId = numericId(topic?.vacancyId), resumeInternalId = numericId(topic?.resumeId);
    if (!negotiationId || !vacancyId || !resumeInternalId) throw new Error("history_identity_missing");
    return { negotiationId, vacancyId, resumeInternalId, initiatedByApplicant: topic.initialState === "RESPONSE" };
  });
  return { observations, pageCount, hasNext: !data.paging.next.disabled, filter: expectedFilter };
}
export function matchHistoricalApplication(page, vacancyId, resumeInternalId) {
  if (!numericId(vacancyId) || !numericId(resumeInternalId)) throw new Error("invalid_history_target");
  const matches = page.observations.filter(row => row.vacancyId === vacancyId && row.resumeInternalId === resumeInternalId && row.initiatedByApplicant);
  // Missing entry on this page proves nothing about submission or other pages.
  return matches.length === 1 ? { outcome: "observed", negotiationId: matches[0].negotiationId } : { outcome: "unknown" };
}
export function readVacancy(documentRef, locationHref, expectedVacancyId) {
  const url = new URL(locationHref);
  if (!numericId(expectedVacancyId) || url.protocol !== "https:" || !/(^|\.)hh\.ru$/u.test(url.hostname) || url.username||url.password||url.port||url.hash||url.pathname !== `/vacancy/${expectedVacancyId}`) throw new Error("vacancy_identity_mismatch");
  const title = documentRef.querySelector("[data-qa=vacancy-title]")?.textContent?.trim();
  const text = plainDescription(documentRef.querySelector("[data-qa=vacancy-description], [data-qa=vacancy-view-description]"));
  if (!title || !text || text.length > 250000) throw new Error("vacancy_text_unavailable");
  return { vacancyId: expectedVacancyId, title: title.slice(0, 1000), text };
}

/** Self-contained packaged function for chrome.scripting serialization. */
export function readPageEvidence(request, documentRef = globalThis.document, locationHref = globalThis.location?.href) {
  const fail = code => { throw new Error(code); };
  const numeric = value => (typeof value === "number" && Number.isSafeInteger(value) && value > 0) || (typeof value === "string" && /^[1-9]\d{0,30}$/u.test(value)) ? String(value) : null;
  const id = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/u.test(value);
  if (!request || !["vacancy", "resume", "history", "search"].includes(request.operation)) fail("unsupported_read_operation");
  const url = new URL(locationHref);
  if (url.protocol !== "https:" || !/(^|\.)hh\.ru$/u.test(url.hostname) || url.username || url.password||url.port||url.hash) fail("unexpected_hh_navigation");
  if (request.operation === "vacancy") {
    if (!numeric(request.vacancyId) || url.pathname !== `/vacancy/${request.vacancyId}`) fail("vacancy_identity_mismatch");
    const title = documentRef.querySelector("[data-qa=vacancy-title]")?.textContent?.trim();
    // Kept self-contained for isolated chrome.scripting serialization.
    const root=documentRef.querySelector("[data-qa=vacancy-description], [data-qa=vacancy-view-description]");
    const pending=root?[root]:[],parts=[];let count=0,length=0;
    while(pending.length){const current=pending.pop();if(++count>100000)fail('vacancy_text_unavailable');
      if(current.nodeType===3){const value=current.nodeValue||'';length+=value.length;if(length>250000)fail('vacancy_text_unavailable');parts.push(value);continue;}
      const tag=current.tagName?.toLowerCase();if(['style','script','noscript','template','link','meta','iframe','object','embed'].includes(tag))continue;
      if(['br','p','div','li','h1','h2','h3','section','article'].includes(tag))parts.push('\n');
      const children=current.childNodes||[];for(let i=children.length-1;i>=0;i--)pending.push(children[i]);
    }
    const text = parts.join('').trim();
    if (!title || !text || title.length > 1000 || text.length > 250000) fail("vacancy_text_unavailable");
    return { vacancyId: request.vacancyId, title, text };
  }
  const template = documentRef.querySelector("template#HH-Lux-InitialState");
  const raw = template?.innerHTML ?? template?.content?.textContent;
  if (typeof raw !== "string" || !raw || raw.length > 5000000) fail("unsupported_hh_page");
  let state;
  try { state = JSON.parse(raw); } catch { fail("unsupported_hh_page"); }
  if (request.operation === "search") {
    if (url.pathname !== "/search/vacancy" || url.href !== request.expectedUrl || !Number.isInteger(request.page) || request.page < 0 || request.page > 19) fail("unsupported_hh_page");
    const data = state?.vacancySearchResult;
    if (!Array.isArray(data?.vacancies) || data.vacancies.length > 100 || typeof data.paging?.next?.disabled !== "boolean") fail("unsupported_hh_page");
    const selected = data.paging.pages?.filter(row => row.selected === true);
    if (!Array.isArray(selected) || selected.length !== 1 || selected[0].page !== request.page || (!data.paging.next.disabled && data.paging.next.page !== request.page + 1)) fail("unsupported_hh_page");
    const vacancies = data.vacancies.map(row => {
      const vacancyId = numeric(row?.vacancyId), company = row?.company?.visibleName ?? row?.company?.name ?? null;
      if (!vacancyId || vacancyId.length > 20 || typeof row.name !== "string" || !row.name.trim() || row.name.length > 1000 || (company !== null && (typeof company !== "string" || company.length > 1000))) fail("unsupported_hh_page");
      return { vacancyId, title: row.name, company };
    });
    return { vacancies, hasNext: !data.paging.next.disabled };
  }
  if (request.operation === "resume") {
    if (!id(request.resumeId) || url.pathname !== `/resume/${request.resumeId}`) fail("resume_identity_mismatch");
    const attrs = state?.applicantResume?._attributes;
    // Grounded on an own resume detail page, 2026-10-04. Identity alone is not ownership.
    const statuses = state.applicantResume?.applicantUserStatuses;
    const status = statuses && Object.hasOwn(statuses, state.userId) ? statuses[state.userId] : null;
    if (state?.userType !== 'applicant' || typeof state.userId !== 'string' || !numeric(state.userId) || state.applicantResume?.forbidden !== null || attrs?.hash !== request.resumeId || !numeric(attrs?.id) || attrs.user !== state.userId || attrs.permission !== 'edit' || !status || typeof status !== 'object' || Array.isArray(status) || !Object.hasOwn(status, 'jobSearchStatus')) fail("resume_identity_mismatch");
    return { resumeId: request.resumeId, internalId: numeric(attrs.id) };
  }
  // Serialized into the isolated document: cannot capture module imports.
  // Fixed MAX_HISTORY_PAGES=120 is checked against the protocol in boundary tests.
  if (url.pathname !== "/applicant/negotiations" || !["active", "archived", "deleted"].includes(request.filter) || url.searchParams.get("filter") !== request.filter || !Number.isInteger(request.page) || request.page < 0 || request.page >= 120 || url.searchParams.get("page") !== String(request.page)) fail("history_target_mismatch");
  const data = state?.applicantNegotiations;
  if (!data || !Array.isArray(data.topicList) || data.topicList.length > 1000 || data.filterInUse !== request.filter) fail("unsupported_history_page");
  const pageCount = Number(data.pageCount);
  if (!Number.isInteger(pageCount) || pageCount < 0 || pageCount > 10000 || typeof data.paging?.next?.disabled !== "boolean") fail("incomplete_history_page");
  const observations = data.topicList.map(row => {
    if (!numeric(row?.id) || !numeric(row?.vacancyId) || !numeric(row?.resumeId)) fail("history_identity_missing");
    return { negotiationId: numeric(row.id), vacancyId: numeric(row.vacancyId), resumeInternalId: numeric(row.resumeId), initiatedByApplicant: row.initialState === "RESPONSE" };
  });
  return { observations, pageCount, hasNext: !data.paging.next.disabled, filter: request.filter };
}
