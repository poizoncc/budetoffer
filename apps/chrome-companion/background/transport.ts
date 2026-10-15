import { COMPANION_ORIGINS } from "../shared/destinations.ts";
import { parseCompanionJob } from "../shared/companion-protocol.ts";
import { isRecord } from "../shared/record.ts";
import type { CompanionTransport } from "../shared/companion-protocol.ts";
import { createCompanionRequestError } from "../../../packages/ewans/src/index.ts";
interface TransportOptions {
  origin: string;
  token(): Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}
export function createCompanionTransport({
  origin,
  token,
  fetchImpl = fetch,
  timeoutMs = 15000,
}: TransportOptions): CompanionTransport {
  if (!COMPANION_ORIGINS.includes(origin)) {
    throw new Error("invalid_companion_origin");
  }
  const target = new URL(origin);
  if (
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    !(
      target.protocol === "https:" ||
      (target.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname))
    )
  ) {
    throw new Error("invalid_companion_origin");
  }
  async function post(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("device_not_paired");
      const response = await fetchImpl(
        `${target.origin}/api/v1/companion/${path}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
          credentials: "omit",
          redirect: "error",
        },
      );
      if (!response.ok) {
        const problem: unknown = await response.json().catch(() => null);
        throw createCompanionRequestError(
          problem,
          response.status,
          `companion_http_${response.status}`,
        );
      }
      const value: unknown = await response.json().catch(() => {
        throw createCompanionRequestError(null, 502, "invalid_response");
      });
      return value;
    } finally {
      clearTimeout(timer);
    }
  }
  const id = (value: unknown) => {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value)) {
      throw new Error("invalid_job_id");
    }
    return value;
  };
  return {
    heartbeat: (hhAccountKey) => post("heartbeat", { hhAccountKey }),
    lease: async (reconcileOriginalJobId) => {
      const response = await post(
        "jobs/lease",
        reconcileOriginalJobId === undefined
          ? {}
          : { reconcileOriginalJobId: id(reconcileOriginalJobId) },
      );
      if (!isRecord(response)) throw new Error("invalid_companion_job");
      return response.job == null ? null : parseCompanionJob(response.job);
    },
    renew: (job) =>
      post(`jobs/${id(job.jobId)}/renew`, { leaseToken: job.leaseToken }),
    publicDetails: (job, vacancyIds) =>
      post(`jobs/${id(job.jobId)}/public-details`, {
        leaseToken: job.leaseToken,
        payloadHash: job.payloadHash,
        vacancyIds,
      }),
    recovery: (jobId) => post(`jobs/${id(jobId)}/recovery`, {}),
    authorize: (job, preflight) =>
      post(`jobs/${id(job.jobId)}/authorize-mutation`, {
        leaseToken: job.leaseToken,
        payloadHash: job.payloadHash,
        ...(preflight === undefined ? {} : { preflight }),
      }),
    receipt: (receipt) => post(`jobs/${id(receipt.jobId)}/receipts`, receipt),
  };
}
