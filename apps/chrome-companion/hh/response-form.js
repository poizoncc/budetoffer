/** Read-only identity evidence from the observed response popup's owned resume map.
 * Map membership proves ownership; a scoped checked portal radio proves selection.
 * No titles, contact details, cookies or form tokens leave this function.
 */
export function readResponseResumeEvidence(request, documentRef = globalThis.document, locationHref = globalThis.location?.href) {
  const fail = code => { throw new Error(code); };
  const numeric = value => typeof value === 'string' && /^[1-9]\d{0,30}$/u.test(value);
  const url = new URL(locationHref);
  if (!request || url.origin !== 'https://hh.ru' || url.pathname !== '/applicant/vacancy_response' || url.searchParams.get('vacancyId') !== request.vacancyId || !numeric(request.vacancyId) || !/^[A-Za-z0-9_-]{1,128}$/u.test(request.resumeId)) fail('unsupported_response_form');
  const raw = documentRef.querySelector('template#HH-Lux-InitialState')?.innerHTML;
  if (!raw || raw.length > 4000000) fail('response_identity_unverified');
  let state; try { state = JSON.parse(raw); } catch { fail('response_identity_unverified'); }
  const session = state.session;
  if (state.userType !== 'applicant' || !state.account || !state.hhidAccount || session?.isFallback !== false || session?.securityCheckFailed !== false || session?.isMultiAccount !== false || session?.hasExtraAccounts !== false) fail('response_identity_unverified');
  const vacancy = state.vacancyResponsePopup?.vacancy, map = vacancy?.resumes;
  if (!Number.isSafeInteger(vacancy?.shortVacancy?.vacancyId) || String(vacancy.shortVacancy.vacancyId) !== request.vacancyId) fail('response_vacancy_mismatch');
  if (!map || typeof map !== 'object' || Array.isArray(map) || !Object.keys(map).length || Object.keys(map).length > 100) fail('response_identity_unverified');
  const resumes = [], owners = new Set(), hashes = new Set();
  for (const [internalId, resume] of Object.entries(map)) {
    const attrs = resume?._attributes;
    if (resume?.forbidden !== null || !numeric(internalId) || attrs?.id !== internalId || !numeric(attrs?.user) || attrs.permission !== 'edit' || typeof attrs.hash !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(attrs.hash) || hashes.has(attrs.hash)) fail('response_identity_unverified');
    owners.add(attrs.user); hashes.add(attrs.hash);
    resumes.push({ resumeId: attrs.hash, resumeInternalId: internalId });
  }
  const owner = [...owners][0];
  if (owners.size !== 1 || `hh-applicant-${owner}` !== request.hhAccountKey || (state.userId !== undefined && state.userId !== owner)) fail('response_identity_unverified');
  const target = resumes.filter(row => row.resumeId === request.resumeId);
  if (target.length !== 1) fail('resume_ownership_unverified');
  const dialogs = documentRef.querySelectorAll('[role="dialog"][data-qa="drop-base"]');
  const buttons = documentRef.querySelectorAll('[data-qa="vacancy-response-submit-popup"]');
  let selectionVerified = false;
  if (dialogs.length === 1 && !dialogs[0].hidden && dialogs[0].getAttribute('aria-hidden') !== 'true' && documentRef.defaultView.getComputedStyle(dialogs[0]).display !== 'none' && buttons.length === 1 && buttons[0].form) {
    const radios = [...dialogs[0].querySelectorAll('input[type="radio"]')];
    const selected = radios.filter(radio => radio.checked);
    selectionVerified = radios.length > 0 && radios.length <= 100 && selected.length === 1 && selected[0].value === request.resumeId && !selected[0].disabled && radios.every(radio => radio.name === '' && radio.form !== buttons[0].form && hashes.has(radio.value)) && new Set(radios.map(radio => radio.value)).size === radios.length;
  }
  return { hhAccountKey: request.hhAccountKey, vacancyId: request.vacancyId, ...target[0], ownershipVerified: true, selectionVerified,
    responseAllowed: vacancy.responseImpossible === false && vacancy.alreadyApplied === false && vacancy.hasQuickResponse === false && vacancy.test?.hasTests === false && vacancy.shortVacancy.closedForApplicants === false && vacancy.shortVacancy.userTestPresent === false && Number.isSafeInteger(vacancy.letterMaxLength) && vacancy.letterMaxLength >= 40 && vacancy.letterMaxLength <= 10000 };
}

/** Open only the two observed, reversible DIV controls. Never select a resume,
 * fill a field, click a button, or submit. Self-contained packaged browser code.
 */
export function openResponseUi(request, documentRef = globalThis.document, locationHref = globalThis.location?.href) {
  const fail = () => { throw new Error('unsupported_response_form'); };
  const url = new URL(locationHref);
  if (!request || !['open-picker', 'open-letter'].includes(request.operation) || url.origin !== 'https://hh.ru' || url.pathname !== '/applicant/vacancy_response' || url.searchParams.get('vacancyId') !== request.vacancyId) fail();
  let state;
  const raw = documentRef.querySelector('template#HH-Lux-InitialState')?.innerHTML;
  if (!raw || raw.length > 4000000) fail();
  try { state = JSON.parse(raw); } catch { fail(); }
  const vacancy = state.vacancyResponsePopup?.vacancy, session = state.session;
  if (state.userType !== 'applicant' || !state.account || !state.hhidAccount || session?.isFallback !== false || session?.securityCheckFailed !== false || session?.isMultiAccount !== false || session?.hasExtraAccounts !== false || !Number.isSafeInteger(vacancy?.shortVacancy?.vacancyId) || String(vacancy.shortVacancy.vacancyId) !== request.vacancyId || vacancy.responseImpossible !== false || vacancy.alreadyApplied !== false || vacancy.hasQuickResponse !== false || vacancy.test?.hasTests !== false) fail();
  const map = vacancy.resumes;
  if (!map || typeof map !== 'object' || Array.isArray(map) || !Object.keys(map).length || Object.keys(map).length > 100) fail();
  let found = 0;
  for (const [id, resume] of Object.entries(map)) {
    const attrs = resume?._attributes;
    if (!/^[1-9]\d{0,30}$/u.test(id) || attrs?.id !== id || typeof attrs.user !== 'string' || !/^[1-9]\d{0,30}$/u.test(attrs.user) || `hh-applicant-${attrs.user}` !== request.hhAccountKey || resume.forbidden !== null || attrs.permission !== 'edit') fail();
    if (attrs.hash === request.resumeId) found++;
  }
  if (found !== 1) fail();
  const existing = documentRef.querySelectorAll(request.operation === 'open-picker' ? '[role="dialog"][data-qa="drop-base"]' : 'textarea[data-qa="vacancy-response-popup-form-letter-input"]');
  if (existing.length === 1) return { opened: true };
  if (existing.length) fail();
  const controls = documentRef.querySelectorAll(request.operation === 'open-picker' ? '[data-qa="resume-title"]' : '[data-qa="vacancy-response-letter-toggle"]');
  if (controls.length !== 1 || controls[0].tagName !== 'DIV' || controls[0].closest('button,a,input,select') || controls[0].hidden || controls[0].getAttribute('aria-disabled') === 'true' || request.operation === 'open-letter' && controls[0].getAttribute('role') !== 'button') fail();
  controls[0].click();
  return { opened: true };
}

/** Narrow packaged contract grounded on the inspected HH popup and portal picker.
 * This is NOT enabled by default. Domain approval and complete history are required.
 * It accepts only an already-selected resume and an already-visible letter field.
 * No question answering, resume switching, toggle click or publication is supported.
 * Self-contained so Chrome can serialize it without remote code or selectors.
 */
export function responseFormOperation(request, documentRef = globalThis.document, locationHref = globalThis.location?.href) {
  const fail = code => { throw new Error(code); };
  const url = new URL(locationHref);
  if (!request || !['inspect', 'submit'].includes(request.operation) || url.origin !== 'https://hh.ru' || url.pathname !== '/applicant/vacancy_response' || url.searchParams.get('vacancyId') !== request.vacancyId || !/^[1-9]\d{0,19}$/u.test(request.vacancyId) || !/^[a-zA-Z0-9_-]{1,128}$/u.test(request.resumeId)) fail('unsupported_response_form');
  let ownedHashes;
  function account() {
    const raw = documentRef.querySelector('template#HH-Lux-InitialState')?.innerHTML;
    if (!raw || raw.length > 4000000) fail('account_identity_unverified');
    let data; try { data = JSON.parse(raw); } catch { fail('account_identity_unverified'); }
    if (data.userType !== 'applicant' || !data.account || !data.hhidAccount || data.session?.isFallback !== false || data.session?.securityCheckFailed !== false || data.session?.isMultiAccount !== false || data.session?.hasExtraAccounts !== false) fail('account_identity_unverified');
    const vacancy = data.vacancyResponsePopup?.vacancy, map = vacancy?.resumes;
    if (!Number.isSafeInteger(vacancy?.shortVacancy?.vacancyId) || String(vacancy.shortVacancy.vacancyId) !== request.vacancyId || vacancy.shortVacancy.closedForApplicants !== false || vacancy.shortVacancy.userTestPresent !== false || vacancy.responseImpossible !== false || vacancy.alreadyApplied !== false || vacancy.hasQuickResponse !== false || vacancy.test?.hasTests !== false || !Number.isSafeInteger(vacancy.letterMaxLength) || vacancy.letterMaxLength < 40 || vacancy.letterMaxLength > 10000 || !map || typeof map !== 'object' || Array.isArray(map) || !Object.keys(map).length || Object.keys(map).length > 100) fail('unsupported_response_form');
    ownedHashes = new Set();
    for (const [id, resume] of Object.entries(map)) {
      const attrs = resume?._attributes;
      if (!/^[1-9]\d{0,30}$/u.test(id) || attrs?.id !== id || typeof attrs.user !== 'string' || !/^[1-9]\d{0,30}$/u.test(attrs.user) || `hh-applicant-${attrs.user}` !== request.hhAccountKey || data.userId !== undefined && data.userId !== attrs.user || resume.forbidden !== null || attrs.permission !== 'edit' || typeof attrs.hash !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(attrs.hash) || ownedHashes.has(attrs.hash)) fail('account_identity_unverified');
      ownedHashes.add(attrs.hash);
    }
    if (!ownedHashes.has(request.resumeId)) fail('resume_ownership_unverified');
  }
  function form() {
    const inputs = documentRef.querySelectorAll('[data-qa="vacancy-response-popup-form-letter-input"]');
    const buttons = documentRef.querySelectorAll('[data-qa="vacancy-response-submit-popup"], [data-qa="vacancy-response-submit"]');
    if (inputs.length !== 1 || buttons.length !== 1) fail('unsupported_response_form');
    const letter = inputs[0], submit = buttons[0], node = letter.form;
    if (letter.tagName !== 'TEXTAREA' || !node || submit.form !== node || node.method.toLowerCase() !== 'post' || new URL(node.action).origin !== url.origin || new URL(node.action).pathname !== url.pathname || new URL(node.action).searchParams.has('vacancyId') && new URL(node.action).searchParams.get('vacancyId') !== request.vacancyId || letter.disabled || letter.readOnly || letter.hidden || submit.disabled || submit.hidden || letter.closest('[hidden],[aria-hidden="true"]') || submit.closest('[hidden],[aria-hidden="true"]')) fail('unsupported_response_form');
    for (const control of [letter, submit]) {
      const style = documentRef.defaultView.getComputedStyle(control);
      if (style.display === 'none' || style.visibility === 'hidden') fail('unsupported_response_form');
    }
    const dialogs = documentRef.querySelectorAll('[role="dialog"][data-qa="drop-base"]');
    if (dialogs.length !== 1 || dialogs[0].hidden || dialogs[0].getAttribute('aria-hidden') === 'true' || documentRef.defaultView.getComputedStyle(dialogs[0]).display === 'none') fail('resume_selection_unverified');
    const radios = [...dialogs[0].querySelectorAll('input[type="radio"]')];
    const selected = radios.filter(input => input.checked);
    if (!radios.length || radios.length > 100 || new Set(radios.map(input => input.value)).size !== radios.length || !radios.every(input => input.name === '' && input.form !== node && ownedHashes.has(input.value)) || selected.length !== 1 || selected[0].value !== request.resumeId || selected[0].disabled) fail('resume_selection_unverified');
    for (const control of node.querySelectorAll('input,textarea,select')) {
      if (control.type === 'hidden' && (/vacancy/iu.test(control.name) && control.value !== request.vacancyId || /resume/iu.test(control.name) && control.value !== request.resumeId)) fail('unsupported_response_form');
      if (control === letter || radios.includes(control) || control.tagName === 'INPUT' && control.type === 'hidden') continue;
      fail('unsupported_response_questions');
    }
    if (documentRef.querySelector('[data-qa*="validation"], .bloko-form-error')) fail('response_validation_failed');
    return { node, letter, submit };
  }
  account();
  let controls = form();
  if (request.operation === 'inspect') return { formVersion: 'hh-popup-portal-radio-v1', hhAccountKey: request.hhAccountKey, vacancyId: request.vacancyId, resumeId: request.resumeId };
  const permit = request.permit;
  if (!permit || permit.jobId !== request.jobId || permit.payloadHash !== request.payloadHash || !/^[a-f0-9]{64}$/u.test(request.payloadHash) || !/^[A-Za-z0-9_-]{43}$/u.test(permit.permitId) || !Number.isFinite(Date.parse(permit.expiresAt)) || Date.parse(permit.expiresAt) <= Date.now() || typeof request.coverLetter !== 'string' || request.coverLetter.trim().length < 40 || request.coverLetter.length > 2000) fail('invalid_mutation_permit');
  const windowRef = documentRef.defaultView;
  const marker = Symbol.for('hh-chairs-submission-started-v1');
  // This document can submit at most once, even after a callback throws.
  if (windowRef[marker]) fail('reconciliation_required');
  windowRef[marker] = request.jobId;
  const setter = Object.getOwnPropertyDescriptor(windowRef.HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) fail('unsupported_response_form');
  setter.call(controls.letter, request.coverLetter);
  controls.letter.dispatchEvent(new windowRef.Event('input', { bubbles: true }));
  controls.letter.dispatchEvent(new windowRef.Event('change', { bubbles: true }));
  account(); controls = form();
  if (controls.letter.value !== request.coverLetter || Date.parse(permit.expiresAt) <= Date.now()) fail('mutation_context_changed');
  controls.submit.click();
  return { submitted: true, confirmationRequired: true };
}
