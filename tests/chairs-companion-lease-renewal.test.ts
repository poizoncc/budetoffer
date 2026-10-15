import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompanionWorker } from "../apps/chrome-companion/background/service-worker.ts";
import type {
  Checkpoint,
  CheckpointStore,
  CompanionJob,
  CompanionReceipt,
} from "../apps/chrome-companion/shared/companion-protocol.ts";
import {
  companionJob,
  companionReceipt,
  companionTransport,
} from "./helpers/companion.ts";

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function setup(kind: "discover_search" | "apply_vacancy" = "discover_search") {
  let time = Date.parse("2026-10-04T12:00:00Z");
  let next = 0;
  let checkpoint: Checkpoint | null = null;
  const timers = new Map<number, { run: () => void; at: number }>();
  const payload =
    kind === "discover_search"
      ? { kind, savedSearchId: "search-one", text: "", maxPages: 1 }
      : {
          kind,
          applicationId: "app-one",
          vacancyId: "123",
          resumeId: "resume-one",
          expectedVersion: 1,
          coverLetter: "Synthetic letter",
        };
  const job = companionJob(payload, {
    jobId: "read-job",
    hhAccountKey: "account-one",
    expiresAt: new Date(time + 120000).toISOString(),
  });
  const receipts: CompanionReceipt[] = [];
  let renewals = 0;
  let executions = 0;
  let finish: (value: CompanionReceipt) => void = () => {};
  const checkpoints: CheckpointStore = {
    load: async () => checkpoint,
    save: async (value) => {
      checkpoint = value;
    },
    clear: async () => {
      checkpoint = null;
    },
  };
  const deps = {
    now: () => time,
    scheduleTimer: (run: () => void, delay: number) => {
      const id = ++next;
      timers.set(id, { run, at: time + delay });
      return () => {
        timers.delete(id);
      };
    },
    checkpoints,
    transport: companionTransport({
      lease: async () => job,
      renew: async () => {
        renewals++;
        return { expiresAt: new Date(time + 120000).toISOString() };
      },
      receipt: async (value) => {
        receipts.push(value);
      },
    }),
    execute: async (_job: CompanionJob): Promise<CompanionReceipt> => {
      executions++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  return {
    deps,
    job,
    receipts,
    timers,
    checkpoint: () => checkpoint,
    counts: () => ({ renewals, executions }),
    finish: () => finish(companionReceipt(job)),
    async advance(ms: number) {
      time += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= time) {
          timers.delete(id);
          timer.run();
        }
      }
      await flush();
    },
  };
}
test("long read execution renews finite leases, updates the same job and stops timers at completion", async () => {
  const state = setup();
  const worker = createCompanionWorker(state.deps);
  const tick = worker.tick();
  await flush();
  const initial = Date.parse(state.job.expiresAt);
  for (let i = 0; i < 6; i++) await state.advance(30000);
  assert.equal(state.counts().renewals, 6);
  assert.equal(Date.parse(state.job.expiresAt), initial + 180000);
  assert.equal((await worker.tick()).state, "busy");
  state.finish();
  await tick;
  assert.equal(state.timers.size, 0);
  assert.equal(state.receipts[0].outcome, "confirmed");
  await state.advance(60000);
  assert.equal(state.counts().renewals, 6);
});
test("failed or malformed renewal expires reads and suppresses a late positive result", async () => {
  for (const result of [
    null,
    { expiresAt: "invalid" },
    { expiresAt: "2099-01-01T00:00:00Z" },
  ]) {
    const state = setup();
    state.deps.transport.renew = async () => {
      if (!result) throw new Error("lost response");
      return result;
    };
    const tick = createCompanionWorker(state.deps).tick();
    await flush();
    await state.advance(30000);
    assert.ok(Date.parse(state.job.expiresAt) < state.deps.now());
    assert.equal(state.timers.size, 0);
    state.finish();
    await tick;
    assert.equal(state.receipts[0].outcome, "needs_user");
    assert.equal(state.receipts[0].evidence.reasonCode, "lease_renewal_failed");
  }
});
test("renewal never overlaps, drains before next job, and a late failure is retained", async () => {
  const state = setup();
  let rejectRenew: (error: Error) => void = () => {};
  let calls = 0;
  state.deps.transport.renew = () => {
    calls++;
    return new Promise((_resolve, reject) => {
      rejectRenew = reject;
    });
  };
  const worker = createCompanionWorker(state.deps);
  const tick = worker.tick();
  await flush();
  await state.advance(30000);
  await state.advance(30000);
  assert.equal(calls, 1);
  state.finish();
  await flush();
  assert.equal((await worker.tick()).state, "busy");
  rejectRenew(new Error("offline"));
  await tick;
  assert.equal(state.receipts[0].outcome, "needs_user");
  assert.equal(state.timers.size, 0);
});
test("mutations and checkpoint recovery never start lease keepalive", async () => {
  const state = setup("apply_vacancy");
  const worker = createCompanionWorker(state.deps);
  const tick = worker.tick();
  await flush();
  await state.advance(30000);
  assert.equal(state.timers.size, 0);
  assert.equal(state.counts().renewals, 0);
  state.finish();
  await tick;
  await state.deps.checkpoints.save({ ...state.job, phase: "authorized" });
  assert.equal((await worker.tick()).state, "reconciling");
  assert.equal(state.timers.size, 0);
  assert.equal(state.counts().executions, 1);
});
test("executor errors clear timers and suspended expired leases are never renewed", async () => {
  const failed = setup();
  failed.deps.execute = async () => {
    throw new Error("read failed");
  };
  await assert.rejects(
    createCompanionWorker(failed.deps).tick(),
    /read failed/,
  );
  assert.equal(failed.timers.size, 0);
  const expired = setup();
  const tick = createCompanionWorker(expired.deps).tick();
  await flush();
  await expired.advance(150000);
  assert.equal(expired.counts().renewals, 0);
  expired.finish();
  await tick;
  assert.equal(expired.receipts[0].evidence.reasonCode, "lease_renewal_failed");
  assert.equal(expired.timers.size, 0);
});
