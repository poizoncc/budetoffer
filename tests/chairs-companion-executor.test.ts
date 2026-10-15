import assert from "node:assert/strict";
import { COMPANION_ORIGINS } from "../apps/chrome-companion/shared/destinations.ts";
import { test } from "node:test";
import {
  accountMatches,
  readVerifiedAccountIdentity,
} from "../apps/chrome-companion/hh/account.ts";
import { executeJob } from "../apps/chrome-companion/hh/executor.ts";
import { createCheckpointStore } from "../apps/chrome-companion/background/checkpoint-store.ts";
import { createCompanionWorker } from "../apps/chrome-companion/background/service-worker.ts";
import { createCompanionTransport } from "../apps/chrome-companion/background/transport.ts";
import { JSDOM } from "jsdom";
import {
  readResumeIdentity,
  readNegotiationsPage,
  matchHistoricalApplication,
  readVacancy,
} from "../apps/chrome-companion/hh/actions.ts";
import { isCompanionJob } from "../apps/chrome-companion/shared/companion-protocol.ts";
import type {
  CompanionJob,
  CompanionReceipt,
  Checkpoint,
} from "../apps/chrome-companion/shared/companion-protocol.ts";
import {
  companionJob,
  companionReceipt,
  companionTransport,
} from "./helpers/companion.ts";

function storage() {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(key: string) {
      return { [key]: data[key] };
    },
    async set(value: Record<string, unknown>) {
      Object.assign(data, value);
    },
    async remove(key: string) {
      delete data[key];
    },
  };
}
const job = companionJob(
  {
    kind: "apply_vacancy",
    applicationId: "app-one",
    vacancyId: "123",
    resumeId: "resume-one",
    expectedVersion: 1,
    coverLetter: "PRIVATE_SYNTHETIC_LETTER",
  },
  { jobId: "job-1", hhAccountKey: "account-a" },
);
test("unknown or changed account always blocks built-in executor", async () => {
  assert.equal(accountMatches("a", "a"), true);
  for (const observed of ["b", null, ""]) {
    assert.equal(accountMatches("a", observed), false);
  }
  assert.equal(readVerifiedAccountIdentity(), null);
  assert.equal(
    (await executeJob(job)).evidence.reasonCode,
    "account_identity_unverified",
  );
  assert.equal(isCompanionJob({ ...job, protocolVersion: 999 }), false);
});
test("checkpoint excludes private materials; authorized restart never invokes executor or leases", async () => {
  const backing = storage();
  const checkpoints = createCheckpointStore(backing);
  await checkpoints.save({ ...job, phase: "authorized", permitId: "permit" });
  assert.ok(!JSON.stringify(backing.data).includes("PRIVATE_SYNTHETIC_LETTER"));
  let leases = 0;
  let executions = 0;
  let receipts = 0;
  const worker = createCompanionWorker({
    checkpoints: createCheckpointStore(backing),
    transport: companionTransport({
      async lease() {
        leases++;
        return null;
      },
      async receipt(value) {
        receipts++;
        assert.equal(value.outcome, "unknown");
      },
    }),
    execute: async () => {
      executions++;
      throw new Error("must_not_execute");
    },
  });
  assert.equal((await worker.tick()).state, "reconciling");
  assert.equal((await worker.tick()).state, "reconciling");
  assert.equal(leases, 0);
  assert.equal(executions, 0);
  assert.equal(receipts, 2);
});
test("lost receipt response replays same receipt after worker restart without executing again", async () => {
  const backing = storage();
  let executions = 0;
  let leases = 0;
  const sent: string[] = [];
  const transport = companionTransport({
    async lease() {
      leases++;
      return job;
    },
    async receipt(value) {
      sent.push(value.receiptId);
      if (sent.length === 1) throw new Error("offline");
    },
  });
  const first = createCompanionWorker({
    checkpoints: createCheckpointStore(backing),
    transport,
    execute: async (value) => {
      executions++;
      return executeJob(value);
    },
  });
  await assert.rejects(first.tick(), /offline/);
  const restarted = createCompanionWorker({
    checkpoints: createCheckpointStore(backing),
    transport,
    execute: async () => {
      throw new Error("must not execute");
    },
  });
  assert.equal((await restarted.tick()).state, "recovered");
  assert.equal(executions, 1);
  assert.equal(leases, 1);
  assert.equal(sent[0], sent[1]);
});
test("targeted reconciliation executes only exact read jobs and restores original uncertainty after lost receipt", async () => {
  const backing = storage();
  const checkpoints = createCheckpointStore(backing);
  const original: Checkpoint = {
    ...job,
    phase: "reconciling",
    permitId: "p".repeat(43),
  };
  await checkpoints.save(original);
  let executions = 0;
  let sends = 0;
  const transport = companionTransport({
    async lease(originalId) {
      assert.equal(originalId, job.jobId);
      return companionJob(
        {
          kind: "reconcile_history",
          originalJobId: job.jobId,
          applicationId: "app-one",
          vacancyId: "123",
          resumeId: "resume-one",
        },
        { jobId: "read-recovery", hhAccountKey: job.hhAccountKey },
      );
    },
    async receipt(value) {
      assert.equal(value.jobId, "read-recovery");
      if (++sends === 1) throw new Error("offline");
    },
  });
  const execute = async (value: CompanionJob): Promise<CompanionReceipt> => {
    executions++;
    return companionReceipt(value, {
      receiptId: "read-receipt",
      outcome: "needs_user",
    });
  };
  await assert.rejects(
    createCompanionWorker({ checkpoints, transport, execute }).tick(job.jobId),
    /offline/,
  );
  const pending = await checkpoints.load();
  assert.ok(pending?.reconcileOriginal);
  assert.equal(pending.reconcileOriginal.jobId, job.jobId);
  assert.equal(pending.jobId, "read-recovery");
  assert.ok(!JSON.stringify(backing.data).includes("PRIVATE_SYNTHETIC_LETTER"));
  assert.equal(
    (await createCompanionWorker({ checkpoints, transport, execute }).tick())
      .state,
    "reconciliation_checked",
  );
  const restored = await checkpoints.load();
  assert.ok(restored);
  assert.equal(executions, 1);
  assert.equal(restored.jobId, job.jobId);
  assert.equal(restored.phase, "reconciling");
  const unsafe = { ...transport, lease: async () => job };
  await assert.rejects(
    createCompanionWorker({ checkpoints, transport: unsafe, execute }).tick(
      job.jobId,
    ),
    /invalid_reconciliation_lease/,
  );
  assert.equal(executions, 1);
});
test("transport bounds requests, omits cookies and refuses redirect/executable paths", async () => {
  let request: RequestInit | undefined;
  const transport = createCompanionTransport({
    origin: COMPANION_ORIGINS[0],
    token: async () => "device-secret",
    fetchImpl: async (_url, options) => {
      request = options;
      return Response.json({ job: null });
    },
  });
  assert.equal(await transport.lease(), null);
  assert.equal(request?.credentials, "omit");
  assert.equal(request?.redirect, "error");
  assert.throws(
    () => transport.renew({ ...job, jobId: "../arbitrary" }),
    /invalid_job_id/,
  );
  assert.throws(
    () =>
      createCompanionTransport({
        origin: "http://evil.invalid",
        token: async () => "",
      }),
    /invalid_companion_origin/,
  );
});
test("packaged read-only HH adapters verify exact resume/history IDs without inferring account ownership", () => {
  const state = {
    applicantResume: { _attributes: { id: 42, hash: "resume-a" } },
    applicantNegotiations: {
      topicList: [
        { id: 7, vacancyId: 123, resumeId: 42, initialState: "RESPONSE" },
      ],
      pageCount: "2",
      filterInUse: "active",
      paging: { next: { disabled: false } },
    },
  };
  const dom = new JSDOM(
    `<template id="HH-Lux-InitialState">${JSON.stringify(state)}</template>`,
  );
  try {
    assert.deepEqual(readResumeIdentity(dom.window.document, "resume-a"), {
      internalId: "42",
      hash: "resume-a",
    });
    assert.throws(
      () => readResumeIdentity(dom.window.document, "other-resume"),
      /resume_identity_mismatch/,
    );
    const page = readNegotiationsPage(dom.window.document);
    assert.equal(page.hasNext, true);
    assert.deepEqual(matchHistoricalApplication(page, "123", "42"), {
      outcome: "observed",
      negotiationId: "7",
    });
    assert.deepEqual(matchHistoricalApplication(page, "123", "43"), {
      outcome: "unknown",
    });
    assert.deepEqual(matchHistoricalApplication(page, "999", "42"), {
      outcome: "unknown",
    });
    assert.throws(
      () => readNegotiationsPage(dom.window.document, "archived"),
      /unsupported_history_page/,
    );
    assert.equal(readVerifiedAccountIdentity(), null);
  } finally {
    dom.window.close();
  }
});
test("vacancy read retains full description and rejects foreign host or mismatched target", () => {
  const dom = new JSDOM(
    '<h1 data-qa="vacancy-title">Synthetic role</h1><div data-qa="vacancy-description">Full synthetic vacancy text</div>',
  );
  try {
    assert.equal(
      readVacancy(dom.window.document, "https://hh.ru/vacancy/123", "123").text,
      "Full synthetic vacancy text",
    );
    assert.throws(
      () =>
        readVacancy(
          dom.window.document,
          "https://evil.invalid/vacancy/123",
          "123",
        ),
      /vacancy_identity_mismatch/,
    );
    assert.throws(
      () =>
        readVacancy(dom.window.document, "https://hh.ru/vacancy/456", "123"),
      /vacancy_identity_mismatch/,
    );
  } finally {
    dom.window.close();
  }
});
