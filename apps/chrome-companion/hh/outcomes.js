/** Packaged read-only projection of the existing Local HH outcomes contract.
 * No list placement, missing row, or initial submission state implies rejection.
 * This function is serialized into the isolated page; keep it self-contained.
 */
export function readApplicationOutcomesPage(request, documentRef = globalThis.document, locationHref = globalThis.location?.href) {
  const fail = code => { throw new Error(code); };
  const numeric = value => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) || (typeof value === 'string' && /^[1-9]\d{0,30}$/u.test(value)) ? String(value) : null;
  const url = new URL(locationHref);
  if (url.origin !== 'https://hh.ru' || url.username || url.password || url.hash || url.pathname !== '/applicant/negotiations' || !['active', 'archived', 'deleted'].includes(request.filter) || !Number.isInteger(request.page) || request.page < 0 || request.page >= 120 || url.search !== `?filter=${request.filter}&page=${request.page}`) fail('history_target_mismatch');
  if (!Array.isArray(request.targets) || !request.targets.length || request.targets.length > 20) fail('invalid_read_payload');
  const raw = documentRef.querySelector('template#HH-Lux-InitialState')?.innerHTML;
  if (!raw || raw.length > 4000000) fail('unsupported_history_page');
  let state; try { state = JSON.parse(raw); } catch { fail('unsupported_history_page'); }
  const data = state?.applicantNegotiations, session = state?.session;
  if (state?.userType !== 'applicant' || !state.account || !state.hhidAccount || session?.isFallback !== false || session?.securityCheckFailed !== false || session?.isMultiAccount !== false || session?.hasExtraAccounts !== false) fail('account_identity_unverified');
  if (!Array.isArray(data?.topicList) || data.topicList.length > 1000 || data.filterInUse !== request.filter) fail('unsupported_history_page');
  const owner = request.hhAccountKey?.match(/^hh-applicant-([1-9]\d{0,30})$/u)?.[1];
  if (!owner || (state.userId !== undefined && state.userId !== owner) || data.topicList.some(row => !Number.isSafeInteger(row?.applicantUserId) || String(row.applicantUserId) !== owner) || (!data.topicList.length && state.userId !== owner)) fail('account_identity_unverified');
  const pageCount = Number(data.pageCount);
  if (!Number.isInteger(pageCount) || pageCount < 0 || pageCount > 10000 || typeof data.paging?.next?.disabled !== 'boolean') fail('incomplete_history_page');
  const observations = [];
  for (const row of data.topicList) {
    const negotiationId = numeric(row?.id), vacancyId = numeric(row?.vacancyId), resumeInternalId = numeric(row?.resumeId);
    if (!negotiationId || !vacancyId || !resumeInternalId) fail('history_identity_missing');
    const target = request.targets.find(item => item.negotiationId === negotiationId);
    if (!target) continue;
    if (target.vacancyId !== vacancyId || target.resumeInternalId !== resumeInternalId) fail('history_identity_missing');
    let stage = 'unknown';
    // Require explicit not-applicant-declined evidence, not truthiness.
    if (row.declinedByApplicant === false) {
      if (row.lastState === 'RESPONSE' && row.viewedByOpponent === true) stage = 'viewed';
      else if (row.lastState === 'INVITATION') stage = 'invited';
      else if (row.lastState === 'DISCARD') stage = 'rejected';
    }
    observations.push({ negotiationId, vacancyId, resumeId: target.resumeId, resumeInternalId, stage });
  }
  return { observations, pageCount, hasNext: !data.paging.next.disabled, filter: request.filter };
}
