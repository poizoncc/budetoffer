import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { createChromeExecution } from "../apps/chrome-companion/background/execution.ts";
import { readHistoryAccountIdentity } from "../apps/chrome-companion/hh/history-account.ts";
import { MAX_HISTORY_PAGES } from "../apps/chrome-companion/hh/history-limits.ts";
import { readPageEvidence } from "../apps/chrome-companion/hh/actions.ts";
import type {
  CompanionJob,
  JobPayloads,
} from "../apps/chrome-companion/shared/companion-protocol.ts";
import type { ExecutionChromeApi } from "../apps/chrome-companion/shared/chrome-api.ts";
import { companionJob, companionTransport } from "./helpers/companion.ts";
import { runSerialized } from "./helpers/chrome.ts";

const account = (userId = "101") => ({
  userType: "applicant",
  userId,
  account: {},
  hhidAccount: {},
  session: {
    isFallback: false,
    securityCheckFailed: false,
    isMultiAccount: false,
    hasExtraAccounts: false,
  },
});
const html = (state = {}, body = "") =>
  `<template id="HH-Lux-InitialState">${JSON.stringify({ ...account(), ...state })}</template>${body}`;
const job = companionJob;
test("history identity requires every nonempty row owner and refuses empty or conflicting evidence", () => {
  for (const [rows, expected] of [
    [[{ applicantUserId: 101 }], "hh-applicant-101"],
    [[], null],
    [[{ applicantUserId: 101 }, { applicantUserId: 202 }], null],
    [[{ applicantUserId: "101" }], null],
  ] as const) {
    const dom = new JSDOM(
      html({ userId: undefined, applicantNegotiations: { topicList: rows } }),
      { url: "https://hh.ru/applicant/negotiations" },
    );
    assert.equal(
      readHistoryAccountIdentity(dom.window.document, dom.window.location.href),
      expected,
    );
    dom.window.close();
  }
});
test("serialized history identity permits HH regions while rejecting unsafe hosts and conflicting owners", () => {
  const allowed = [
    "https://hh.ru",
    "https://kaliningrad.hh.ru",
    "https://spb.hh.ru",
  ];
  const rejected = [
    "https://hh.ru.example.invalid",
    "https://kaliningrad.hh.ru.example.invalid",
    "https://kaliningrad-hh.ru",
    "http://kaliningrad.hh.ru",
    "https://kaliningrad.hh.ru:8443",
    "https://user@kaliningrad.hh.ru",
    "https://user:password@kaliningrad.hh.ru",
    "https://kaliningrad.hh.ru.",
  ];
  for (const origin of [...allowed, ...rejected]) {
    const dom = new JSDOM(
      html({
        userId: undefined,
        applicantNegotiations: { topicList: [{ applicantUserId: 101 }] },
      }),
      {
        url: origin + "/applicant/negotiations?filter=active&page=0",
        runScripts: "outside-only",
      },
    );
    try {
      const read = () => runSerialized(dom, readHistoryAccountIdentity, []);
      assert.equal(
        read(),
        allowed.includes(origin) ? "hh-applicant-101" : null,
      );
      if (allowed.includes(origin)) {
        dom.reconfigure({ url: origin + "/applicant/negotiations#changed" });
        assert.equal(read(), null);
        dom.reconfigure({ url: origin + "/resume/resume-one" });
        assert.equal(read(), null);
        dom.reconfigure({ url: origin + "/applicant/negotiations" });
        dom.window.document.querySelector("template")!.innerHTML =
          JSON.stringify({
            ...account(),
            applicantNegotiations: { topicList: [{ applicantUserId: 202 }] },
          });
        assert.equal(read(), null);
      }
    } finally {
      dom.window.close();
    }
  }
});

test("empty history counts, tracking ID and applicant status cannot establish owner identity", () => {
  const dom = new JSDOM(
    html({
      userId: undefined,
      puid: "101",
      applicantUserStatuses: { "101": { jobSearchStatus: "active" } },
      applicantNegotiations: {
        topicList: [],
        pageCount: "0",
        total: 0,
        counts: { active: 0, archived: 0, deleted: 0 },
        paging: { next: { disabled: true } },
      },
    }),
    { url: "https://hh.ru/applicant/negotiations?filter=active&page=0" },
  );
  try {
    assert.equal(
      readHistoryAccountIdentity(dom.window.document, dom.window.location.href),
      null,
    );
  } finally {
    dom.window.close();
  }
});

function browser(
  page: (url: string) => string,
  redirect: (url: string) => string = (url) => url,
) {
  const tabs = new Map<
    number,
    { id: number; url: string; status: string; dom: JSDOM; documentId: string }
  >();
  const navigated: number[] = [];
  const removed: number[] = [];
  let next = 100;
  let documentCounter = 0;
  function set(id: number, requestedUrl: string) {
    const url = redirect(requestedUrl);
    tabs.get(id)?.dom.window.close();
    tabs.set(id, {
      id,
      url,
      status: "complete",
      dom: new JSDOM(page(url), { url, runScripts: "outside-only" }),
      documentId: "document-" + ++documentCounter,
    });
  }
  set(1, "https://hh.ru/");
  let afterRead: ((dom: JSDOM) => void) | undefined;
  const api: ExecutionChromeApi = {
    tabs: {
      async query() {
        return [...tabs.values()].map(({ dom, documentId, ...tab }) => tab);
      },
      async create({ url, active }: { url: string; active: boolean }) {
        assert.equal(active, false);
        const id = ++next;
        set(id, url);
        return { id, url, status: "complete" };
      },
      async get(id: number) {
        const t = tabs.get(id);
        if (!t) throw new Error("closed");
        return { id, url: t.url, status: t.status };
      },
      async update(
        id: number,
        { url, autoDiscardable }: { url?: string; autoDiscardable?: boolean },
      ) {
        assert.notEqual(id, 1);
        if (autoDiscardable !== undefined) {
          assert.equal(autoDiscardable, false);
          return { id, url: tabs.get(id)!.url };
        }
        navigated.push(id);
        set(id, url!);
        return { id, url };
      },
      async remove(id: number) {
        removed.push(id);
        assert.notEqual(id, 1);
        tabs.get(id)?.dom.window.close();
        tabs.delete(id);
      },
    },
    scripting: {
      async executeScript({ target, func, args }) {
        const tab = tabs.get(target.tabId);
        if (!tab) throw new Error("closed");
        if (target.documentIds && target.documentIds[0] !== tab.documentId) {
          throw new Error("document_replaced");
        }
        const result = await runSerialized(tab.dom, func, args);
        if (func.name === "readPageEvidence") afterRead?.(tab.dom);
        return [{ frameId: 0, documentId: tab.documentId, result }];
      },
    },
  };
  return {
    api,
    tabs,
    navigated,
    removed,
    afterRead(fn: (dom: JSDOM) => void) {
      afterRead = fn;
    },
    close() {
      for (const tab of tabs.values()) tab.dom.window.close();
    },
  };
}
function pages(url: string) {
  const parsed = new URL(url);
  if (parsed.pathname.startsWith("/vacancy/")) {
    return html(
      {},
      '<h1 data-qa="vacancy-title">Synthetic developer</h1><div data-qa="vacancy-description">Full synthetic vacancy text</div>',
    );
  }
  if (parsed.pathname.startsWith("/resume/")) {
    return html({
      applicantResume: {
        forbidden: null,
        applicantUserStatuses: { "101": { jobSearchStatus: "synthetic" } },
        _attributes: {
          id: "42",
          hash: "resume-one",
          user: "101",
          permission: "edit",
        },
      },
    });
  }
  if (parsed.pathname === "/applicant/negotiations") {
    return html({
      applicantNegotiations: {
        filterInUse: parsed.searchParams.get("filter"),
        pageCount: "1",
        paging: { next: { disabled: true } },
        topicList:
          parsed.searchParams.get("filter") === "active"
            ? [
                {
                  id: "7",
                  vacancyId: "123",
                  resumeId: "42",
                  initialState: "RESPONSE",
                },
              ]
            : [],
      },
    });
  }
  return html();
}
test("search reads full details, deduplicates across pages and reports bounded partial coverage", async () => {
  const chrome = browser((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/search/vacancy") {
      const page = Number(parsed.searchParams.get("page"));
      return html({
        vacancySearchResult: {
          vacancies: [
            {
              vacancyId: 123,
              name: "Snippet title",
              company: { visibleName: "Synthetic" },
            },
          ],
          paging: {
            pages: [{ page, selected: true }],
            next: { disabled: page === 1, page: page + 1 },
          },
        },
      });
    }
    return pages(url);
  });
  try {
    const execution = createChromeExecution(
      chrome.api,
      {},
      { load: async () => null },
    );
    const payload: JobPayloads["discover_search"] = {
      kind: "discover_search",
      savedSearchId: "search-one",
      text: "frontend",
      maxPages: 2,
      searchParameters: [["area", "1"]],
    };
    const receipt = await execution.execute(job(payload));
    assert.equal(receipt.outcome, "confirmed");
    assert.deepEqual(receipt.result, {
      kind: "discover_search",
      savedSearchId: "search-one",
      pages: 2,
      complete: true,
      vacancies: [
        {
          vacancyId: "123",
          title: "Synthetic developer",
          company: "Synthetic",
          text: "Full synthetic vacancy text",
        },
      ],
    });
    const partial = await execution.execute(job({ ...payload, maxPages: 1 }));
    assert.ok(partial.result?.kind === "discover_search");
    assert.equal(partial.result.complete, false);
    assert.equal(partial.result.vacancies.length, 1);
    const unsafe = await execution.execute(
      job({ ...payload, searchParameters: [["redirect", "evil"]] }),
    );
    assert.equal(unsafe.evidence.reasonCode, "invalid_read_payload");
    assert.equal(chrome.tabs.size, 1);
  } finally {
    chrome.close();
  }
});
test("search checks public cache before details and retains legacy fallback without changing issued payloads", async () => {
  let detailCalls = 0;
  let lookups = 0;
  const chrome = browser((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/search/vacancy") {
      return html({
        vacancySearchResult: {
          vacancies: [
            {
              vacancyId: 123,
              name: "Snippet",
              company: { visibleName: "Private snippet" },
            },
          ],
          paging: {
            pages: [{ page: 0, selected: true }],
            next: { disabled: true },
          },
        },
      });
    }
    if (parsed.pathname.startsWith("/vacancy/")) detailCalls++;
    return pages(url);
  });
  const issued = job({
    kind: "discover_search",
    savedSearchId: "search-one",
    text: "frontend",
    maxPages: 1,
  });
  const before = JSON.stringify(issued);
  let hit = true;
  const transport = {
    async publicDetails(
      received: Pick<
        CompanionJob,
        "jobId" | "leaseToken" | "payloadHash" | "hhAccountKey"
      >,
      ids: string[],
    ) {
      lookups++;
      assert.equal(received, issued);
      assert.deepEqual(ids, ["123"]);
      return {
        vacancies: hit
          ? [
              {
                vacancyId: "123",
                title: "Trusted public title",
                company: "Public company",
                text: "Full trusted public source document",
              },
            ]
          : [],
      };
    },
  };
  try {
    const execution = createChromeExecution(chrome.api, transport, {
      load: async () => null,
    });
    const cached = await execution.execute(issued);
    assert.equal(cached.outcome, "confirmed");
    assert.equal(detailCalls, 0);
    assert.equal(lookups, 1);
    assert.ok(cached.result?.kind === "discover_search");
    assert.equal(cached.result.vacancies[0].title, "Trusted public title");
    assert.equal(cached.result.vacancies[0].company, "Public company");
    hit = false;
    const fallback = await execution.execute(issued);
    assert.equal(fallback.outcome, "confirmed");
    assert.equal(detailCalls, 1);
    assert.ok(fallback.result?.kind === "discover_search");
    assert.equal(
      fallback.result.vacancies[0].text,
      "Full synthetic vacancy text",
    );
    assert.equal(JSON.stringify(issued), before);
  } finally {
    chrome.close();
  }
});
test("search rejects uncertain pagination and never turns snippets into results", async () => {
  const chrome = browser((url) =>
    new URL(url).pathname === "/search/vacancy"
      ? html({
          vacancySearchResult: {
            vacancies: [{ vacancyId: 123, name: "Snippet" }],
            paging: {
              pages: [{ page: 4, selected: true }],
              next: { disabled: true },
            },
          },
        })
      : pages(url),
  );
  try {
    const receipt = await createChromeExecution(
      chrome.api,
      {},
      { load: async () => null },
    ).execute(
      job({
        kind: "discover_search",
        savedSearchId: "search-one",
        text: "",
        maxPages: 1,
      }),
    );
    assert.equal(receipt.outcome, "needs_user");
    assert.equal(receipt.result, undefined);
  } finally {
    chrome.close();
  }
});
test("Chrome read executor collects exact full vacancy in its own tab and retains user tabs", async () => {
  const chrome = browser(pages);
  try {
    const execution = createChromeExecution(
      chrome.api,
      {},
      { load: async () => null },
    );
    assert.equal(await execution.identity(), "hh-applicant-101");
    const result = await execution.execute(
      job({
        kind: "verify_vacancy",
        applicationId: "app-one",
        vacancyId: "123",
        expectedVersion: 1,
      }),
    );
    assert.equal(result.outcome, "confirmed");
    assert.deepEqual(result.result, {
      kind: "verify_vacancy",
      vacancyId: "123",
      title: "Synthetic developer",
      text: "Full synthetic vacancy text",
    });
    assert.equal(chrome.tabs.size, 1);
    assert.ok(chrome.tabs.has(1));
    assert.equal(chrome.removed.length, 1);
  } finally {
    chrome.close();
  }
});
test("inactive hidden documents are read without activating tabs or requiring the popup", async () => {
  const chrome = browser(pages);
  let hiddenReads = 0;
  chrome.afterRead((dom) => {
    assert.equal(dom.window.document.visibilityState, "prerender");
    hiddenReads++;
  });
  try {
    const result = await createChromeExecution(
      chrome.api,
      {},
      { load: async () => null },
    ).execute(
      job({
        kind: "verify_vacancy",
        applicationId: "app-one",
        vacancyId: "123",
        expectedVersion: 1,
      }),
    );
    assert.equal(result.outcome, "confirmed");
    assert.equal(hiddenReads, 1);
    assert.equal(chrome.tabs.size, 1);
  } finally {
    chrome.close();
  }
});
test("discarded or frozen owned tabs stop with needs_user without retrying their document", async () => {
  for (const state of ["discarded", "frozen"]) {
    const chrome = browser(pages);
    const get = chrome.api.tabs.get;
    chrome.api.tabs.get = async (id) => ({
      ...(await get(id)),
      [state]: id !== 1,
    });
    try {
      const result = await createChromeExecution(
        chrome.api,
        {},
        { load: async () => null },
      ).execute(
        job({
          kind: "verify_vacancy",
          applicationId: "app-one",
          vacancyId: "123",
          expectedVersion: 1,
        }),
      );
      assert.equal(result.outcome, "needs_user");
      assert.equal(result.evidence.reasonCode, "hh_tab_suspended");
      assert.equal(chrome.tabs.size, 1);
    } finally {
      chrome.close();
    }
  }
});
test("account changed while reading drops private result before receipt", async () => {
  const chrome = browser(pages);
  chrome.afterRead((dom) => {
    dom.window.document.querySelector("template")!.innerHTML = JSON.stringify(
      account("202"),
    );
  });
  try {
    const result = await createChromeExecution(
      chrome.api,
      {},
      { load: async () => null },
    ).execute(
      job({
        kind: "verify_vacancy",
        applicationId: "app-one",
        vacancyId: "123",
        expectedVersion: 1,
      }),
    );
    assert.equal(result.outcome, "needs_user");
    assert.equal(result.evidence.reasonCode, "account_changed");
    assert.equal(result.result, undefined);
  } finally {
    chrome.close();
  }
});
test("profile reads only explicit resume identities; CV import remains unsupported", async () => {
  const chrome = browser(pages);
  try {
    const execution = createChromeExecution(
      chrome.api,
      {},
      { load: async () => null },
    );
    const result = await execution.execute(
      job({
        kind: "read_profile",
        includeResumeIds: ["resume-one"],
        includeProfileText: false,
      }),
    );
    assert.equal(result.outcome, "confirmed");
    assert.ok(result.result?.kind === "read_profile");
    assert.equal(result.result.resumes[0].internalId, "42");
    const unsupported = await execution.execute(
      job({
        kind: "read_profile",
        includeResumeIds: ["resume-one"],
        includeProfileText: true,
      }),
    );
    assert.equal(unsupported.evidence.reasonCode, "profile_text_not_supported");
  } finally {
    chrome.close();
  }
});
test("profile verification follows the same resume on a regional HH host and closes only its own tab", async () => {
  const chrome = browser(pages, (url) =>
    url.includes("/resume/")
      ? url.replace("https://hh.ru/", "https://kaliningrad.hh.ru/")
      : url,
  );
  try {
    const receipt = await createChromeExecution(
      chrome.api,
      {},
      { load: async () => null },
    ).execute(
      job({
        kind: "read_profile",
        includeResumeIds: ["resume-one"],
        includeProfileText: false,
      }),
    );
    assert.equal(receipt.outcome, "confirmed");
    assert.ok(receipt.result?.kind === "read_profile");
    assert.equal(receipt.result.resumes.length, 1);
    assert.equal(receipt.result.resumes[0].resumeId, "resume-one");
    assert.equal(receipt.result.resumes[0].internalId, "42");
    assert.equal(chrome.tabs.size, 1);
    assert.ok(chrome.tabs.has(1));
    assert.deepEqual(chrome.removed, [101]);
  } finally {
    chrome.close();
  }
});
test("serialized resume reader allows HH regions and independently refuses foreign hosts", () => {
  for (const host of [
    "hh.ru",
    "kaliningrad.hh.ru",
    "hh.ru.example.invalid",
    "example.invalid",
  ]) {
    const url = `https://${host}/resume/resume-one`;
    const dom = new JSDOM(pages(url), { url, runScripts: "outside-only" });
    try {
      const action = () =>
        runSerialized(dom, readPageEvidence, [
          { operation: "resume", resumeId: "resume-one" },
        ]);
      if (host === "hh.ru" || host === "kaliningrad.hh.ru") {
        const result = action();
        assert.ok("internalId" in result);
        assert.equal(result.internalId, "42");
      } else assert.throws(action, /unexpected_hh_navigation/u);
    } finally {
      dom.window.close();
    }
  }
});
test("regional resume redirects do not permit another host, resource, query, or unsafe URL", async () => {
  for (const target of [
    "https://hh.ru.example.invalid/resume/resume-one",
    "https://example.invalid/resume/resume-one",
    "http://kaliningrad.hh.ru/resume/resume-one",
    "https://user@kaliningrad.hh.ru/resume/resume-one",
    "https://kaliningrad.hh.ru:8443/resume/resume-one",
    "https://kaliningrad.hh.ru/resume/resume-one#other",
    "https://kaliningrad.hh.ru/resume/resume-two",
    "https://kaliningrad.hh.ru/resume/resume-one?other=1",
  ]) {
    const chrome = browser(pages, (url) =>
      url.includes("/resume/") ? target : url,
    );
    try {
      const receipt = await createChromeExecution(
        chrome.api,
        {},
        { load: async () => null },
      ).execute(
        job({
          kind: "read_profile",
          includeResumeIds: ["resume-one"],
          includeProfileText: false,
        }),
      );
      assert.equal(receipt.outcome, "needs_user", target);
      assert.equal(
        receipt.evidence.reasonCode,
        "unexpected_hh_navigation",
        target,
      );
      assert.equal(receipt.result, undefined);
      assert.ok(chrome.tabs.has(1));
      assert.deepEqual(chrome.removed, []);
    } finally {
      chrome.close();
    }
  }
});
test("a regional resume still requires the same account and editable ownership", async () => {
  for (const mismatch of ["account", "owner", "hash"]) {
    const chrome = browser(
      (url) =>
        new URL(url).pathname.startsWith("/resume/")
          ? html({
              ...account(mismatch === "account" ? "202" : "101"),
              applicantResume: {
                forbidden: null,
                applicantUserStatuses: {
                  "101": { jobSearchStatus: "synthetic" },
                },
                _attributes: {
                  id: "42",
                  hash: mismatch === "hash" ? "resume-two" : "resume-one",
                  user: mismatch === "owner" ? "202" : "101",
                  permission: "edit",
                },
              },
            })
          : pages(url),
      (url) =>
        url.includes("/resume/")
          ? url.replace("https://hh.ru/", "https://kaliningrad.hh.ru/")
          : url,
    );
    try {
      const receipt = await createChromeExecution(
        chrome.api,
        {},
        { load: async () => null },
      ).execute(
        job({
          kind: "read_profile",
          includeResumeIds: ["resume-one"],
          includeProfileText: false,
        }),
      );
      assert.equal(receipt.outcome, "needs_user");
      assert.equal(
        receipt.evidence.reasonCode,
        mismatch === "account"
          ? "account_identity_unverified"
          : "resume_identity_mismatch",
      );
      assert.equal(receipt.result, undefined);
      assert.equal(chrome.tabs.size, 1);
    } finally {
      chrome.close();
    }
  }
});
test("resume identity without matching editable applicant ownership cannot be used for profile or history", async () => {
  for (const attributes of [
    { user: "202", permission: "edit" },
    { user: "101", permission: "view" },
    { user: "101" },
  ]) {
    const chrome = browser((url) =>
      new URL(url).pathname.startsWith("/resume/")
        ? html({
            applicantResume: {
              forbidden: null,
              applicantUserStatuses: {
                "101": { jobSearchStatus: "synthetic" },
              },
              _attributes: { id: "42", hash: "resume-one", ...attributes },
            },
          })
        : pages(url),
    );
    try {
      const execution = createChromeExecution(
        chrome.api,
        {},
        { load: async () => null },
      );
      const receipt = await execution.execute(
        job({
          kind: "read_profile",
          includeResumeIds: ["resume-one"],
          includeProfileText: false,
        }),
      );
      assert.equal(receipt.outcome, "needs_user");
      assert.equal(receipt.evidence.reasonCode, "resume_identity_mismatch");
    } finally {
      chrome.close();
    }
  }
});
test("history reconciler reads all three lists and matches exact vacancy/resume pair", async () => {
  const chrome = browser(pages);
  try {
    const result = await createChromeExecution(
      chrome.api,
      {},
      { load: async () => null },
    ).execute(
      job({
        kind: "reconcile_history",
        originalJobId: "original-one",
        applicationId: "app-one",
        vacancyId: "123",
        resumeId: "resume-one",
      }),
    );
    assert.equal(result.outcome, "already_exists");
    assert.ok(result.result?.kind === "reconcile_history");
    assert.equal(result.result.negotiationId, "7");
    assert.equal(result.result.pages, 3);
    assert.equal(result.result.complete, true);
    assert.ok(chrome.navigated.every((id) => id !== 1));
  } finally {
    chrome.close();
  }
});
test("missing history and unauthorized mutation never authorize or submit", async () => {
  const chrome = browser(pages);
  let permits = 0;
  try {
    const execution = createChromeExecution(
      chrome.api,
      companionTransport({
        authorize: async () => {
          permits++;
        },
      }),
      { load: async () => null },
    );
    const missing = await execution.execute(
      job({
        kind: "reconcile_history",
        originalJobId: "original-one",
        applicationId: "app-one",
        vacancyId: "999",
        resumeId: "resume-one",
      }),
    );
    assert.equal(missing.evidence.reasonCode, "history_not_confirmed");
    assert.equal(missing.result, undefined);
    const mutationJob = job({
      kind: "apply_vacancy",
      applicationId: "app-one",
      vacancyId: "123",
      resumeId: "resume-one",
      expectedVersion: 1,
      coverLetter: "",
    });
    const mutation = await execution.execute(mutationJob);
    assert.equal(mutation.evidence.reasonCode, "resume_ownership_unverified");
    assert.equal(permits, 0);
    const blocked = await createChromeExecution(
      chrome.api,
      {},
      { load: async () => ({ ...mutationJob, phase: "authorized" }) },
    ).execute(mutationJob);
    assert.equal(blocked.outcome, "unknown");
    assert.equal(blocked.evidence.reasonCode, "reconciliation_required");
  } finally {
    chrome.close();
  }
});
test("verified homepage and owned resume do not turn ownerless empty history into permission to send", async () => {
  const chrome = browser((url) => {
    const parsed = new URL(url);
    return parsed.pathname === "/applicant/negotiations"
      ? html({
          userId: undefined,
          applicantNegotiations: {
            filterInUse: parsed.searchParams.get("filter"),
            pageCount: "0",
            paging: { next: { disabled: true } },
            topicList: [],
          },
        })
      : pages(url);
  });
  try {
    const execution = createChromeExecution(
      chrome.api,
      {},
      { load: async () => null },
    );
    assert.equal(await execution.identity(), "hh-applicant-101");
    const result = await execution.execute(
      job({
        kind: "reconcile_history",
        originalJobId: "original-one",
        applicationId: "app-one",
        vacancyId: "123",
        resumeId: "resume-one",
      }),
    );
    assert.equal(result.outcome, "needs_user");
    assert.equal(result.evidence.reasonCode, "account_identity_unverified");
    assert.equal(result.result, undefined);
    assert.equal(chrome.tabs.size, 1);
  } finally {
    chrome.close();
  }
});
test("user navigation takes a created tab out of executor ownership without closing it", async () => {
  const chrome = browser(pages);
  chrome.afterRead(() => {
    chrome.tabs.get(101)!.url = "https://example.invalid/user-page";
  });
  try {
    const result = await createChromeExecution(
      chrome.api,
      {},
      { load: async () => null },
    ).execute(
      job({
        kind: "verify_vacancy",
        applicationId: "app-one",
        vacancyId: "123",
        expectedVersion: 1,
      }),
    );
    assert.equal(result.outcome, "needs_user");
    assert.equal(result.evidence.reasonCode, "unexpected_hh_navigation");
    assert.ok(chrome.tabs.has(101));
    assert.deepEqual(chrome.removed, []);
  } finally {
    chrome.close();
  }
});
test("incomplete history pagination and conflicting negotiation identities cannot confirm an application", async () => {
  for (const mode of ["incomplete", "conflict"]) {
    const chrome = browser((url) => {
      const parsed = new URL(url);
      if (parsed.pathname !== "/applicant/negotiations") return pages(url);
      return html({
        applicantNegotiations: {
          filterInUse: parsed.searchParams.get("filter"),
          pageCount: mode === "incomplete" ? "2" : "1",
          paging: { next: { disabled: true } },
          topicList: [
            {
              id: "7",
              vacancyId:
                parsed.searchParams.get("filter") === "archived"
                  ? "999"
                  : "123",
              resumeId: "42",
              initialState: "RESPONSE",
            },
          ],
        },
      });
    });
    try {
      const result = await createChromeExecution(
        chrome.api,
        {},
        { load: async () => null },
      ).execute(
        job({
          kind: "reconcile_history",
          originalJobId: "original-one",
          applicationId: "app-one",
          vacancyId: "123",
          resumeId: "resume-one",
        }),
      );
      assert.equal(result.outcome, "needs_user");
      assert.equal(result.result, undefined);
      assert.equal(
        result.evidence.reasonCode,
        mode === "incomplete"
          ? "incomplete_history_page"
          : "history_identity_missing",
      );
    } finally {
      chrome.close();
    }
  }
});
test("history limit supports 65 observed-size pages and exact120 total;121 remains incomplete", async () => {
  assert.equal(MAX_HISTORY_PAGES, 120);
  for (const counts of [
    [8, 56, 1],
    [1, 118, 1],
    [1, 119, 1],
  ]) {
    let reads = 0;
    const chrome = browser((url) => {
      const parsed = new URL(url);
      if (parsed.pathname !== "/applicant/negotiations") return pages(url);
      const filter = parsed.searchParams.get("filter")!;
      const index = ["active", "archived", "deleted"].indexOf(filter);
      const page = Number(parsed.searchParams.get("page"));
      reads++;
      return html({
        applicantNegotiations: {
          filterInUse: filter,
          pageCount: String(counts[index]),
          paging: { next: { disabled: page === counts[index] - 1 } },
          topicList: [
            {
              id: String(1000 + index * 1000 + page),
              vacancyId: index === 0 && page === 0 ? "123" : "999",
              resumeId: "42",
              initialState: "RESPONSE",
              applicantUserId: 101,
            },
          ],
        },
      });
    });
    try {
      const result = await createChromeExecution(
        chrome.api,
        {},
        { load: async () => null },
      ).execute(
        job({
          kind: "reconcile_history",
          originalJobId: "original-one",
          applicationId: "app-one",
          vacancyId: "123",
          resumeId: "resume-one",
        }),
      );
      const total = counts.reduce((a, b) => a + b, 0);
      if (total <= 120) {
        assert.equal(result.outcome, "already_exists");
        assert.ok(result.result?.kind === "reconcile_history");
        assert.equal(result.result.pages, total);
        assert.equal(result.result.complete, true);
      } else {
        assert.equal(result.evidence.reasonCode, "incomplete_history_page");
        assert.equal(result.result, undefined);
      }
      assert.equal(reads, Math.min(total, 120));
    } finally {
      chrome.close();
    }
  }
});
test("serialized history reader accepts page119 and rejects page120 without relaxing search limits", () => {
  for (const page of [119, 120]) {
    const url = `https://hh.ru/applicant/negotiations?filter=archived&page=${page}`;
    const dom = new JSDOM(
      html({
        applicantNegotiations: {
          filterInUse: "archived",
          pageCount: "120",
          paging: { next: { disabled: true } },
          topicList: [],
        },
      }),
      { url, runScripts: "outside-only" },
    );
    try {
      const action = () =>
        runSerialized(dom, readPageEvidence, [
          { operation: "history", filter: "archived", page },
        ]);
      if (page === 119) {
        const result = action();
        assert.ok("pageCount" in result);
        assert.equal(result.pageCount, 120);
      } else assert.throws(action, /history_target_mismatch/);
    } finally {
      dom.window.close();
    }
  }
});
