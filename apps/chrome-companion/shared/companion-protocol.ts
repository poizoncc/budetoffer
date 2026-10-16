import { isRecord } from "./record.ts";

/** Contracts shared by the packaged worker, its local outbox and HH adapters. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JobKind =
  | "read_profile"
  | "read_resume_artifact"
  | "read_application_outcomes"
  | "discover_search"
  | "verify_vacancy"
  | "publish_resume_variant"
  | "apply_vacancy"
  | "reconcile_history";
export interface OutcomeTarget {
  applicationId: string;
  expectedVersion: number;
  vacancyId: string;
  resumeId: string;
  resumeInternalId: string;
  negotiationId: string;
  claimJobId: string;
  historyJobId: string;
}
export interface JobPayloads {
  read_profile: {
    kind: "read_profile";
    includeResumeIds: string[];
    includeProfileText: boolean;
  };
  read_resume_artifact: {
    kind: "read_resume_artifact";
    resumeId: string;
    internalId: string;
  };
  read_application_outcomes: {
    kind: "read_application_outcomes";
    targets: OutcomeTarget[];
    maxPages: number;
  };
  discover_search: {
    kind: "discover_search";
    savedSearchId: string;
    text: string;
    maxPages: number;
    cursor?: { page: number; offset: number };
    rootJobId?: string;
    searchParameters?: [string, string][];
  };
  verify_vacancy: {
    kind: "verify_vacancy";
    vacancyId: string;
    applicationId: string;
    expectedVersion: number;
  };
  reconcile_history: {
    kind: "reconcile_history";
    vacancyId: string;
    resumeId: string;
    originalJobId: string;
    applicationId: string;
  };
  apply_vacancy: {
    kind: "apply_vacancy";
    vacancyId: string;
    resumeId: string;
    applicationId: string;
    expectedVersion: number;
    coverLetter: string;
    answers?: Record<string, JsonValue>;
  };
  publish_resume_variant: {
    kind: "publish_resume_variant";
    applicationId: string;
    variantId: string;
    baseResumeId: string;
    expectedVersion: number;
  };
}
export interface JobIdentity {
  jobId: string;
  leaseToken: string;
  payloadHash: string;
  hhAccountKey: string;
  deviceId?: string;
  origin?: string;
}
export type CompanionJob<K extends JobKind = JobKind> = {
  [P in K]: JobIdentity & {
    protocolVersion: 1;
    kind: P;
    payload: JobPayloads[P];
    expiresAt: string;
    reconcileOriginal?: Checkpoint;
  };
}[K];
export type ReadJob = CompanionJob<
  Exclude<JobKind, "apply_vacancy" | "publish_resume_variant">
>;
export interface VacancyEvidence {
  vacancyId: string;
  title: string;
  text: string;
}
export interface SearchVacancy extends VacancyEvidence {
  company: string | null;
}
export interface ResumeEvidence {
  resumeId: string;
  internalId: string;
}
export interface OutcomeObservation {
  negotiationId: string;
  vacancyId: string;
  resumeId: string;
  resumeInternalId: string;
  stage: string;
}
export interface ResumeArtifact {
  kind: "resume_artifact_readback";
  readerVersion: string;
  hhAccountKey: string;
  resumeId: string;
  internalId: string;
  headline: string;
  about: string;
  keySkills: string[];
}
export interface ReconciliationResult {
  kind: "reconcile_history";
  originalJobId: string;
  vacancyId: string;
  resumeId: string;
  resumeInternalId: string;
  negotiationId: string;
  pages: number;
  complete: boolean;
}
export type JobResult =
  | { kind: "read_profile"; resumes: ResumeEvidence[] }
  | { kind: "read_resume_artifact"; artifact: ResumeArtifact }
  | ({ kind: "verify_vacancy" } & VacancyEvidence)
  | {
      kind: "discover_search";
      savedSearchId: string;
      pages: number;
      complete: boolean;
      vacancies: SearchVacancy[];
      nextCursor?: { page: number; offset: number } | null;
    }
  | {
      kind: "read_application_outcomes";
      readerVersion: string;
      observedAt: string;
      pages: number;
      complete: boolean;
      observations: OutcomeObservation[];
    }
  | ReconciliationResult;
export interface ReceiptEvidence {
  hhAccountKey: string;
  observedAt: string;
  reasonCode?: string;
  vacancyId?: string;
  resumeId?: string;
}
export interface CompanionReceipt {
  receiptId: string;
  jobId: string;
  leaseToken: string;
  payloadHash: string;
  outcome: "needs_user" | "unknown" | "confirmed" | "already_exists";
  evidence: ReceiptEvidence;
  permitId?: string;
  result?: JobResult;
}
export type Receipt = CompanionReceipt;
export type CheckpointPhase =
  "leased" | "authorized" | "reconciling" | "receipted";
// Older outboxes predate account binding. Their absence never proves ownership;
// a targeted reconciliation still requires the exact account on a fresh lease.
export interface Checkpoint extends Omit<JobIdentity, "hhAccountKey"> {
  hhAccountKey?: string;
  phase: CheckpointPhase;
  permitId?: string;
  receipt?: CompanionReceipt;
  reconcileOriginal?: Checkpoint;
}
export interface CheckpointStore {
  load(): Promise<Checkpoint | null>;
  save(value: Checkpoint): Promise<void>;
  clear(): Promise<void>;
}
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  setAccessLevel?(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
}
export interface MutationPreflight {
  supported: boolean;
  ownershipVerified: boolean;
  selectionVerified?: boolean;
  responseAllowed?: boolean;
  hhAccountKey: string;
  vacancyId: string;
  resumeId: string;
  resumeInternalId: string;
  formVersion?: string;
  formFingerprint: string;
  vacancyTextHash?: string;
}
export interface MutationPermit {
  jobId: string;
  payloadHash: string;
  permitId: string;
  expiresAt: string;
}
export interface CompanionTransport {
  heartbeat(key: string | null): Promise<unknown>;
  lease(originalId?: string): Promise<CompanionJob | null>;
  renew(job: JobIdentity): Promise<unknown>;
  publicDetails?(job: JobIdentity, vacancyIds: string[]): Promise<unknown>;
  recovery(jobId: string): Promise<unknown>;
  authorize(job: JobIdentity, preflight?: MutationPreflight): Promise<unknown>;
  receipt(receipt: CompanionReceipt): Promise<unknown>;
}
export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/u.test(value);
}
export function isNumericIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,30}$/u.test(value);
}
function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
function isSearchParameters(value: unknown): value is [string, string][] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        Array.isArray(item) &&
        item.length === 2 &&
        typeof item[0] === "string" &&
        typeof item[1] === "string",
    )
  );
}
function isOutcomeTarget(value: unknown): value is OutcomeTarget {
  return (
    isRecord(value) &&
    ["applicationId", "resumeId", "claimJobId", "historyJobId"].every((key) =>
      isIdentifier(value[key]),
    ) &&
    ["vacancyId", "resumeInternalId", "negotiationId"].every((key) =>
      isNumericIdentifier(value[key]),
    ) &&
    typeof value.expectedVersion === "number" &&
    Number.isSafeInteger(value.expectedVersion) &&
    value.expectedVersion >= 0
  );
}
function isJsonValue(value: unknown): value is JsonValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every(isJsonValue)) ||
    (isRecord(value) && Object.values(value).every(isJsonValue))
  );
}
export function isCompanionJob(value: unknown): value is CompanionJob {
  if (
    !isRecord(value) ||
    !isIdentifier(value.jobId) ||
    typeof value.leaseToken !== "string" ||
    typeof value.payloadHash !== "string" ||
    typeof value.hhAccountKey !== "string" ||
    typeof value.expiresAt !== "string" ||
    value.protocolVersion !== 1 ||
    !isRecord(value.payload) ||
    value.payload.kind !== value.kind ||
    (value.deviceId !== undefined && typeof value.deviceId !== "string") ||
    (value.origin !== undefined && typeof value.origin !== "string") ||
    (value.reconcileOriginal !== undefined &&
      !isCheckpointValue(value.reconcileOriginal))
  ) {
    return false;
  }
  const p = value.payload;
  switch (p.kind) {
    case "read_profile":
      return (
        isStringArray(p.includeResumeIds) &&
        typeof p.includeProfileText === "boolean"
      );
    case "read_resume_artifact":
      return typeof p.resumeId === "string" && typeof p.internalId === "string";
    case "read_application_outcomes":
      return (
        Array.isArray(p.targets) &&
        p.targets.every(isOutcomeTarget) &&
        typeof p.maxPages === "number"
      );
    case "discover_search":
      return (
        typeof p.savedSearchId === "string" &&
        typeof p.text === "string" &&
        typeof p.maxPages === "number" &&
        (p.searchParameters === undefined ||
          isSearchParameters(p.searchParameters))
      );
    case "verify_vacancy":
      return (
        typeof p.vacancyId === "string" &&
        typeof p.applicationId === "string" &&
        typeof p.expectedVersion === "number"
      );
    case "reconcile_history":
      return (
        typeof p.vacancyId === "string" &&
        typeof p.resumeId === "string" &&
        typeof p.originalJobId === "string" &&
        typeof p.applicationId === "string"
      );
    case "apply_vacancy":
      return (
        typeof p.vacancyId === "string" &&
        typeof p.resumeId === "string" &&
        typeof p.applicationId === "string" &&
        typeof p.expectedVersion === "number" &&
        typeof p.coverLetter === "string" &&
        (p.answers === undefined ||
          (isRecord(p.answers) && Object.values(p.answers).every(isJsonValue)))
      );
    case "publish_resume_variant":
      return (
        typeof p.applicationId === "string" &&
        typeof p.variantId === "string" &&
        typeof p.baseResumeId === "string" &&
        typeof p.expectedVersion === "number"
      );
    default:
      return false;
  }
}
export function parseCompanionJob(value: unknown): CompanionJob {
  if (!isCompanionJob(value)) throw new Error("invalid_companion_job");
  return value;
}
export function isMutationPermit(value: unknown): value is MutationPermit {
  return (
    isRecord(value) &&
    typeof value.jobId === "string" &&
    typeof value.payloadHash === "string" &&
    typeof value.permitId === "string" &&
    typeof value.expiresAt === "string"
  );
}
function isResumeEvidence(value: unknown): value is ResumeEvidence {
  return (
    isRecord(value) &&
    typeof value.resumeId === "string" &&
    typeof value.internalId === "string"
  );
}
function isVacancyEvidence(value: unknown): value is VacancyEvidence {
  return (
    isRecord(value) &&
    typeof value.vacancyId === "string" &&
    typeof value.title === "string" &&
    typeof value.text === "string"
  );
}
export function isJobResult(value: unknown): value is JobResult {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "read_profile":
      return (
        Array.isArray(value.resumes) && value.resumes.every(isResumeEvidence)
      );
    case "verify_vacancy":
      return isVacancyEvidence(value);
    case "read_resume_artifact": {
      const a = value.artifact;
      return (
        isRecord(a) &&
        a.kind === "resume_artifact_readback" &&
        typeof a.readerVersion === "string" &&
        typeof a.hhAccountKey === "string" &&
        typeof a.resumeId === "string" &&
        typeof a.internalId === "string" &&
        typeof a.headline === "string" &&
        typeof a.about === "string" &&
        isStringArray(a.keySkills)
      );
    }
    case "discover_search":
      return (
        typeof value.savedSearchId === "string" &&
        typeof value.pages === "number" &&
        typeof value.complete === "boolean" &&
        Array.isArray(value.vacancies) &&
        value.vacancies.every(
          (row) =>
            isVacancyEvidence(row) &&
            isRecord(row) &&
            (row.company === null || typeof row.company === "string"),
        )
      );
    case "read_application_outcomes":
      return (
        typeof value.readerVersion === "string" &&
        typeof value.observedAt === "string" &&
        typeof value.pages === "number" &&
        typeof value.complete === "boolean" &&
        Array.isArray(value.observations) &&
        value.observations.every(
          (row) =>
            isRecord(row) &&
            [
              "negotiationId",
              "vacancyId",
              "resumeId",
              "resumeInternalId",
              "stage",
            ].every((key) => typeof row[key] === "string"),
        )
      );
    case "reconcile_history":
      return (
        [
          "originalJobId",
          "vacancyId",
          "resumeId",
          "resumeInternalId",
          "negotiationId",
        ].every((key) => typeof value[key] === "string") &&
        typeof value.pages === "number" &&
        typeof value.complete === "boolean"
      );
    default:
      return false;
  }
}
export function isCompanionReceipt(value: unknown): value is CompanionReceipt {
  return (
    isRecord(value) &&
    ["receiptId", "jobId", "leaseToken", "payloadHash"].every(
      (key) => typeof value[key] === "string",
    ) &&
    ["needs_user", "unknown", "confirmed", "already_exists"].some(
      (outcome) => outcome === value.outcome,
    ) &&
    isRecord(value.evidence) &&
    typeof value.evidence.hhAccountKey === "string" &&
    typeof value.evidence.observedAt === "string" &&
    ["reasonCode", "vacancyId", "resumeId"].every(
      (key) =>
        value.evidence &&
        isRecord(value.evidence) &&
        (value.evidence[key] === undefined ||
          typeof value.evidence[key] === "string"),
    ) &&
    (value.permitId === undefined || typeof value.permitId === "string") &&
    (value.result === undefined || isJobResult(value.result))
  );
}
export function isCheckpointValue(
  value: unknown,
  nested = false,
): value is Checkpoint {
  return (
    isRecord(value) &&
    ["leased", "authorized", "reconciling", "receipted"].some(
      (phase) => phase === value.phase,
    ) &&
    typeof value.jobId === "string" &&
    typeof value.leaseToken === "string" &&
    typeof value.payloadHash === "string" &&
    (value.hhAccountKey === undefined ||
      typeof value.hhAccountKey === "string") &&
    (value.permitId === undefined || typeof value.permitId === "string") &&
    (value.deviceId === undefined || typeof value.deviceId === "string") &&
    (value.origin === undefined || typeof value.origin === "string") &&
    (value.receipt === undefined || isCompanionReceipt(value.receipt)) &&
    (value.reconcileOriginal === undefined ||
      (!nested && isCheckpointValue(value.reconcileOriginal, true)))
  );
}
