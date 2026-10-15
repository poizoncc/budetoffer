import type { MutationPermit } from "../shared/companion-protocol.ts";

export interface ResponseIdentityRequest {
  vacancyId: string;
  resumeId: string;
  hhAccountKey: string;
}
export interface ResponseResumeEvidence extends ResponseIdentityRequest {
  resumeInternalId: string;
  ownershipVerified: true;
  selectionVerified: boolean;
  responseAllowed: boolean;
}
export interface ResponseUiRequest extends ResponseIdentityRequest {
  operation: "open-picker" | "open-letter";
}
export type ResponseFormRequest =
  | (ResponseIdentityRequest & { operation: "inspect" })
  | (ResponseIdentityRequest & {
      operation: "submit";
      permit: MutationPermit;
      jobId: string;
      payloadHash: string;
      coverLetter: string;
    });
export interface ResponseFormInspection extends ResponseIdentityRequest {
  formVersion: "hh-popup-portal-radio-v1";
}
export interface ResponseSubmission {
  submitted: true;
  confirmationRequired: true;
}

/** Read-only identity evidence from the observed response popup's owned resume map.
 * Membership proves ownership; a scoped checked portal radio proves selection.
 * No titles, contact details, cookies or form tokens leave this function.
 * Serialized by Chrome: runtime helpers must stay inside the function.
 */
export function readResponseResumeEvidence(
  request: ResponseIdentityRequest,
  documentRef: Document = globalThis.document,
  locationHref: string = globalThis.location?.href,
): ResponseResumeEvidence {
  function fail(code: string): never {
    throw new Error(code);
  }
  function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function numeric(value: unknown): value is string {
    return typeof value === "string" && /^[1-9]\d{0,30}$/u.test(value);
  }
  const url = new URL(locationHref);
  if (
    !request ||
    url.origin !== "https://hh.ru" ||
    url.pathname !== "/applicant/vacancy_response" ||
    url.searchParams.get("vacancyId") !== request.vacancyId ||
    !numeric(request.vacancyId) ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(request.resumeId)
  ) {
    fail("unsupported_response_form");
  }
  const raw = documentRef.querySelector(
    "template#HH-Lux-InitialState",
  )?.innerHTML;
  if (!raw || raw.length > 4_000_000) fail("response_identity_unverified");
  let state: unknown;
  try {
    state = JSON.parse(raw);
  } catch {
    fail("response_identity_unverified");
  }
  if (!record(state)) fail("response_identity_unverified");
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
    fail("response_identity_unverified");
  }
  const vacancy =
    record(state.vacancyResponsePopup) &&
    record(state.vacancyResponsePopup.vacancy)
      ? state.vacancyResponsePopup.vacancy
      : null;
  const shortVacancy =
    vacancy && record(vacancy.shortVacancy) ? vacancy.shortVacancy : null;
  const map = vacancy?.resumes;
  if (
    !Number.isSafeInteger(shortVacancy?.vacancyId) ||
    String(shortVacancy?.vacancyId) !== request.vacancyId
  ) {
    fail("response_vacancy_mismatch");
  }
  if (
    !record(map) ||
    !Object.keys(map).length ||
    Object.keys(map).length > 100
  ) {
    fail("response_identity_unverified");
  }
  const resumes: { resumeId: string; resumeInternalId: string }[] = [];
  const owners = new Set<string>();
  const hashes = new Set<string>();
  for (const [internalId, resume] of Object.entries(map)) {
    const attrs =
      record(resume) && record(resume._attributes) ? resume._attributes : null;
    if (
      !record(resume) ||
      resume.forbidden !== null ||
      !numeric(internalId) ||
      attrs?.id !== internalId ||
      !numeric(attrs.user) ||
      attrs.permission !== "edit" ||
      typeof attrs.hash !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(attrs.hash) ||
      hashes.has(attrs.hash)
    ) {
      fail("response_identity_unverified");
    }
    owners.add(attrs.user);
    hashes.add(attrs.hash);
    resumes.push({ resumeId: attrs.hash, resumeInternalId: internalId });
  }
  const owner = [...owners][0];
  if (
    owners.size !== 1 ||
    `hh-applicant-${owner}` !== request.hhAccountKey ||
    (state.userId !== undefined && state.userId !== owner)
  ) {
    fail("response_identity_unverified");
  }
  const targets = resumes.filter((row) => row.resumeId === request.resumeId);
  const target = targets[0];
  if (targets.length !== 1 || !target) fail("resume_ownership_unverified");
  const dialogs = documentRef.querySelectorAll(
    '[role="dialog"][data-qa="drop-base"]',
  );
  const buttons = documentRef.querySelectorAll(
    '[data-qa="vacancy-response-submit-popup"]',
  );
  const windowRef = documentRef.defaultView;
  const dialog = dialogs[0];
  const button = buttons[0];
  let selectionVerified = false;
  if (
    windowRef &&
    dialogs.length === 1 &&
    dialog instanceof windowRef.HTMLElement &&
    !dialog.hidden &&
    dialog.getAttribute("aria-hidden") !== "true" &&
    windowRef.getComputedStyle(dialog).display !== "none" &&
    buttons.length === 1 &&
    (button instanceof windowRef.HTMLButtonElement ||
      button instanceof windowRef.HTMLInputElement) &&
    button.form
  ) {
    const radioNodes = [...dialog.querySelectorAll('input[type="radio"]')];
    const radios = radioNodes.filter(
      (node): node is HTMLInputElement =>
        node instanceof windowRef.HTMLInputElement,
    );
    const selected = radios.filter((radio) => radio.checked);
    const chosen = selected[0];
    selectionVerified =
      radios.length === radioNodes.length &&
      radios.length > 0 &&
      radios.length <= 100 &&
      selected.length === 1 &&
      !!chosen &&
      chosen.value === request.resumeId &&
      !chosen.disabled &&
      radios.every(
        (radio) =>
          radio.name === "" &&
          radio.form !== button.form &&
          hashes.has(radio.value),
      ) &&
      new Set(radios.map((radio) => radio.value)).size === radios.length;
  }
  const test = vacancy && record(vacancy.test) ? vacancy.test : null;
  return {
    hhAccountKey: request.hhAccountKey,
    vacancyId: request.vacancyId,
    ...target,
    ownershipVerified: true,
    selectionVerified,
    responseAllowed:
      vacancy?.responseImpossible === false &&
      vacancy.alreadyApplied === false &&
      vacancy.hasQuickResponse === false &&
      test?.hasTests === false &&
      shortVacancy?.closedForApplicants === false &&
      shortVacancy.userTestPresent === false &&
      typeof vacancy.letterMaxLength === "number" &&
      Number.isSafeInteger(vacancy.letterMaxLength) &&
      vacancy.letterMaxLength >= 40 &&
      vacancy.letterMaxLength <= 10_000,
  };
}

/** Open only two observed, reversible DIV controls. Never select, fill or submit.
 * Self-contained packaged browser code, with no imported runtime helpers.
 */
export function openResponseUi(
  request: ResponseUiRequest,
  documentRef: Document = globalThis.document,
  locationHref: string = globalThis.location?.href,
): { opened: true } {
  function fail(): never {
    throw new Error("unsupported_response_form");
  }
  function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  const url = new URL(locationHref);
  if (
    !request ||
    !["open-picker", "open-letter"].includes(request.operation) ||
    url.origin !== "https://hh.ru" ||
    url.pathname !== "/applicant/vacancy_response" ||
    url.searchParams.get("vacancyId") !== request.vacancyId
  ) {
    fail();
  }
  const raw = documentRef.querySelector(
    "template#HH-Lux-InitialState",
  )?.innerHTML;
  if (!raw || raw.length > 4_000_000) fail();
  let state: unknown;
  try {
    state = JSON.parse(raw);
  } catch {
    fail();
  }
  if (!record(state)) fail();
  const vacancy =
    record(state.vacancyResponsePopup) &&
    record(state.vacancyResponsePopup.vacancy)
      ? state.vacancyResponsePopup.vacancy
      : null;
  const shortVacancy =
    vacancy && record(vacancy.shortVacancy) ? vacancy.shortVacancy : null;
  const test = vacancy && record(vacancy.test) ? vacancy.test : null;
  const session = record(state.session) ? state.session : null;
  if (
    state.userType !== "applicant" ||
    !state.account ||
    !state.hhidAccount ||
    session?.isFallback !== false ||
    session?.securityCheckFailed !== false ||
    session?.isMultiAccount !== false ||
    session?.hasExtraAccounts !== false ||
    !Number.isSafeInteger(shortVacancy?.vacancyId) ||
    String(shortVacancy?.vacancyId) !== request.vacancyId ||
    vacancy?.responseImpossible !== false ||
    vacancy.alreadyApplied !== false ||
    vacancy.hasQuickResponse !== false ||
    test?.hasTests !== false
  ) {
    fail();
  }
  const map = vacancy.resumes;
  if (
    !record(map) ||
    !Object.keys(map).length ||
    Object.keys(map).length > 100
  ) {
    fail();
  }
  let found = 0;
  for (const [id, resume] of Object.entries(map)) {
    const attrs =
      record(resume) && record(resume._attributes) ? resume._attributes : null;
    if (
      !/^[1-9]\d{0,30}$/u.test(id) ||
      attrs?.id !== id ||
      typeof attrs.user !== "string" ||
      !/^[1-9]\d{0,30}$/u.test(attrs.user) ||
      `hh-applicant-${attrs.user}` !== request.hhAccountKey ||
      !record(resume) ||
      resume.forbidden !== null ||
      attrs.permission !== "edit"
    ) {
      fail();
    }
    if (attrs.hash === request.resumeId) found++;
  }
  if (found !== 1) fail();
  const existing = documentRef.querySelectorAll(
    request.operation === "open-picker"
      ? '[role="dialog"][data-qa="drop-base"]'
      : 'textarea[data-qa="vacancy-response-popup-form-letter-input"]',
  );
  if (existing.length === 1) return { opened: true };
  if (existing.length) fail();
  const controls = documentRef.querySelectorAll(
    request.operation === "open-picker"
      ? '[data-qa="resume-title"]'
      : '[data-qa="vacancy-response-letter-toggle"]',
  );
  const control = controls[0];
  const windowRef = documentRef.defaultView;
  if (
    !windowRef ||
    controls.length !== 1 ||
    !(control instanceof windowRef.HTMLDivElement) ||
    control.closest("button,a,input,select") ||
    control.hidden ||
    control.getAttribute("aria-disabled") === "true" ||
    (request.operation === "open-letter" &&
      control.getAttribute("role") !== "button")
  ) {
    fail();
  }
  control.click();
  return { opened: true };
}

/** Narrow contract grounded on the inspected HH popup and portal picker.
 * Requires domain approval, complete history and an already-selected resume.
 * No question answering, resume switching or publication is supported.
 * Serialized by Chrome: runtime helpers and DOM constructors stay local.
 */
export function responseFormOperation(
  request: ResponseFormRequest,
  documentRef: Document = globalThis.document,
  locationHref: string = globalThis.location?.href,
): ResponseFormInspection | ResponseSubmission {
  function fail(code: string): never {
    throw new Error(code);
  }
  function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  const url = new URL(locationHref);
  if (
    !request ||
    !["inspect", "submit"].includes(request.operation) ||
    url.origin !== "https://hh.ru" ||
    url.pathname !== "/applicant/vacancy_response" ||
    url.searchParams.get("vacancyId") !== request.vacancyId ||
    !/^[1-9]\d{0,19}$/u.test(request.vacancyId) ||
    !/^[a-zA-Z0-9_-]{1,128}$/u.test(request.resumeId)
  ) {
    fail("unsupported_response_form");
  }
  const windowRef = documentRef.defaultView;
  if (!windowRef) fail("unsupported_response_form");
  let ownedHashes = new Set<string>();
  function account(): void {
    const raw = documentRef.querySelector(
      "template#HH-Lux-InitialState",
    )?.innerHTML;
    if (!raw || raw.length > 4_000_000) fail("account_identity_unverified");
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      fail("account_identity_unverified");
    }
    if (!record(data)) fail("account_identity_unverified");
    const session = record(data.session) ? data.session : null;
    if (
      data.userType !== "applicant" ||
      !data.account ||
      !data.hhidAccount ||
      session?.isFallback !== false ||
      session?.securityCheckFailed !== false ||
      session?.isMultiAccount !== false ||
      session?.hasExtraAccounts !== false
    ) {
      fail("account_identity_unverified");
    }
    const vacancy =
      record(data.vacancyResponsePopup) &&
      record(data.vacancyResponsePopup.vacancy)
        ? data.vacancyResponsePopup.vacancy
        : null;
    const shortVacancy =
      vacancy && record(vacancy.shortVacancy) ? vacancy.shortVacancy : null;
    const test = vacancy && record(vacancy.test) ? vacancy.test : null;
    const map = vacancy?.resumes;
    if (
      !Number.isSafeInteger(shortVacancy?.vacancyId) ||
      String(shortVacancy?.vacancyId) !== request.vacancyId ||
      shortVacancy?.closedForApplicants !== false ||
      shortVacancy.userTestPresent !== false ||
      vacancy?.responseImpossible !== false ||
      vacancy.alreadyApplied !== false ||
      vacancy.hasQuickResponse !== false ||
      test?.hasTests !== false ||
      typeof vacancy.letterMaxLength !== "number" ||
      !Number.isSafeInteger(vacancy.letterMaxLength) ||
      vacancy.letterMaxLength < 40 ||
      vacancy.letterMaxLength > 10_000 ||
      !record(map) ||
      !Object.keys(map).length ||
      Object.keys(map).length > 100
    ) {
      fail("unsupported_response_form");
    }
    ownedHashes = new Set<string>();
    for (const [id, resume] of Object.entries(map)) {
      const attrs =
        record(resume) && record(resume._attributes)
          ? resume._attributes
          : null;
      if (
        !/^[1-9]\d{0,30}$/u.test(id) ||
        attrs?.id !== id ||
        typeof attrs.user !== "string" ||
        !/^[1-9]\d{0,30}$/u.test(attrs.user) ||
        `hh-applicant-${attrs.user}` !== request.hhAccountKey ||
        (data.userId !== undefined && data.userId !== attrs.user) ||
        !record(resume) ||
        resume.forbidden !== null ||
        attrs.permission !== "edit" ||
        typeof attrs.hash !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/u.test(attrs.hash) ||
        ownedHashes.has(attrs.hash)
      ) {
        fail("account_identity_unverified");
      }
      ownedHashes.add(attrs.hash);
    }
    if (!ownedHashes.has(request.resumeId)) fail("resume_ownership_unverified");
  }
  function form(): {
    node: HTMLFormElement;
    letter: HTMLTextAreaElement;
    submit: HTMLButtonElement | HTMLInputElement;
  } {
    if (!windowRef) fail("unsupported_response_form");
    const inputs = documentRef.querySelectorAll(
      '[data-qa="vacancy-response-popup-form-letter-input"]',
    );
    const buttons = documentRef.querySelectorAll(
      '[data-qa="vacancy-response-submit-popup"], [data-qa="vacancy-response-submit"]',
    );
    const letter = inputs[0];
    const submit = buttons[0];
    if (
      inputs.length !== 1 ||
      buttons.length !== 1 ||
      !(letter instanceof windowRef.HTMLTextAreaElement) ||
      !(
        submit instanceof windowRef.HTMLButtonElement ||
        submit instanceof windowRef.HTMLInputElement
      )
    ) {
      fail("unsupported_response_form");
    }
    const node = letter.form;
    if (
      !node ||
      submit.form !== node ||
      node.method.toLowerCase() !== "post" ||
      new URL(node.action).origin !== url.origin ||
      new URL(node.action).pathname !== url.pathname ||
      (new URL(node.action).searchParams.has("vacancyId") &&
        new URL(node.action).searchParams.get("vacancyId") !==
          request.vacancyId) ||
      letter.disabled ||
      letter.readOnly ||
      letter.hidden ||
      submit.disabled ||
      submit.hidden ||
      letter.closest('[hidden],[aria-hidden="true"]') ||
      submit.closest('[hidden],[aria-hidden="true"]')
    ) {
      fail("unsupported_response_form");
    }
    for (const control of [letter, submit]) {
      const style = windowRef.getComputedStyle(control);
      if (style.display === "none" || style.visibility === "hidden") {
        fail("unsupported_response_form");
      }
    }
    const dialogs = documentRef.querySelectorAll(
      '[role="dialog"][data-qa="drop-base"]',
    );
    const dialog = dialogs[0];
    if (
      dialogs.length !== 1 ||
      !(dialog instanceof windowRef.HTMLElement) ||
      dialog.hidden ||
      dialog.getAttribute("aria-hidden") === "true" ||
      windowRef.getComputedStyle(dialog).display === "none"
    ) {
      fail("resume_selection_unverified");
    }
    const radioNodes = [...dialog.querySelectorAll('input[type="radio"]')];
    const radios = radioNodes.filter(
      (input): input is HTMLInputElement =>
        input instanceof windowRef.HTMLInputElement,
    );
    const selected = radios.filter((input) => input.checked);
    const chosen = selected[0];
    if (
      radios.length !== radioNodes.length ||
      !radios.length ||
      radios.length > 100 ||
      new Set(radios.map((input) => input.value)).size !== radios.length ||
      !radios.every(
        (input) =>
          input.name === "" &&
          input.form !== node &&
          ownedHashes.has(input.value),
      ) ||
      selected.length !== 1 ||
      !chosen ||
      chosen.value !== request.resumeId ||
      chosen.disabled
    ) {
      fail("resume_selection_unverified");
    }
    for (const control of node.querySelectorAll("input,textarea,select")) {
      if (!(
        control instanceof windowRef.HTMLInputElement ||
        control instanceof windowRef.HTMLTextAreaElement ||
        control instanceof windowRef.HTMLSelectElement
      )) {
        fail("unsupported_response_form");
      }
      if (
        control.type === "hidden" &&
        ((/vacancy/iu.test(control.name) &&
          control.value !== request.vacancyId) ||
          (/resume/iu.test(control.name) && control.value !== request.resumeId))
      ) {
        fail("unsupported_response_form");
      }
      if (
        control === letter ||
        radios.some((radio) => radio === control) ||
        (control instanceof windowRef.HTMLInputElement &&
          control.type === "hidden")
      ) {
        continue;
      }
      fail("unsupported_response_questions");
    }
    if (
      documentRef.querySelector('[data-qa*="validation"], .bloko-form-error')
    ) {
      fail("response_validation_failed");
    }
    return { node, letter, submit };
  }
  account();
  let controls = form();
  if (request.operation === "inspect") {
    return {
      formVersion: "hh-popup-portal-radio-v1",
      hhAccountKey: request.hhAccountKey,
      vacancyId: request.vacancyId,
      resumeId: request.resumeId,
    };
  }
  const permit = request.permit;
  if (
    !permit ||
    permit.jobId !== request.jobId ||
    permit.payloadHash !== request.payloadHash ||
    !/^[a-f0-9]{64}$/u.test(request.payloadHash) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(permit.permitId) ||
    !Number.isFinite(Date.parse(permit.expiresAt)) ||
    Date.parse(permit.expiresAt) <= Date.now() ||
    typeof request.coverLetter !== "string" ||
    request.coverLetter.trim().length < 40 ||
    request.coverLetter.length > 2_000
  ) {
    fail("invalid_mutation_permit");
  }
  const marker = Symbol.for("hh-chairs-submission-started-v1");
  // This document can submit at most once, even after a callback throws.
  if (Reflect.get(windowRef, marker)) fail("reconciliation_required");
  Reflect.set(windowRef, marker, request.jobId);
  const setter = Object.getOwnPropertyDescriptor(
    windowRef.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (!setter) fail("unsupported_response_form");
  setter.call(controls.letter, request.coverLetter);
  controls.letter.dispatchEvent(
    new windowRef.Event("input", { bubbles: true }),
  );
  controls.letter.dispatchEvent(
    new windowRef.Event("change", { bubbles: true }),
  );
  account();
  controls = form();
  if (
    controls.letter.value !== request.coverLetter ||
    Date.parse(permit.expiresAt) <= Date.now()
  ) {
    fail("mutation_context_changed");
  }
  controls.submit.click();
  return { submitted: true, confirmationRequired: true };
}
