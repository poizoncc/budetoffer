import { blockedReceipt } from "../hh/executor.ts";
import { isMutationPermit } from "../shared/companion-protocol.ts";
import type {
  CheckpointStore,
  CompanionJob,
  CompanionReceipt,
  CompanionTransport,
  MutationPermit,
  MutationPreflight,
  ReconciliationResult,
} from "../shared/companion-protocol.ts";
type ApplicationJob = CompanionJob<"apply_vacancy">;
export type ConfirmedApplication = ReconciliationResult & {
  hhAccountKey: string;
};
interface MutationOptions {
  transport: CompanionTransport;
  checkpoints: CheckpointStore;
  now?: () => number;
  inspect?: (job: ApplicationJob) => Promise<MutationPreflight>;
  submit?: (
    job: ApplicationJob,
    permit: MutationPermit,
    checked: MutationPreflight,
  ) => Promise<unknown>;
  reconcile?: (
    job: ApplicationJob,
    checked: MutationPreflight,
  ) => Promise<ConfirmedApplication>;
  confirmReceipt?: (
    job: ApplicationJob,
    permit: MutationPermit,
    observed: ConfirmedApplication,
  ) => Promise<CompanionReceipt>;
}

/** The browser adapter is packaged code, never supplied by a job or remote server.
 * This coordinator deliberately has no default submit adapter: live form and ownership
 * grounding is required before bootstrap may enable it.
 */
export function createApplicationMutation({
  transport,
  checkpoints,
  inspect,
  submit,
  reconcile,
  confirmReceipt,
  now = () => Date.now(),
}: MutationOptions) {
  let running = false;
  return async function execute(job: CompanionJob): Promise<CompanionReceipt> {
    if (running) return blockedReceipt(job, "executor_busy");
    running = true;
    let uncertain = false;
    let permit: MutationPermit | undefined;
    const unknown = (reason: string): CompanionReceipt => ({
      ...blockedReceipt(job, reason, "unknown"),
      ...(permit ? { permitId: permit.permitId } : {}),
    });
    try {
      const previous = await checkpoints.load();
      if (
        previous &&
        (previous.jobId !== job.jobId || previous.phase !== "leased")
      ) {
        return unknown("reconciliation_required");
      }
      if (
        job.kind !== "apply_vacancy" ||
        job.payload?.kind !== job.kind ||
        !inspect ||
        !submit ||
        !reconcile ||
        !confirmReceipt
      ) {
        return blockedReceipt(job, "mutation_adapter_unavailable");
      }
      if (
        !Number.isFinite(Date.parse(job.expiresAt)) ||
        Date.parse(job.expiresAt) <= now()
      ) {
        return blockedReceipt(job, "lease_expired");
      }
      if (Object.keys(job.payload.answers ?? {}).length) {
        return blockedReceipt(job, "unsupported_response_questions");
      }
      // Freeze the private payload in memory; never put the cover letter in checkpoint storage.
      const frozen = structuredClone(job);
      const serialized = JSON.stringify(frozen);
      const checked = await inspect(frozen);
      if (
        !checked ||
        checked.supported !== true ||
        checked.ownershipVerified !== true ||
        checked.hhAccountKey !== frozen.hhAccountKey ||
        checked.vacancyId !== frozen.payload.vacancyId ||
        checked.resumeId !== frozen.payload.resumeId ||
        !/^[1-9]\d{0,30}$/u.test(checked.resumeInternalId) ||
        typeof checked.formFingerprint !== "string" ||
        !/^[a-f0-9]{64}$/u.test(checked.formFingerprint)
      ) {
        return blockedReceipt(job, "response_preflight_unverified");
      }
      // Persist uncertainty BEFORE requesting the one-shot permit: its response can be lost.
      await checkpoints.save({ ...frozen, phase: "authorized" });
      uncertain = true;
      const response = await transport.authorize(frozen, checked);
      if (
        !isMutationPermit(response) ||
        response.jobId !== frozen.jobId ||
        response.payloadHash !== frozen.payloadHash ||
        !/^[A-Za-z0-9_-]{43}$/u.test(response.permitId) ||
        !Number.isFinite(Date.parse(response.expiresAt)) ||
        Date.parse(response.expiresAt) <= now()
      ) {
        return unknown("invalid_mutation_permit");
      }
      permit = response;
      await checkpoints.save({
        ...frozen,
        phase: "authorized",
        permitId: permit.permitId,
      });
      const again = await inspect(frozen);
      if (
        JSON.stringify(again) !== JSON.stringify(checked) ||
        JSON.stringify(frozen) !== serialized ||
        Date.parse(permit.expiresAt) <= now() ||
        Date.parse(frozen.expiresAt) <= now()
      ) {
        return unknown("mutation_context_changed");
      }
      // Exactly one call. A throw, timeout or missing acknowledgement never causes retry.
      await submit(frozen, permit, checked);
      const observed = await reconcile(frozen, checked);
      if (
        !observed ||
        observed.complete !== true ||
        observed.hhAccountKey !== frozen.hhAccountKey ||
        observed.vacancyId !== frozen.payload.vacancyId ||
        observed.resumeId !== frozen.payload.resumeId ||
        observed.resumeInternalId !== checked.resumeInternalId ||
        !/^[1-9]\d{0,30}$/u.test(observed.negotiationId)
      ) {
        return unknown("submission_unconfirmed");
      }
      return await confirmReceipt(frozen, permit, observed);
    } catch {
      return uncertain
        ? unknown("submission_unconfirmed")
        : blockedReceipt(job, "response_preflight_unverified");
    } finally {
      running = false;
    }
  };
}
