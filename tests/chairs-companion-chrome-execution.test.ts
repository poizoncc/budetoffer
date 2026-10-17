import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { createChromeExecution } from "../apps/chrome-companion/background/execution.ts";
import { readHistoryAccountIdentity } from "../apps/chrome-companion/hh/history-account.ts";
import { readFullHistoryPage } from "../apps/chrome-companion/hh/full-history.ts";
import { readChatSnapshot } from "../apps/chrome-companion/hh/chat-snapshot.ts";
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
    [[{ applicantUserId: "101" }], "hh-applicant-101"],
    [[{ applicantUserId: "00101" }], null],
    [[{ applicantUserId: "1e2" }], null],
    [[{ applicantUserId: Number.MAX_SAFE_INTEGER + 1 }], null],
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
test("history diagnostic snapshots preserve safe failure codes across serialization and accept matching decimal owners", () => {
  for (const [userId, rows, reason] of [
    [101, [{ applicantUserId: "101" }], null],
    [undefined, [], "history_identity_missing"],
    [
      undefined,
      [{ applicantUserId: 101 }, { applicantUserId: "202" }],
      "history_ambiguous",
    ],
    ["202", [{ applicantUserId: 101 }], "account_changed"],
  ] as const) {
    const dom = new JSDOM(
      html({ userId, applicantNegotiations: { topicList: rows } }),
      {
        url: "https://hh.ru/applicant/negotiations",
        runScripts: "outside-only",
      },
    );
    try {
      const snapshot = runSerialized(dom, readHistoryAccountIdentity, [
        null,
        null,
        true,
      ]) as { accountKey: string | null; reasonCode: string | null };
      assert.deepEqual(Object.keys(snapshot).sort(), [
        "accountKey",
        "emptyHistoryPage",
        "reasonCode",
      ]);
      assert.equal(snapshot.reasonCode, reason);
      assert.equal(snapshot.accountKey, reason ? null : "hh-applicant-101");
    } finally {
      dom.window.close();
    }
  }
});
test("full history reads numeric and canonical string owners without accepting a foreign owner", () => {
  const request = {
    filter: "active" as const,
    page: 0,
    hhAccountKey: "hh-applicant-101",
    observedAt: new Date().toISOString(),
  };
  for (const applicantUserId of [101, "101", "202", "00101"]) {
    const dom = new JSDOM(
      html({
        userId: 101,
        applicantNegotiations: {
          filterInUse: "active",
          pageCount: 1,
          paging: { next: { disabled: true } },
          topicList: [
            {
              id: "1",
              vacancyId: "123",
              resumeId: "42",
              applicantUserId,
              initialState: "RESPONSE",
            },
          ],
        },
      }),
      {
        url: "https://hh.ru/applicant/negotiations?filter=active&page=0",
        runScripts: "outside-only",
      },
    );
    try {
      if (applicantUserId === 101 || applicantUserId === "101") {
        const page = runSerialized(dom, readFullHistoryPage, [request]) as {
          observations: unknown[];
        };
        assert.equal(page.observations.length, 1);
      } else {
        assert.throws(
          () => runSerialized(dom, readFullHistoryPage, [request]),
          /account_identity_unverified/,
        );
      }
    } finally {
      dom.window.close();
    }
  }
});

test("full history traverses48 owned rows and empty lists only with independently fresh matching identity", async () => {
  for (const scenario of [
    "matching",
    "foreign-before",
    "changed-after",
    "inconsistent-empty",
  ] as const) {
    let homeReads = 0;
    const chrome = browser((url) => {
      const parsed = new URL(url);
      if (parsed.pathname !== "/applicant/negotiations") {
        homeReads++;
        return html(
          account(
            (scenario === "foreign-before" && homeReads >= 2) ||
              (scenario === "changed-after" && homeReads >= 3)
              ? "202"
              : "101",
          ),
        );
      }
      const filter = parsed.searchParams.get("filter");
      const page = Number(parsed.searchParams.get("page"));
      const active = filter === "active";
      let count = 0;
      if (active) count = page < 2 ? 20 : 8;
      let total = scenario === "inconsistent-empty" ? 5 : 0;
      if (active) total = 48;
      return html({
        userId: undefined,
        applicantNegotiations: {
          filterInUse: filter,
          total,
          pageCount: active ? "3" : "0",
          paging: { next: { disabled: !active || page === 2 } },
          topicList: Array.from({ length: count }, (_, index) => ({
            id: String(page * 20 + index + 1),
            vacancyId: "123",
            resumeId: "42",
            applicantUserId: 101,
            initialState: "RESPONSE",
          })),
        },
      });
    });
    try {
      const result = await createChromeExecution(chrome.api, null, {
        load: async () => null,
      }).execute(job({ kind: "read_hh_history", maxPages: 120 }));
      if (scenario === "matching") {
        assert.equal(result.outcome, "confirmed");
        assert.equal(result.result?.kind, "read_hh_history");
        if (result.result?.kind !== "read_hh_history") {
          assert.fail("history result required");
        }
        assert.equal(result.result.complete, true);
        assert.equal(result.result.pages, 5);
        assert.equal(result.result.observations.length, 48);
        assert.equal(
          homeReads,
          5,
          "each empty list gets a fresh account check before and after",
        );
      } else {
        assert.equal(result.outcome, "needs_user");
        assert.equal(result.result, undefined);
        let expected = "history_identity_missing";
        if (scenario === "foreign-before") {
          expected = "account_identity_unverified";
        }
        if (scenario === "changed-after") expected = "account_changed";
        assert.equal(result.evidence.reasonCode, expected);
      }
      assert.equal(
        chrome.tabs.size,
        1,
        "owned proof tabs close without closing the user tab",
      );
    } finally {
      chrome.close();
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

test("full history reads all active and archived pages when the zero-total deleted list has no pagination controls", async () => {
  for (const empty of [
    {},
    { pageCount: "0" },
    { pageCount: "1", paging: null },
    { pageCount: 0, paging: {} },
    { pageCount: "0", paging: { next: null } },
    { pageCount: "0", paging: { next: { disabled: true } } },
  ]) {
    let homeReads = 0;
    const visited: string[] = [];
    const chrome = browser((url) => {
      const parsed = new URL(url);
      if (parsed.pathname !== "/applicant/negotiations") {
        homeReads++;
        return html();
      }
      const filter = parsed.searchParams.get("filter");
      const page = Number(parsed.searchParams.get("page"));
      visited.push(`${filter}:${page}`);
      let data: Record<string, unknown>;
      if (filter === "deleted") {
        data = { filterInUse: filter, total: 0, topicList: [], ...empty };
      } else {
        const total = filter === "active" ? 48 : 114;
        const offset = filter === "active" ? 0 : 1000;
        const pageCount = Math.ceil(total / 20);
        data = {
          filterInUse: filter,
          total,
          pageCount: String(pageCount),
          paging: { next: { disabled: page + 1 === pageCount } },
          topicList: Array.from(
            { length: Math.min(20, total - page * 20) },
            (_, index) => ({
              id: String(offset + page * 20 + index + 1),
              vacancyId: "123",
              resumeId: "42",
              applicantUserId: 101,
              initialState: "RESPONSE",
            }),
          ),
        };
      }
      return html({ userId: undefined, applicantNegotiations: data });
    });
    try {
      const result = await createChromeExecution(chrome.api, null, {
        load: async () => null,
      }).execute(job({ kind: "read_hh_history", maxPages: 120 }));
      assert.equal(result.outcome, "confirmed", JSON.stringify(empty));
      if (result.result?.kind !== "read_hh_history") {
        assert.fail("history result required");
      }
      assert.equal(result.result.complete, true);
      assert.equal(result.result.pages, 10);
      assert.equal(result.result.observations.length, 162);
      assert.equal(homeReads, 3);
      assert.deepEqual(visited, [
        "active:0",
        "active:1",
        "active:2",
        "archived:0",
        "archived:1",
        "archived:2",
        "archived:3",
        "archived:4",
        "archived:5",
        "deleted:0",
      ]);
      assert.equal(chrome.tabs.size, 1);
    } finally {
      chrome.close();
    }
  }
});

test("empty full-history pages reject conflicting counts, enabled next links and missing account proof", () => {
  const request = {
    filter: "deleted" as const,
    page: 0,
    hhAccountKey: "hh-applicant-101",
    observedAt: new Date().toISOString(),
    sessionVerifiedEmpty: true,
  };
  for (const override of [
    { total: 1 },
    { total: "0" },
    { total: undefined },
    { pageCount: "2" },
    { pageCount: "unknown" },
    { paging: "unknown" },
    { paging: { next: { disabled: false } } },
    { paging: { next: {} } },
  ]) {
    const dom = new JSDOM(
      html({
        userId: undefined,
        applicantNegotiations: {
          filterInUse: "deleted",
          total: 0,
          topicList: [],
          ...override,
        },
      }),
      {
        url: "https://hh.ru/applicant/negotiations?filter=deleted&page=0",
        runScripts: "outside-only",
      },
    );
    try {
      const identity = runSerialized(dom, readHistoryAccountIdentity, [
        null,
        null,
        true,
      ]) as { emptyHistoryPage: boolean };
      assert.equal(identity.emptyHistoryPage, false, JSON.stringify(override));
      assert.throws(() => runSerialized(dom, readFullHistoryPage, [request]));
    } finally {
      dom.window.close();
    }
  }
  const dom = new JSDOM(
    html({
      userId: undefined,
      applicantNegotiations: {
        filterInUse: "deleted",
        total: 0,
        topicList: [],
      },
    }),
    {
      url: "https://hh.ru/applicant/negotiations?filter=deleted&page=0",
      runScripts: "outside-only",
    },
  );
  try {
    assert.equal(runSerialized(dom, readHistoryAccountIdentity, []), null);
    assert.throws(
      () =>
        runSerialized(dom, readFullHistoryPage, [
          { ...request, sessionVerifiedEmpty: false },
        ]),
      /account_identity_unverified/,
    );
    assert.throws(
      () =>
        runSerialized(dom, readFullHistoryPage, [
          { ...request, hhAccountKey: "" },
        ]),
      /account_identity_unverified/,
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
test("chat capture is bound to fresh owned negotiation identities and never sends a message", async () => {
  const chrome = browser((url) => {
    const u = new URL(url);
    if (u.pathname === "/chat/77") {
      return '<main data-chat-id="77"><div data-qa="message-list"><div data-qa="message" data-message-id="9" data-author-type="employer">Заполните анкету <a href="https://forms.example.org/start">Анкета</a><script>private_secret</script><input value="private_input"><span hidden>private_hidden</span></div></div></main>';
    }
    let topicId = "3";
    if (u.searchParams.get("filter") === "active") topicId = "1";
    if (u.searchParams.get("filter") === "archived") topicId = "2";
    if (u.pathname === "/applicant/negotiations") {
      return html({
        userId: undefined,
        applicantNegotiations: {
          filterInUse: u.searchParams.get("filter"),
          pageCount: "1",
          paging: { next: { disabled: true } },
          topicList: [
            {
              id: topicId,
              vacancyId: "123",
              resumeId: "42",
              applicantUserId: 101,
              chatId: 77,
              conversationMessagesCount: 1,
              initialState: "RESPONSE",
            },
          ],
        },
      });
    }
    return html();
  });
  const inject = chrome.api.scripting.executeScript;
  chrome.api.scripting.executeScript = async (script) => {
    const results = await inject(script);
    if (script.func.name === readChatSnapshot.name) {
      assert.ok("allFrames" in script.target && script.target.allFrames);
      results[0].frameId = 7;
    }
    return results;
  };
  try {
    const result = await createChromeExecution(chrome.api, null, {
      load: async () => null,
    }).execute(
      job({
        kind: "read_hh_correspondence",
        historyJobId: "history-one",
        targets: [
          { negotiationId: "1", vacancyId: "123", resumeInternalId: "42" },
        ],
      }),
    );
    assert.equal(result.outcome, "confirmed");
    if (result.result?.kind !== "read_hh_correspondence") {
      assert.fail("chat result required");
    }
    const snapshot = result.result.threads[0].snapshot;
    assert.ok(snapshot);
    assert.ok(snapshot.includes("Заполните анкету"));
    assert.ok(snapshot.includes("https://forms.example.org/start"));
    assert.ok(!snapshot.includes("private_secret"));
    assert.ok(!snapshot.includes("private_input"));
    assert.ok(!snapshot.includes("private_hidden"));
    assert.equal(chrome.tabs.size, 1);
  } finally {
    chrome.close();
  }
});
test("serialized chat reader refuses a different chat and unsafe host before reading the DOM", async () => {
  for (const url of [
    "https://chatik.hh.ru/chat/78",
    "https://chatik.hh.ru.example.invalid/chat/77",
    "https://chatik.hh.ru/chat/77?other=1",
  ]) {
    const dom = new JSDOM("<main>Secret</main>", {
      url,
      runScripts: "outside-only",
    });
    try {
      await assert.rejects(
        () => runSerialized(dom, readChatSnapshot, ["77"]),
        /history_target_mismatch/,
      );
    } finally {
      dom.window.close();
    }
  }
});
test("one unavailable chat preserves the other targets while account changes still stop the whole read", async () => {
  for (const failure of ["hh_read_failed", "account_changed"] as const) {
    const chrome = browser((url) => {
      const u = new URL(url);
      if (u.pathname.startsWith("/chat/")) {
        return '<main data-chat-id="78"><div data-qa="message" data-message-id="1">Retained reply</div></main>';
      }
      if (u.pathname === "/applicant/negotiations") {
        return html({
          applicantNegotiations: {
            filterInUse: u.searchParams.get("filter"),
            pageCount: 1,
            total: u.searchParams.get("filter") === "active" ? 2 : 0,
            paging: { next: { disabled: true } },
            topicList:
              u.searchParams.get("filter") === "active"
                ? [
                    {
                      id: 1,
                      vacancyId: 123,
                      resumeId: 42,
                      applicantUserId: 101,
                      chatId: 77,
                      conversationMessagesCount: 1,
                    },
                    {
                      id: 2,
                      vacancyId: 124,
                      resumeId: 42,
                      applicantUserId: 101,
                      chatId: 78,
                      conversationMessagesCount: 1,
                    },
                  ]
                : [],
          },
        });
      }
      return html();
    });
    const inject = chrome.api.scripting.executeScript;
    chrome.api.scripting.executeScript = async (script) => {
      if (
        script.func.name === readChatSnapshot.name &&
        script.args[0] === "77"
      ) {
        throw Error(failure);
      }
      return inject(script);
    };
    try {
      const receipt = await createChromeExecution(chrome.api, null, {
        load: async () => null,
      }).execute(
        job({
          kind: "read_hh_correspondence",
          historyJobId: "source",
          targets: [
            { negotiationId: "1", vacancyId: "123", resumeInternalId: "42" },
            { negotiationId: "2", vacancyId: "124", resumeInternalId: "42" },
          ],
        }),
      );
      if (failure === "account_changed") {
        assert.equal(receipt.outcome, "needs_user");
        assert.equal(receipt.evidence.reasonCode, "account_changed");
        assert.equal(receipt.result, undefined);
      } else {
        assert.equal(receipt.outcome, "confirmed");
        assert.equal(receipt.result?.kind, "read_hh_correspondence");
        if (receipt.result?.kind === "read_hh_correspondence") {
          assert.equal(receipt.result.threads[0].reason, "chat_not_loaded");
          assert.match(
            receipt.result.threads[1].snapshot ?? "",
            /Retained reply/,
          );
        }
      }
      assert.equal(chrome.tabs.size, 1);
    } finally {
      chrome.close();
    }
  }
});
test("serialized chat reader makes only a fixed GET and projects message data without secrets", async () => {
  const dom = new JSDOM("<main></main>", {
    url: "https://chatik.hh.ru/chat/77",
    runScripts: "outside-only",
  });
  const requests: Array<{ url: string; options: RequestInit }> = [];
  dom.window.fetch = (async (
    url: string | URL | Request,
    options: RequestInit,
  ) => {
    requests.push({ url: String(url), options });
    return new Response(
      JSON.stringify({
        chatId: "77",
        authToken: "private_token",
        cookies: "private_cookie",
        participants: [{ id: "10", type: "EMPLOYER", email: "private_email" }],
        messages: {
          items: [
            {
              id: "1",
              authorId: "10",
              text: "Ссылка на анкету",
              creationTime: 1792227600000,
            },
          ],
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  dom.window.AbortSignal.timeout = AbortSignal.timeout;
  try {
    const snapshot = await runSerialized(dom, readChatSnapshot, ["77", 1]);
    assert.ok(snapshot);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://chatik.hh.ru/chatik/api/chat_data?chatId=77",
    );
    assert.equal(requests[0].options.method, "GET");
    assert.equal(requests[0].options.redirect, "error");
    assert.match(snapshot, /hh-chat-api-v1/);
    assert.match(snapshot, /Ссылка на анкету/);
    assert.doesNotMatch(snapshot, /private_token|private_cookie|private_email/);
  } finally {
    dom.window.close();
  }
});
test("chat diagnostics stay bounded even on a large unsupported document and unrelated frames stay unread", async () => {
  const markup = Array.from(
    { length: 100 },
    (_, i) =>
      `<div data-qa="qa${i}_${"&amp;".repeat(1000)}" class="class${i}_${"&amp;".repeat(1000)}">private_body</div>`,
  ).join("");
  const dom = new JSDOM(markup, {
    url: "https://hh.ru/chat/77",
    runScripts: "outside-only",
  });
  dom.window.setTimeout = ((handler: () => void) => {
    handler();
    return 0;
  }) as typeof dom.window.setTimeout;
  try {
    const diagnostic = await runSerialized(dom, readChatSnapshot, ["77", 1]);
    assert.ok(diagnostic);
    assert.ok(diagnostic.length < 20000);
    assert.match(diagnostic, /hh-chat-diagnostic-v1/);
    assert.match(diagnostic, /0.2.27/);
    assert.doesNotMatch(diagnostic, /private_body/);
    dom.reconfigure({ url: "https://chatik.hh.ru/chat/78?without_list=1" });
    assert.equal(
      await runSerialized(dom, readChatSnapshot, ["77", 1, true]),
      null,
    );
    dom.reconfigure({ url: "https://chatik.hh.ru/chat/77?without_list=1" });
    dom.window.document.body.innerHTML =
      '<main data-chat-id="77"><div data-qa="message" data-message-id="1">Visible message</div></main>';
    assert.match(
      (await runSerialized(dom, readChatSnapshot, ["77", 1, true])) ?? "",
      /Visible message/,
    );
  } finally {
    dom.window.close();
  }
});
test("chat pagination follows only observed same-chat GET resources, merges overlap and preserves a failed partial read", async () => {
  for (const scenario of [
    "complete",
    "foreign-url",
    "mutation-url",
    "foreign-result",
    "network-failure",
  ] as const) {
    const dom = new JSDOM("<main></main>", {
      url: "https://chatik.hh.ru/chat/77",
      runScripts: "outside-only",
    });
    const requests: string[] = [];
    const next =
      "https://chatik.hh.ru/chatik/api/messages?chatId=77&beforeMessageId=2";
    let resourceUrl = next;
    if (scenario === "foreign-url") resourceUrl = "https://example.org/private";
    if (scenario === "mutation-url") {
      resourceUrl = "https://chatik.hh.ru/chatik/api/send?chatId=77";
    }
    dom.window.AbortSignal.timeout = AbortSignal.timeout;
    dom.window.fetch = (async (
      input: string | URL | Request,
      options: RequestInit,
    ) => {
      const request = String(input);
      requests.push(request);
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      if (requests.length === 1) {
        return new Response(
          JSON.stringify({
            chat: {
              id: 77,
              type: "NEGOTIATION",
              messages: {
                items: [
                  {
                    id: 2,
                    chatId: 77,
                    participantId: "202",
                    type: "SIMPLE",
                    text: "Latest response",
                  },
                ],
                hasMore: true,
              },
              resources: {
                messages: resourceUrl,
              },
            },
            resources: {
              participants: {
                101: { type: "APPLICANT", email: "private_email" },
                202: { type: "EMPLOYER" },
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      assert.equal(request, next);
      if (scenario === "network-failure") throw Error("private_network_detail");
      return new Response(
        JSON.stringify({
          chat: {
            id: scenario === "foreign-result" ? 78 : 77,
            messages: {
              items: [
                {
                  id: 1,
                  chatId: 77,
                  participantId: "101",
                  type: "SIMPLE",
                  text: "Older response",
                },
                {
                  id: 2,
                  chatId: 77,
                  participantId: "202",
                  type: "SIMPLE",
                  text: "Latest response",
                },
              ],
              hasMore: false,
            },
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const snapshot = await runSerialized(dom, readChatSnapshot, ["77", 2]);
      assert.ok(snapshot);
      assert.match(snapshot, /Latest response/);
      assert.doesNotMatch(snapshot, /private_email|private_network_detail/);
      const parsed = new JSDOM(snapshot);
      const data = JSON.parse(
        parsed.window.document.querySelector("pre")!.textContent!,
      );
      parsed.window.close();
      assert.equal(data.chat.messages.hasMore, scenario !== "complete");
      if (scenario === "complete") {
        assert.match(snapshot, /Older response/);
        assert.match(snapshot, /data-api-pages="2"/);
        assert.equal(data.chat.messages.items.length, 2);
      } else assert.doesNotMatch(snapshot, /Older response/);
      assert.equal(
        requests.length,
        ["foreign-url", "mutation-url"].includes(scenario) ? 1 : 2,
      );
    } finally {
      dom.window.close();
    }
  }
});
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
test("chat pagination discovers the observed history request by scrolling, without executing message buttons", async () => {
  const dom = new JSDOM(
    '<div id="history" style="overflow-y:auto"><div data-qa="message">Latest</div><button>Send</button></div>',
    {
      url: "https://chatik.hh.ru/chat/77?dest=iframe&microphone=true&without_list=1",
      runScripts: "outside-only",
    },
  );
  const scroller = dom.window.document.getElementById("history")!;
  Object.defineProperty(scroller, "scrollHeight", { value: 500 });
  Object.defineProperty(scroller, "clientHeight", { value: 100 });
  let top = 100;
  let scrolled = false;
  let clicks = 0;
  Object.defineProperty(scroller, "scrollTop", {
    get: () => top,
    set: (value: number) => {
      top = value;
      if (value === 0) scrolled = true;
    },
  });
  dom.window.document
    .querySelector("button")!
    .addEventListener("click", () => clicks++);
  const next =
    "https://chatik.hh.ru/chatik/api/messages?chatId=77&beforeMessageId=2";
  Object.defineProperty(dom.window.performance, "getEntriesByType", {
    value: () =>
      scrolled
        ? [
            {
              name: "https://chatik.hh.ru/chatik/api/messages?chatId=77&action=delete",
              initiatorType: "img",
            },
            { name: next, initiatorType: "fetch" },
          ]
        : [],
  });
  const requests: string[] = [];
  dom.window.AbortSignal.timeout = AbortSignal.timeout;
  dom.window.fetch = (async (
    input: string | URL | Request,
    options: RequestInit,
  ) => {
    requests.push(String(input));
    assert.equal(options.method, "GET");
    return new Response(
      JSON.stringify(
        requests.length === 1
          ? {
              chat: {
                id: 77,
                messages: {
                  items: [{ id: 2, chatId: 77, text: "Latest" }],
                  hasMore: true,
                },
              },
            }
          : { items: [{ id: 1, chatId: 77, text: "Older" }], hasMore: false },
      ),
      { headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const snapshot = await runSerialized(dom, readChatSnapshot, [
      "77",
      2,
      true,
    ]);
    assert.ok(snapshot);
    assert.match(snapshot, /Older/);
    assert.match(snapshot, /data-api-pages="2"/);
    assert.deepEqual(requests, [
      "https://chatik.hh.ru/chatik/api/chat_data?chatId=77",
      next,
    ]);
    assert.equal(clicks, 0);
    dom.reconfigure({
      url: "https://chatik.hh.ru/chat/77?dest=iframe&dest=other&microphone=true",
    });
    assert.equal(
      await runSerialized(dom, readChatSnapshot, ["77", 2, true]),
      null,
    );
    dom.reconfigure({
      url: "https://chatik.hh.ru/chat/77?dest=other&microphone=true",
    });
    assert.equal(
      await runSerialized(dom, readChatSnapshot, ["77", 2, true]),
      null,
    );
  } finally {
    dom.window.close();
  }
});
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
      nextCursor: null,
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
test("search resumes inside long pages and crosses HH pagination without rereading the first batch", async () => {
  const visited: string[] = [];
  const chrome = browser((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/search/vacancy") {
      const page = Number(parsed.searchParams.get("page"));
      return html({
        vacancySearchResult: {
          vacancies: Array.from({ length: page === 0 ? 30 : 15 }, (_, i) => ({
            vacancyId: 100 + page * 30 + i,
            name: "Snippet",
            company: { visibleName: "Synthetic" },
          })),
          paging: {
            pages: [{ page, selected: true }],
            next: { disabled: page === 1, page: page + 1 },
          },
        },
      });
    }
    if (parsed.pathname.startsWith("/vacancy/")) {
      visited.push(parsed.pathname.split("/").pop()!);
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
      text: "React",
      maxPages: 2,
    };
    const first = await execution.execute(job(payload));
    assert.ok(first.result?.kind === "discover_search");
    assert.equal(first.result.vacancies.length, 20);
    assert.deepEqual(first.result.nextCursor, { page: 0, offset: 20 });
    assert.equal(first.result.complete, false);
    const second = await execution.execute(
      job({
        ...payload,
        cursor: first.result.nextCursor!,
        rootJobId: "root-search",
      }),
    );
    assert.ok(second.result?.kind === "discover_search");
    assert.equal(second.result.vacancies.length, 20);
    assert.deepEqual(second.result.nextCursor, { page: 1, offset: 10 });
    const last = await execution.execute(
      job({
        ...payload,
        cursor: second.result.nextCursor!,
        rootJobId: "root-search",
      }),
    );
    assert.ok(last.result?.kind === "discover_search");
    assert.equal(last.result.vacancies.length, 5);
    assert.equal(last.result.complete, true);
    assert.equal(last.result.nextCursor, null);
    assert.equal(new Set(visited).size, 45);
    assert.equal(visited.length, 45);
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
    assert.equal(result.evidence.reasonCode, "history_identity_missing");
    assert.equal(result.result, undefined);
    assert.equal(chrome.tabs.size, 1);
  } finally {
    chrome.close();
  }
});
test("new owned tabs wait for their exact HH resource to commit before reading", async () => {
  const pendingUrl = "https://kaliningrad.hh.ru/resume/resume-one";
  for (const observation of [
    { url: undefined, status: "complete", pendingUrl },
    { url: "", status: "complete", pendingUrl },
    { url: "about:blank", status: "complete", pendingUrl },
    { url: "https://hh.ru/resume/resume-one", status: "complete", pendingUrl },
    { url: "https://hh.ru/resume/resume-one", status: "loading" },
  ]) {
    const chrome = browser(pages, (target) =>
      target.replace("https://hh.ru", "https://kaliningrad.hh.ru"),
    );
    const get = chrome.api.tabs.get;
    const inject = chrome.api.scripting.executeScript;
    let pending = true;
    let ownedReads = 0;
    chrome.api.tabs.get = async (id) => {
      const tab = await get(id);
      if (id === 101 && ++ownedReads === 1) {
        return {
          ...tab,
          ...observation,
        };
      }
      if (id === 101) pending = false;
      return tab;
    };
    chrome.api.scripting.executeScript = async (script) => {
      if (script.target.tabId === 101) assert.equal(pending, false);
      return inject(script);
    };
    try {
      const result = await createChromeExecution(
        chrome.api,
        {},
        {
          load: async () => null,
        },
      ).execute(
        job({
          kind: "read_profile",
          includeResumeIds: ["resume-one"],
          includeProfileText: false,
        }),
      );
      assert.equal(result.outcome, "confirmed");
      assert.ok(result.result?.kind === "read_profile");
      assert.equal(result.result.resumes[0]?.resumeId, "resume-one");
      assert.deepEqual(chrome.removed, [101]);
      assert.equal(chrome.tabs.size, 1);
    } finally {
      chrome.close();
    }
  }
});
test("owned navigation waits through the previous completed HH document", async () => {
  const chrome = browser((url) => {
    const id = new URL(url).pathname.slice("/resume/".length);
    return pages(url).replaceAll("resume-one", id);
  });
  const update = chrome.api.tabs.update;
  const get = chrome.api.tabs.get;
  const inject = chrome.api.scripting.executeScript;
  let pending: { previous: string; destination: string } | undefined;
  let pendingObserved = false;
  chrome.api.tabs.update = async (id, options) => {
    const previous = (await get(id)).url!;
    const result = await update(id, options);
    if (options.url) pending = { previous, destination: options.url };
    return result;
  };
  chrome.api.tabs.get = async (id) => {
    const tab = await get(id);
    if (pending && !pendingObserved) {
      pendingObserved = true;
      return {
        ...tab,
        url: pending.previous,
        status: "complete",
        pendingUrl: pending.destination,
      };
    }
    if (pendingObserved) pending = undefined;
    return tab;
  };
  chrome.api.scripting.executeScript = async (script) => {
    assert.equal(pending, undefined);
    return inject(script);
  };
  try {
    const result = await createChromeExecution(
      chrome.api,
      {},
      { load: async () => null },
    ).execute(
      job({
        kind: "read_profile",
        includeResumeIds: ["resume-one", "resume-two"],
        includeProfileText: false,
      }),
    );
    assert.equal(pendingObserved, true);
    assert.equal(result.outcome, "confirmed");
    assert.ok(result.result?.kind === "read_profile");
    assert.deepEqual(
      result.result.resumes.map((resume) => resume.resumeId),
      ["resume-one", "resume-two"],
    );
    assert.deepEqual(chrome.navigated, [101]);
    assert.deepEqual(chrome.removed, [101]);
  } finally {
    chrome.close();
  }
});
test("resume artifact import waits for its regional HH document and reads pinned owned fields", async () => {
  const chrome = browser(
    (url) =>
      new URL(url).pathname === "/resume/resume-one"
        ? html(
            {
              applicantResume: {
                forbidden: null,
                applicantUserStatuses: {
                  "101": { jobSearchStatus: "synthetic" },
                },
                _attributes: {
                  id: "42",
                  hash: "resume-one",
                  user: "101",
                  permission: "edit",
                },
                advancedKeySkills: [
                  { id: 1, name: "Synthetic skill", general: false },
                ],
                keySkills: [{ string: "Synthetic skill" }],
                resumeApplicantSkills: [
                  { id: 1, name: "Synthetic skill", category: "SKILL" },
                ],
              },
            },
            '<h1 data-qa="resume-block-title-position">Synthetic engineer</h1><div data-qa="resume-about-card"><p>Synthetic profile description.</p></div><div data-qa="skills-card"><div data-qa="skill-tag-1">Synthetic skill</div></div>',
          )
        : pages(url),
    (url) => url.replace("https://hh.ru", "https://kaliningrad.hh.ru"),
  );
  const get = chrome.api.tabs.get;
  const inject = chrome.api.scripting.executeScript;
  let pending = true;
  let ownedReads = 0;
  let artifactReads = 0;
  chrome.api.tabs.get = async (id) => {
    const tab = await get(id);
    if (id === 101 && ++ownedReads === 1) {
      return {
        ...tab,
        url: "about:blank",
        status: "complete",
        pendingUrl: "https://kaliningrad.hh.ru/resume/resume-one",
      };
    }
    if (id === 101) pending = false;
    return tab;
  };
  chrome.api.scripting.executeScript = async (script) => {
    if (script.target.tabId === 101) assert.equal(pending, false);
    if (script.func.name === "readPublicationResumeArtifacts") {
      artifactReads++;
      assert.equal(script.target.tabId, 101);
      assert.deepEqual(script.target.documentIds, [
        chrome.tabs.get(101)!.documentId,
      ]);
    }
    return inject(script);
  };
  try {
    const result = await createChromeExecution(
      chrome.api,
      {},
      { load: async () => null },
    ).execute(
      job({
        kind: "read_resume_artifact",
        resumeId: "resume-one",
        internalId: "42",
      }),
    );
    assert.equal(result.outcome, "confirmed");
    assert.ok(result.result?.kind === "read_resume_artifact");
    const artifact = result.result.artifact;
    assert.deepEqual(
      { ...artifact, keySkills: [...artifact.keySkills] },
      {
        kind: "resume_artifact_readback",
        readerVersion: "hh-owned-resume-dom-v1",
        hhAccountKey: "hh-applicant-101",
        resumeId: "resume-one",
        internalId: "42",
        headline: "Synthetic engineer",
        about: "Synthetic profile description.",
        keySkills: ["Synthetic skill"],
      },
    );
    assert.equal(artifactReads, 1);
    assert.deepEqual(chrome.removed, [101]);
    assert.equal(chrome.tabs.size, 1);
  } finally {
    chrome.close();
  }
});
test("pending navigation to another resource blocks reading and preserves the tab", async () => {
  for (const pendingUrl of [
    "https://example.invalid/user-page",
    "https://kaliningrad.hh.ru.example.invalid/resume/resume-one",
    "http://kaliningrad.hh.ru/resume/resume-one",
    "https://user@kaliningrad.hh.ru/resume/resume-one",
    "https://kaliningrad.hh.ru:8443/resume/resume-one",
    "https://kaliningrad.hh.ru/resume/another-resume",
    "https://kaliningrad.hh.ru/resume/resume-one?changed=1",
    "https://kaliningrad.hh.ru/resume/resume-one#changed",
  ]) {
    const chrome = browser(pages);
    const get = chrome.api.tabs.get;
    const inject = chrome.api.scripting.executeScript;
    let ownedInjections = 0;
    chrome.api.tabs.get = async (id) => ({
      ...(await get(id)),
      ...(id === 101 ? { pendingUrl } : {}),
    });
    chrome.api.scripting.executeScript = async (script) => {
      if (script.target.tabId === 101) ownedInjections++;
      return inject(script);
    };
    try {
      const result = await createChromeExecution(
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
      assert.equal(result.outcome, "needs_user");
      assert.equal(result.evidence.reasonCode, "unexpected_hh_navigation");
      assert.equal(result.result, undefined);
      assert.equal(ownedInjections, 0);
      assert.ok(chrome.tabs.has(101));
      assert.deepEqual(chrome.removed, []);
    } finally {
      chrome.close();
    }
  }
});
test("a tab completing after the page or lease deadline is never read", async (t) => {
  const now = Date.now();
  let clock = now;
  t.mock.method(Date, "now", () => clock);
  for (const elapsed of [20_001, 120_001]) {
    clock = now;
    const chrome = browser(pages);
    const get = chrome.api.tabs.get;
    const inject = chrome.api.scripting.executeScript;
    let ownedInjections = 0;
    chrome.api.tabs.get = async (id) => {
      const tab = await get(id);
      if (id === 101) clock = now + elapsed;
      return tab;
    };
    chrome.api.scripting.executeScript = async (script) => {
      if (script.target.tabId === 101) ownedInjections++;
      return inject(script);
    };
    try {
      const result = await createChromeExecution(
        chrome.api,
        {},
        { load: async () => null },
      ).execute(
        job(
          {
            kind: "read_profile",
            includeResumeIds: ["resume-one"],
            includeProfileText: false,
          },
          { expiresAt: new Date(now + 120_000).toISOString() },
        ),
      );
      assert.equal(result.outcome, "needs_user");
      assert.equal(
        result.evidence.reasonCode,
        elapsed < 120_000 ? "hh_page_timeout" : "lease_expired",
      );
      assert.equal(result.result, undefined);
      assert.equal(ownedInjections, 0);
    } finally {
      chrome.close();
    }
  }
});
test("a pending user navigation after reading cannot confirm or close the owned tab", async () => {
  for (const observation of [
    { pendingUrl: "https://example.invalid/user-page" },
    // Chrome can hide a pending URL outside the granted host permissions.
    { status: "loading", pendingUrl: undefined },
  ]) {
    const chrome = browser(pages);
    const get = chrome.api.tabs.get;
    let userNavigation = false;
    chrome.afterRead(() => {
      userNavigation = true;
    });
    chrome.api.tabs.get = async (id) => ({
      ...(await get(id)),
      ...(id === 101 && userNavigation ? observation : {}),
    });
    try {
      const result = await createChromeExecution(
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
      assert.equal(result.outcome, "needs_user");
      assert.equal(result.evidence.reasonCode, "unexpected_hh_navigation");
      assert.equal(result.result, undefined);
      assert.ok(chrome.tabs.has(101));
      assert.deepEqual(chrome.removed, []);
    } finally {
      chrome.close();
    }
  }
});
test("a pending user navigation is not overwritten when the next resource is requested", async () => {
  for (const observation of [
    { pendingUrl: "https://example.invalid/user-page" },
    { status: "loading", pendingUrl: undefined },
  ]) {
    const chrome = browser(pages);
    const get = chrome.api.tabs.get;
    let pageRead = false;
    let subsequentReads = 0;
    chrome.afterRead(() => {
      pageRead = true;
    });
    chrome.api.tabs.get = async (id) => ({
      ...(await get(id)),
      ...(id === 101 && pageRead && ++subsequentReads >= 3 ? observation : {}),
    });
    try {
      const result = await createChromeExecution(
        chrome.api,
        {},
        { load: async () => null },
      ).execute(
        job({
          kind: "read_profile",
          includeResumeIds: ["resume-one", "resume-two"],
          includeProfileText: false,
        }),
      );
      assert.equal(result.outcome, "needs_user");
      assert.equal(result.evidence.reasonCode, "unexpected_hh_navigation");
      assert.equal(result.result, undefined);
      assert.deepEqual(chrome.navigated, []);
      assert.ok(chrome.tabs.has(101));
      assert.deepEqual(chrome.removed, []);
    } finally {
      chrome.close();
    }
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
