const STATE_SELECTORS = Object.freeze({
  title: ["[data-qa=vacancy-title]", "h1"],
  description: [
    "[data-qa=vacancy-description]",
    "[data-qa=vacancy-view-description]",
    "main",
  ],
  validation: ["[data-qa*=validation]", ".bloko-form-error"],
  submit: [
    "[data-qa=vacancy-response-submit-popup]",
    "[data-qa=vacancy-response-submit]",
  ],
});

function firstText(
  documentRef: Document,
  selectors: readonly string[],
): string {
  for (const selector of selectors) {
    const value = documentRef.querySelector(selector)?.textContent?.trim();
    if (value) return value;
  }
  return "";
}

function collectText(
  documentRef: Document,
  selectors: readonly string[],
): string[] {
  return selectors
    .flatMap((selector) => [...documentRef.querySelectorAll(selector)])
    .map((node) => node.textContent?.trim() ?? "")
    .filter(Boolean);
}

function hasAny(documentRef: Document, selectors: readonly string[]): boolean {
  return selectors.some((selector) => documentRef.querySelector(selector));
}

function pageLocation(): string {
  return globalThis.location?.href ?? "";
}

function getActiveVacancyState(documentRef: Document = document) {
  const validation = collectText(documentRef, STATE_SELECTORS.validation);
  const text =
    firstText(documentRef, STATE_SELECTORS.description) ||
    documentRef.body?.innerText ||
    "";
  const canSubmit = hasAny(documentRef, STATE_SELECTORS.submit);

  return {
    url: pageLocation(),
    title: firstText(documentRef, STATE_SELECTORS.title),
    text,
    validation,
    formDetected: canSubmit,
    stuck: validation.length > 0,
  };
}

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if (
      message === null ||
      typeof message !== "object" ||
      !("type" in message) ||
      message.type !== "chairs:get-active-vacancy-state"
    ) {
      return false;
    }
    sendResponse(getActiveVacancyState());
    return true;
  },
);
