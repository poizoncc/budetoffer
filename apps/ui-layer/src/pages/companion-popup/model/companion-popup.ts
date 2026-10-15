import { readCompanionEwans, type EwansDescriptor } from "@/shared/api/ewans";

export type CompanionLegalLinks = {
  termsUrl: string | null;
  privacyUrl: string | null;
};
export type PendingLogin = {
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  phoneReachable: boolean;
};
export type CompanionStatus = {
  ok: boolean;
  paired?: boolean;
  origin?: string | null;
  expiresAt?: string | null;
  onboardingRequired?: boolean;
  onboardingVersion?: string;
  requiresReconciliation?: boolean;
  pendingLogin?: PendingLogin | null;
  legalLinks?: CompanionLegalLinks;
  error?: string;
  backgroundError?: string;
  ewans?: EwansDescriptor;
};
export type CompanionMessage =
  | { type: "chairs:device-status"; origin: string }
  | { type: "chairs:start-device-login"; origin: string; label: string }
  | { type: "chairs:pair-device"; origin: string; label: string; code: string }
  | { type: "chairs:disconnect-device"; origin: string }
  | {
      type: "chairs:accept-onboarding";
      origin: string;
      adult: true;
      terms: true;
      privacy: true;
      computerAwake: true;
      version: string;
    };
export type LocalCompanionApplication = {
  id: string;
  title: string;
  company?: string | null;
  status: string;
  version: number;
};
export type LocalCompanionPage = {
  title?: string;
  url: string;
  formDetected?: boolean;
};
export type LocalCompanionState = {
  application: LocalCompanionApplication | null;
  page: LocalCompanionPage | null;
  matches: number;
  total: number;
  busy: boolean;
  message: string;
  error: string;
  connection: { status: string } | null;
};
export type LocalCompanionController = {
  state: LocalCompanionState;
  check: () => Promise<unknown>;
  load: () => Promise<unknown>;
  act: (
    action: "prepare" | "reject" | "delay",
    reason?: string,
  ) => Promise<unknown>;
};
export type CompanionPopupClient = {
  send: (message: CompanionMessage) => Promise<CompanionStatus>;
  open: (url: string) => Promise<void>;
  subscribe: (changed: () => void) => () => void;
  createLocalController?: (
    changed: (state: LocalCompanionState) => void,
  ) => Promise<LocalCompanionController>;
};
export type CompanionPopupConfig = {
  origin: string;
  serverOnly: boolean;
  logoUrl?: string;
};

/** Runtime messages are JSON boundaries, even when the sender is our worker. */
export function parseCompanionStatus(value: unknown): CompanionStatus {
  const record = (input: unknown): input is Record<string, unknown> =>
    typeof input === "object" && input !== null && !Array.isArray(input);
  if (!record(value) || typeof value.ok !== "boolean") {
    throw new Error("invalid_companion_status");
  }
  const status: CompanionStatus = { ok: value.ok };
  if ("ewans" in value) {
    const ewans = readCompanionEwans(value.ewans);
    if (!ewans) throw new Error("invalid_companion_status");
    status.ewans = ewans;
  }
  for (const key of [
    "paired",
    "onboardingRequired",
    "requiresReconciliation",
  ] as const) {
    if (!(key in value)) continue;
    const field = value[key];
    if (typeof field !== "boolean") throw new Error("invalid_companion_status");
    status[key] = field;
  }
  for (const key of ["origin", "expiresAt"] as const) {
    if (!(key in value)) continue;
    const field = value[key];
    if (field !== null && typeof field !== "string") {
      throw new Error("invalid_companion_status");
    }
    status[key] = field;
  }
  for (const key of [
    "onboardingVersion",
    "error",
    "backgroundError",
  ] as const) {
    if (!(key in value)) continue;
    const field = value[key];
    if (typeof field !== "string") throw new Error("invalid_companion_status");
    status[key] = field;
  }
  if ("legalLinks" in value) {
    const links = value.legalLinks;
    if (
      typeof links !== "object" ||
      links === null ||
      !("termsUrl" in links) ||
      !("privacyUrl" in links) ||
      !(links.termsUrl === null || typeof links.termsUrl === "string") ||
      !(links.privacyUrl === null || typeof links.privacyUrl === "string")
    ) {
      throw new Error("invalid_companion_status");
    }
    status.legalLinks = {
      termsUrl: links.termsUrl,
      privacyUrl: links.privacyUrl,
    };
  }
  if ("pendingLogin" in value) {
    const login = value.pendingLogin;
    if (login === null) status.pendingLogin = null;
    else {
      if (
        typeof login !== "object" ||
        !("userCode" in login) ||
        typeof login.userCode !== "string" ||
        !("verificationUri" in login) ||
        typeof login.verificationUri !== "string" ||
        !("expiresAt" in login) ||
        typeof login.expiresAt !== "string" ||
        !("phoneReachable" in login) ||
        typeof login.phoneReachable !== "boolean"
      ) {
        throw new Error("invalid_companion_status");
      }
      status.pendingLogin = {
        userCode: login.userCode,
        verificationUri: login.verificationUri,
        expiresAt: login.expiresAt,
        phoneReachable: login.phoneReachable,
      };
    }
  }
  return status;
}
export const DEVICE_CODE_PATTERN =
  /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}-?[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}$/i;
export function displayDeviceCode(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/-/g, "");
  return normalized.length === 6
    ? `${normalized.slice(0, 3)}-${normalized.slice(3)}`
    : value.trim().toUpperCase();
}
export function validLegalLink(
  value: string | null | undefined,
  origin: string,
): value is string {
  if (!value) return false;
  try {
    const url = new URL(value, origin);
    return (
      url.protocol === "https:" ||
      (url.origin === origin && url.protocol === "http:")
    );
  } catch {
    return false;
  }
}
