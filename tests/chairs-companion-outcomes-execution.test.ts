import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readApplicationOutcomesPage } from "../apps/chrome-companion/hh/outcomes.ts";
import { createChromeExecution } from "../apps/chrome-companion/background/execution.ts";
import { createCompanionWorker } from "../apps/chrome-companion/background/service-worker.ts";
import type {
  CompanionJob,
  CompanionReceipt,
  Checkpoint,
} from "../apps/chrome-companion/shared/companion-protocol.ts";
import type { ExecutionChromeApi } from "../apps/chrome-companion/shared/chrome-api.ts";
import {
  companionJob,
  companionReceipt,
  companionTransport,
} from "./helpers/companion.ts";
import { runSerialized } from "./helpers/chrome.ts";

const target = {
  applicationId: "app",
  expectedVersion: 2,
  vacancyId: "123",
  resumeId: "resume-one",
  resumeInternalId: "42",
  negotiationId: "7",
  claimJobId: "claim",
  historyJobId: "history",
};
const account = {
  userType: "applicant",
  userId: "101",
  account: {},
  hhidAccount: {},
  session: {
    isFallback: false,
    securityCheckFailed: false,
    isMultiAccount: false,
    hasExtraAccounts: false,
  },
};
const topic = {
  id: 7,
  vacancyId: 123,
  resumeId: 42,
  applicantUserId: 101,
  initialState: "RESPONSE",
  lastState: "DISCARD",
  declinedByApplicant: false,
};
const html = (data = {}) =>
  `<template id="HH-Lux-InitialState">${JSON.stringify({ ...account, ...data })}</template>`;
function job(maxPages = 120): CompanionJob<"read_application_outcomes"> {
  const value = companionJob(
    { kind: "read_application_outcomes", targets: [target], maxPages },
    { jobId: "outcomes" },
  );
  assert.ok(value.kind === "read_application_outcomes");
  return value;
}
function page(rows: unknown[], extra = {}) {
  return {
    applicantNegotiations: {
      topicList: rows,
      filterInUse: "active",
      pageCount: "1",
      paging: { next: { disabled: true } },
      ...extra,
    },
  };
}
test("serialized reader returns only exact targets and explicit employer states, never archived/unknown inference", () => {
  for (const [fields, stage] of [
    [{ lastState: "DISCARD" }, "rejected"],
    [{ lastState: "INVITATION" }, "invited"],
    [{ lastState: "RESPONSE", viewedByOpponent: true }, "viewed"],
    [{ lastState: "DISCARD", declinedByApplicant: true }, "unknown"],
    [{ lastState: "DISCARD", declinedByApplicant: undefined }, "unknown"],
    [{ lastState: "NEW_STATE" }, "unknown"],
    [{ lastState: "OFFER" }, "unknown"],
  ] as const) {
    const dom = new JSDOM(
      html(
        page([
          { ...topic, ...fields, letter: "PRIVATE", name: "PRIVATE" },
          { ...topic, id: 999, vacancyId: 999 },
        ]),
      ),
      {
        url: "https://hh.ru/applicant/negotiations?filter=active&page=0",
        runScripts: "outside-only",
      },
    );
    try {
      const result = runSerialized(dom, readApplicationOutcomesPage, [
        {
          filter: "active",
          page: 0,
          targets: [target],
          hhAccountKey: "hh-applicant-101",
        },
      ]);
      assert.equal(result.observations.length, 1);
      assert.equal(result.observations[0].stage, stage);
      assert.doesNotMatch(
        JSON.stringify(result),
        /PRIVATE|999|letter|applicationId/,
      );
    } finally {
      dom.window.close();
    }
  }
});
function browser(mode = "normal") {
  const tabs = new Map<number, JSDOM>();
  let next = 0;
  const opened: string[] = [];
  let reads = 0;
  function document(url: string) {
    const u = new URL(url);
    let data: Record<string, unknown> = {};
    if (u.pathname.startsWith("/resume/")) {
      data = {
        applicantResume: {
          forbidden: null,
          applicantUserStatuses: { "101": { jobSearchStatus: "active" } },
          _attributes: {
            id: mode === "wrong-resume" ? "43" : "42",
            hash: "resume-one",
            user: "101",
            permission: "edit",
          },
        },
      };
    }
    if (u.pathname === "/applicant/negotiations") {
      const filter = u.searchParams.get("filter");
      data = page(
        filter === "active" || mode === "duplicate"
          ? [
              {
                ...topic,
                ...(mode === "foreign-row" ? { applicantUserId: 202 } : {}),
              },
            ]
          : [],
        { filterInUse: filter },
      );
      if (mode === "empty-unowned") {
        data = { ...page([], { filterInUse: filter }), userId: undefined };
      }
      if (mode === "changed-pages") {
        data = page([topic], { filterInUse: filter, pageCount: "2" });
      }
    }
    return new JSDOM(html(data), { url, runScripts: "outside-only" });
  }
  const api: ExecutionChromeApi = {
    tabs: {
      query: async () => [],
      create: async ({ url }: { url: string }) => {
        opened.push(url);
        tabs.set(++next, document(url));
        return { id: next };
      },
      get: async (id: number) => ({
        id,
        status: "complete",
        url: tabs.get(id)!.window.location.href,
      }),
      update: async (
        id: number,
        { url, autoDiscardable }: { url?: string; autoDiscardable?: boolean },
      ) => {
        if (autoDiscardable !== undefined) {
          assert.equal(autoDiscardable, false);
          return { id, url: tabs.get(id)!.window.location.href };
        }
        assert.ok(url);
        opened.push(url);
        tabs.get(id)?.window.close();
        tabs.set(id, document(url));
      },
      remove: async (id: number) => {
        tabs.get(id)?.window.close();
        tabs.delete(id);
      },
    },
    scripting: {
      executeScript: async ({ target: where, func, args }) => {
        const dom = tabs.get(where.tabId)!;
        const result = await runSerialized(dom, func, args);
        if (func.name === "readApplicationOutcomesPage") {
          reads++;
          if (mode === "account-changed") {
            dom.window.document.querySelector("template")!.innerHTML = html()
              .replace(/101/g, "202")
              .replace(/^<template[^>]*>|<\/template>$/g, "");
          }
        }
        return [{ frameId: 0, documentId: "same-document", result }];
      },
    },
  };
  return {
    api,
    opened,
    tabs,
    get reads() {
      return reads;
    },
    close() {
      for (const dom of tabs.values()) dom.window.close();
    },
  };
}
test("read job owns its tabs, proves resume ID, scans all lists; partial coverage stays explicit", async () => {
  for (const limit of [1, 120]) {
    const f = browser();
    try {
      const receipt = await createChromeExecution(
        f.api,
        {},
        { load: async () => null },
      ).execute(job(limit));
      assert.ok(receipt.result?.kind === "read_application_outcomes");
      assert.equal(receipt.outcome, "confirmed");
      assert.equal(receipt.result.complete, limit === 120);
      assert.equal(receipt.result.pages, limit === 120 ? 3 : 1);
      assert.equal(receipt.result.observedAt, receipt.evidence.observedAt);
      assert.equal(receipt.result.observations[0].stage, "rejected");
      assert.equal(f.tabs.size, 0);
      assert.ok(f.opened.every((url) => url.startsWith("https://hh.ru/")));
    } finally {
      f.close();
    }
  }
});
test("foreign owner, uncertain pagination, target conflict, empty ownerless list and duplicate topics return no result", async () => {
  for (const mode of [
    "foreign-row",
    "changed-pages",
    "wrong-resume",
    "empty-unowned",
    "duplicate",
    "account-changed",
  ]) {
    const f = browser(mode);
    try {
      const receipt = await createChromeExecution(
        f.api,
        {},
        { load: async () => null },
      ).execute(job());
      assert.equal(receipt.outcome, "needs_user", mode);
      assert.equal(receipt.result, undefined, mode);
    } finally {
      f.close();
    }
  }
});
test("oversized targets and pending mutation checkpoint never read outcomes", async () => {
  const f = browser();
  try {
    const execution = createChromeExecution(
      f.api,
      {},
      { load: async () => null },
    );
    const bad = job();
    bad.payload.targets = Array(21).fill(target);
    assert.equal(
      (await execution.execute(bad)).evidence.reasonCode,
      "invalid_read_payload",
    );
    assert.equal(f.reads, 0);
    assert.equal(
      (
        await createChromeExecution(
          f.api,
          {},
          {
            load: async () => ({ ...job(), jobId: "old", phase: "authorized" }),
          },
        ).execute(job())
      ).outcome,
      "unknown",
    );
    assert.equal(f.reads, 0);
  } finally {
    f.close();
  }
});
test("outcomes checkpoint restart resends existing receipt without a new history read", async () => {
  const receipt = companionReceipt(job());
  const previous: Checkpoint = { ...job(), phase: "receipted", receipt };
  let executed = 0;
  let sent = 0;
  let cleared = 0;
  const worker = createCompanionWorker({
    transport: companionTransport({
      receipt: async (value: unknown) => {
        assert.equal(value, receipt);
        sent++;
      },
      lease: async () => {
        throw Error("must not lease");
      },
    }),
    checkpoints: {
      load: async () => previous,
      save: async () => {},
      clear: async () => {
        cleared++;
      },
    },
    execute: async () => {
      executed++;
      throw new Error("must not execute");
    },
  });
  assert.equal((await worker.tick()).state, "recovered");
  assert.equal(executed, 0);
  assert.equal(sent, 1);
  assert.equal(cleared, 1);
});
test("outcomes reads renew leases and discard results after failed renewal", async () => {
  for (const lost of [false, true]) {
    let callback: (() => void) | undefined;
    let release!: () => void;
    let entered!: () => void;
    let renewed = 0;
    let sent: CompanionReceipt | undefined;
    let clock = Date.now();
    const began = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const leased = job();
    const worker = createCompanionWorker({
      now: () => clock,
      scheduleTimer: (fn: () => void) => {
        callback = fn;
        return () => {
          callback = undefined;
        };
      },
      transport: companionTransport({
        lease: async () => leased,
        renew: async () => {
          renewed++;
          if (lost) throw Error("offline");
          return { expiresAt: new Date(clock + 120000).toISOString() };
        },
        receipt: async (value) => {
          sent = value;
        },
      }),
      checkpoints: {
        load: async () => null,
        save: async () => {},
        clear: async () => {},
      },
      execute: async () => {
        entered();
        await waiting;
        return companionReceipt(leased, {
          result: {
            kind: "read_application_outcomes",
            readerVersion: "synthetic-reader",
            observedAt: new Date(clock).toISOString(),
            pages: 1,
            complete: true,
            observations: [],
          },
        });
      },
    });
    const pending = worker.tick();
    await began;
    assert.equal(typeof callback, "function");
    clock += 30000;
    callback!();
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await pending;
    assert.equal(renewed, 1);
    assert.equal(callback, undefined);
    assert.ok(sent);
    if (lost) {
      assert.equal(sent.evidence.reasonCode, "lease_renewal_failed");
      assert.equal(sent.result, undefined);
    } else assert.equal(sent.outcome, "confirmed");
  }
});
