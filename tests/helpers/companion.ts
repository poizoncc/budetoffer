import { parseCompanionJob } from "../../apps/chrome-companion/shared/companion-protocol.ts";
import type {
  CompanionJob,
  CompanionReceipt,
  CompanionTransport,
  JobIdentity,
  JobKind,
  JobPayloads,
} from "../../apps/chrome-companion/shared/companion-protocol.ts";

/** Synthetic, validated protocol fixtures shared by the worker tests. */
export function companionJob(
  payload: JobPayloads[JobKind],
  overrides: Partial<JobIdentity & { expiresAt: string }> = {},
): CompanionJob {
  return parseCompanionJob({
    protocolVersion: 1,
    jobId: "job-one",
    kind: payload.kind,
    payload,
    hhAccountKey: "hh-applicant-101",
    leaseToken: "x".repeat(43),
    payloadHash: "a".repeat(64),
    expiresAt: new Date(Date.now() + 120000).toISOString(),
    ...overrides,
  });
}

export function companionReceipt(
  job: JobIdentity,
  overrides: Partial<CompanionReceipt> = {},
): CompanionReceipt {
  return {
    receiptId: "receipt-one",
    jobId: job.jobId,
    leaseToken: job.leaseToken,
    payloadHash: job.payloadHash,
    outcome: "confirmed",
    evidence: {
      hhAccountKey: job.hhAccountKey,
      observedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

export function companionTransport(
  overrides: Partial<CompanionTransport> = {},
): CompanionTransport {
  const unexpected = async (): Promise<never> => {
    throw new Error("unexpected_transport_call");
  };
  return {
    heartbeat: unexpected,
    lease: async () => null,
    renew: unexpected,
    recovery: unexpected,
    authorize: unexpected,
    receipt: async () => undefined,
    ...overrides,
  };
}
