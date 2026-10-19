export type ResumeCatalogResult = {
  kind: "read_profile";
  readerVersion: "hh-owned-resume-catalog-v1";
  total: number;
  complete: boolean;
  resumes: Array<{
    resumeId: string;
    internalId: string;
    title: string;
    fullText: string;
  }>;
  unavailable: Array<{
    resumeId: string;
    title: string;
    reasonCode: "resume_unavailable" | "resume_text_budget_exceeded";
  }>;
};

/** Serialized into an extension-owned HH tab; no credentials or page callbacks. */
export function readResumeCatalogPage(
  request: { hhAccountKey: string },
  documentRef: Document = globalThis.document,
  locationHref: string = globalThis.location?.href,
): Array<{ resumeId: string; title: string }> {
  function fail(): never {
    throw Error("resume_catalog_unavailable");
  }
  const url = new URL(locationHref);
  if (
    url.protocol !== "https:" ||
    !/(^|\.)hh\.ru$/u.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.pathname !== "/applicant/profile/me" ||
    url.search
  ) {
    fail();
  }
  const raw = documentRef.querySelector(
    "template#HH-Lux-InitialState",
  )?.innerHTML;
  if (!raw || raw.length > 5000000) fail();
  const state = JSON.parse(raw);
  if (
    state.userType !== "applicant" ||
    !state.account ||
    !state.hhidAccount ||
    ![
      "isFallback",
      "securityCheckFailed",
      "isMultiAccount",
      "hasExtraAccounts",
    ].every((key) => state.session?.[key] === false) ||
    (state.userId != null &&
      `hh-applicant-${state.userId}` !== request.hhAccountKey)
  ) {
    fail();
  }
  const cards = Array.from(documentRef.querySelectorAll('[data-qa="resume"]'));
  const links = Array.from(
    documentRef.querySelectorAll('[data-qa^="resume-card-link-"]'),
  );
  if (
    links.length > 300 ||
    cards.some(
      (card) => !card.querySelector('[data-qa^="resume-card-link-"]'),
    ) ||
    documentRef.querySelector(
      '[data-qa="pager-next"]:not([disabled]):not([aria-disabled="true"])',
    )
  ) {
    fail();
  }
  if (
    !links.length &&
    !documentRef.querySelector('[data-qa="resume-list-empty"]') &&
    !(
      Array.isArray(state.applicantResumes) &&
      state.applicantResumes.length === 0
    )
  ) {
    fail();
  }
  const entries = new Map<string, { resumeId: string; title: string }>();
  for (const link of links) {
    const resumeId = /^resume-card-link-([A-Za-z0-9_-]{4,128})$/u.exec(
      link.getAttribute("data-qa") ?? "",
    )?.[1];
    if (!resumeId) fail();
    const href = link.getAttribute("href");
    if (href) {
      const target = new URL(href, url);
      if (
        target.protocol !== "https:" ||
        !/(^|\.)hh\.ru$/u.test(target.hostname) ||
        target.username ||
        target.password ||
        target.port ||
        target.hash ||
        target.pathname !== `/resume/${resumeId}`
      ) {
        fail();
      }
    }
    const card = link.closest('[data-qa="resume"]');
    const title = (
      link.querySelector('[data-qa="resume-title"]')?.textContent ??
      (card?.querySelectorAll('[data-qa^="resume-card-link-"]').length === 1
        ? card.querySelector('[data-qa="resume-title"]')?.textContent
        : null) ??
      link.textContent ??
      ""
    )
      .replace(/\s+/gu, " ")
      .trim();
    if (!title || title.length > 500) fail();
    if (!entries.has(resumeId)) entries.set(resumeId, { resumeId, title });
    if (entries.size > 100) fail();
  }
  return [...entries.values()];
}

/** Full CV reading does not require optional About or Skills sections. The
 * publication projection remains stricter for fields that it may edit. */
export function readOwnedResumeFullText(
  request: { resumeId: string; internalId: string; hhAccountKey: string },
  documentRef: Document = globalThis.document,
  locationHref: string = globalThis.location?.href,
): { title: string; fullText: string } {
  function fail(): never {
    throw Error("resume_full_profile_unavailable");
  }
  const url = new URL(locationHref);
  if (
    url.protocol !== "https:" ||
    !/(^|\.)hh\.ru$/u.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.search ||
    url.pathname !== `/resume/${request.resumeId}`
  ) {
    fail();
  }
  const raw = documentRef.querySelector(
    "template#HH-Lux-InitialState",
  )?.innerHTML;
  if (!raw || raw.length > 5000000) fail();
  const state = JSON.parse(raw);
  const resume = state.applicantResume;
  const attrs = resume?._attributes;
  if (
    state.userType !== "applicant" ||
    typeof state.userId !== "string" ||
    !/^[1-9]\d{0,19}$/u.test(state.userId) ||
    !state.account ||
    !state.hhidAccount ||
    request.hhAccountKey !== `hh-applicant-${state.userId}` ||
    ![
      "isFallback",
      "securityCheckFailed",
      "isMultiAccount",
      "hasExtraAccounts",
    ].every((key) => state.session?.[key] === false) ||
    resume?.forbidden !== null ||
    attrs?.hash !== request.resumeId ||
    attrs.id !== request.internalId ||
    attrs.user !== state.userId ||
    attrs.permission !== "edit" ||
    !Object.hasOwn(
      resume.applicantUserStatuses?.[state.userId] ?? {},
      "jobSearchStatus",
    )
  ) {
    fail();
  }
  const titles = documentRef.querySelectorAll(
    'h1[data-qa="resume-block-title-position"]',
  );
  if (titles.length !== 1) fail();
  const titleNode = titles[0];
  const title = titleNode.textContent?.replace(/\s+/gu, " ").trim();
  const root = titleNode.closest('main,[role="main"],[data-qa="resume"]');
  if (
    !title ||
    title.length > 1000 ||
    !root ||
    root === documentRef.body ||
    root === documentRef.documentElement
  ) {
    fail();
  }
  const pending: Array<Node | string> = [root];
  const parts: string[] = [];
  let visited = 0;
  let length = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (typeof node === "string") {
      parts.push(node);
      continue;
    }
    if (++visited > 100000) fail();
    if (node.nodeType === 3) {
      const text = node.nodeValue ?? "";
      length += text.length;
      if (length > 200000) fail();
      parts.push(text);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    const tag = element.tagName;
    if (
      /^(?:SCRIPT|STYLE|TEMPLATE|NAV|ASIDE|FOOTER|BUTTON|INPUT|SELECT|TEXTAREA|IFRAME)$/u.test(
        tag,
      ) ||
      element.hasAttribute("hidden") ||
      element.getAttribute("aria-hidden") === "true" ||
      element.getAttribute("role") === "navigation" ||
      /recommendation|promotion/u.test(element.getAttribute("data-qa") ?? "")
    ) {
      continue;
    }
    const block =
      /^(?:H[1-6]|P|DIV|SECTION|ARTICLE|LI|UL|OL|DL|DT|DD|TR|TABLE|MAIN|HEADER|BR)$/u.test(
        tag,
      );
    if (block) {
      parts.push("\n");
      pending.push("\n");
    }
    for (let index = node.childNodes.length - 1; index >= 0; index--) {
      pending.push(node.childNodes[index]);
    }
  }
  const fullText = parts
    .join("")
    .replace(/[\t\u00a0 ]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (!fullText || fullText.length > 200000 || !fullText.includes(title)) {
    fail();
  }
  return { title: title.slice(0, 500), fullText };
}
