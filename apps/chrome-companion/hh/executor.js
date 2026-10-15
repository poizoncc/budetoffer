import { accountMatches, readVerifiedAccountIdentity } from "./account.js";

const KINDS = new Set(["read_profile", "read_resume_artifact", "read_application_outcomes", "discover_search", "verify_vacancy", "publish_resume_variant", "apply_vacancy", "reconcile_history"]);
export function blockedReceipt(job, reasonCode, outcome = "needs_user") {
  return { receiptId: crypto.randomUUID(), jobId: job.jobId, leaseToken: job.leaseToken, payloadHash: job.payloadHash, outcome,
    evidence: { hhAccountKey: "", observedAt: new Date().toISOString(), reasonCode } };
}
export async function executeJob(job, { identity = readVerifiedAccountIdentity, readJob } = {}) {
  if (job?.protocolVersion !== 1 || !KINDS.has(job.kind) || job.payload?.kind !== job.kind) return blockedReceipt(job, "needs_update");
  if (!Number.isFinite(Date.parse(job.expiresAt)) || Date.parse(job.expiresAt) <= Date.now()) return blockedReceipt(job, "lease_expired");
  if (!accountMatches(job.hhAccountKey, await identity())) return blockedReceipt(job, "account_identity_unverified");
  if (["apply_vacancy", "publish_resume_variant"].includes(job.kind)) return blockedReceipt(job, "resume_ownership_unverified");
  if (job.kind === "read_profile" && job.payload.includeProfileText) return blockedReceipt(job, "profile_text_not_supported");
  if (!readJob) return blockedReceipt(job, "read_executor_unavailable");
  try {
    const result = await readJob(job);
    if (!Number.isFinite(Date.parse(job.expiresAt)) || Date.parse(job.expiresAt) <= Date.now()) return blockedReceipt(job, "lease_expired");
    return { receiptId: crypto.randomUUID(), jobId: job.jobId, leaseToken: job.leaseToken, payloadHash: job.payloadHash,
      outcome: job.kind === "reconcile_history" ? "already_exists" : "confirmed", result,
      evidence: { hhAccountKey: job.hhAccountKey, observedAt: job.kind === 'read_application_outcomes' ? result.observedAt : new Date().toISOString(),
        ...(job.payload.vacancyId ? { vacancyId: job.payload.vacancyId } : {}), ...(job.payload.resumeId ? { resumeId: job.payload.resumeId } : {}) } };
  } catch (error) {
    const known = new Set(["account_identity_unverified", "account_changed", "unexpected_hh_navigation", "lease_expired", "vacancy_identity_mismatch", "vacancy_text_unavailable", "resume_identity_mismatch", "unsupported_hh_page", "unsupported_history_page", "incomplete_history_page", "history_target_mismatch", "history_identity_missing", "history_not_confirmed", "history_ambiguous", "hh_page_timeout", "hh_tab_suspended", "invalid_read_payload", "executor_busy"]);
    return blockedReceipt(job, known.has(error?.message) ? error.message : "hh_read_failed");
  }
}
