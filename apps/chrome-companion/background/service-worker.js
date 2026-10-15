import { createCheckpointStore } from "./checkpoint-store.js";
import { blockedReceipt, executeJob } from "../hh/executor.js";

/** One bounded cycle. Recovery/outbox always precedes leasing. No automatic sends. */
export function createCompanionWorker({ transport, checkpoints, execute = executeJob, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let running = false;
  function readLease(job) {
    let active = ['read_profile', 'read_resume_artifact', 'read_application_outcomes', 'discover_search', 'verify_vacancy', 'reconcile_history'].includes(job.kind), failed = false, timer, pending, renewals = 0;
    const stopReads = () => { failed = true; active = false; job.expiresAt = new Date(now() - 1).toISOString(); };
    const schedule = () => { if (active) timer = setTimer(() => {
      if (!active) return;
      pending = (async () => {
        try {
          // Never renew an already expired lease, even if a timer was suspended.
          if (Date.parse(job.expiresAt) <= now() || ++renewals > 30) throw new Error('lease_expired');
          const renewed = await transport.renew(job);
          const expiry = typeof renewed?.expiresAt === 'string' ? Date.parse(renewed.expiresAt) : NaN;
          if (!renewed || typeof renewed !== 'object' || Array.isArray(renewed) || Object.keys(renewed).some(key => key !== 'expiresAt') || !Number.isFinite(expiry) || new Date(expiry).toISOString() !== renewed.expiresAt || expiry <= now() || expiry <= Date.parse(job.expiresAt) || expiry > now() + 180000) throw new Error('invalid_lease_renewal');
          job.expiresAt = new Date(expiry).toISOString();
        } catch { stopReads(); }
        finally { pending = null; schedule(); }
      })();
    }, 30000); };
    schedule();
    return {
      async stop() {
        active = false;
        if (timer !== undefined) clearTimer(timer);
        // Drain the bounded transport call before this worker can start another job.
        if (pending) await pending;
        return failed;
      }
    };
  }
  return {
    async tick(reconcileOriginalJobId) {
      if (running) return { state: "busy" };
      running = true;
      try {
        const previous = await checkpoints.load();
        const targeted = previous && !previous.reconcileOriginal && ['authorized', 'reconciling'].includes(previous.phase) && reconcileOriginalJobId === previous.jobId;
        if (reconcileOriginalJobId !== undefined && !targeted && !previous?.reconcileOriginal) throw new Error('invalid_reconciliation_target');
        if (previous && !targeted) {
          const receipt = previous.receipt ?? { ...blockedReceipt(previous, previous.phase === "leased" ? "worker_restarted" : "reconciliation_required", previous.phase === "leased" ? "needs_user" : "unknown"), ...(previous.permitId ? { permitId: previous.permitId } : {}) };
          await checkpoints.save({ ...previous, phase: "receipted", receipt });
          await transport.receipt(receipt);
          if (previous.reconcileOriginal) { await checkpoints.save(previous.reconcileOriginal); return { state: 'reconciliation_checked' }; }
          // Uncertain mutation is a durable account lock; never start another job.
          if (["authorized", "reconciling"].includes(previous.phase) || receipt.outcome === "unknown") { await checkpoints.save({ ...previous, phase: "reconciling", receipt }); return { state: "reconciling" }; }
          await checkpoints.clear();
          return { state: "recovered" };
        }
        let job = await transport.lease(targeted ? previous.jobId : undefined);
        if (!job) return { state: "idle" };
        if (targeted) {
          if (job.kind !== 'reconcile_history' || job.payload?.kind !== 'reconcile_history' || job.payload.originalJobId !== previous.jobId || job.hhAccountKey !== previous.hhAccountKey || job.jobId === previous.jobId) throw new Error('invalid_reconciliation_lease');
          job = { ...job, reconcileOriginal: previous };
        }
        await checkpoints.save({ ...job, phase: "leased" });
        const keepalive = readLease(job);
        let receipt, renewalFailed;
        try { receipt = await execute(job); }
        finally { renewalFailed = await keepalive.stop(); }
        if (renewalFailed) receipt = blockedReceipt(job, 'lease_renewal_failed');
        await checkpoints.save({ ...job, phase: "receipted", receipt });
        await transport.receipt(receipt);
        if (job.reconcileOriginal) { await checkpoints.save(job.reconcileOriginal); return { state: 'reconciliation_checked' }; }
        if (receipt.outcome === "unknown") { await checkpoints.save({ ...job, phase: "reconciling", receipt }); return { state: "reconciling" }; }
        await checkpoints.clear();
        return { state: "receipted", outcome: receipt.outcome };
      } finally { running = false; }
    }
  };
}

/** Called only with build-controlled transport. Pairing never enables auto mode. */
export function installCompanionWorker(chromeApi, transport) {
  const checkpoints = createCheckpointStore(chromeApi.storage.local);
  const worker = createCompanionWorker({ transport, checkpoints });
  const tick = () => worker.tick().catch(() => { /* Durable outbox remains for next bounded alarm. */ });
  chromeApi.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  chromeApi.alarms.create("chairs-companion-poll", { periodInMinutes: 1 });
  chromeApi.alarms.onAlarm.addListener(alarm => { if (alarm.name === "chairs-companion-poll") void tick(); });
  chromeApi.runtime.onStartup.addListener(tick);
  return worker;
}
