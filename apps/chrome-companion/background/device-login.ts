import { isRecord } from "../shared/record.ts";
import { createCompanionRequestError } from "../../../packages/ewans/src/index.ts";
export interface Device {
  origin: string;
  accessToken: string;
  deviceId: string;
  expiresAt: string;
}
export interface PendingLogin {
  origin: string;
  deviceCode: string;
  userCode: string;
  expiresAt: string;
  intervalSeconds: number;
  nextPollAt: number;
}
export interface LoginStart {
  deviceCode: string;
  userCode: string;
  expiresAt: string;
  intervalSeconds: number;
}
export type LoginPoll =
  | ({ state: "approved" } & Omit<Device, "origin">)
  | { state: "expired" | "pending" };
export const LOGIN_KEY = "chairs-companion-device-login-v1";
export const LOGIN_ALARM = "chairs-companion-device-login";
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const USER_CODE = /^[2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{3}$/u;

export function pairingCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim();
  if (TOKEN.test(code)) return code;
  const short = code.toUpperCase();
  if (!/^[2-9A-HJKMNP-Z]{3}-?[2-9A-HJKMNP-Z]{3}$/u.test(short)) return null;
  const raw = short.replace("-", "");
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

export function validDevice(
  value: unknown,
  origins: ReadonlySet<string>,
  now: number,
): value is Device {
  return !!(
    isRecord(value) &&
    typeof value.origin === "string" &&
    origins.has(value.origin) &&
    typeof value.accessToken === "string" &&
    TOKEN.test(value.accessToken) &&
    typeof value.deviceId === "string" &&
    /^[a-zA-Z0-9_-]{1,128}$/u.test(value.deviceId) &&
    typeof value.expiresAt === "string" &&
    Date.parse(value.expiresAt) > now
  );
}

export function validPendingLogin(
  value: unknown,
  origins: ReadonlySet<string>,
  now: number,
): value is PendingLogin {
  return !!(
    isRecord(value) &&
    typeof value.origin === "string" &&
    origins.has(value.origin) &&
    typeof value.deviceCode === "string" &&
    TOKEN.test(value.deviceCode) &&
    typeof value.userCode === "string" &&
    USER_CODE.test(value.userCode) &&
    typeof value.expiresAt === "string" &&
    Date.parse(value.expiresAt) > now &&
    typeof value.nextPollAt === "number" &&
    Number.isFinite(value.nextPollAt) &&
    typeof value.intervalSeconds === "number" &&
    Number.isInteger(value.intervalSeconds) &&
    value.intervalSeconds >= 5 &&
    value.intervalSeconds <= 60
  );
}

export function publicPendingLogin(value: PendingLogin) {
  const target = new URL(value.origin);
  return {
    userCode: value.userCode,
    verificationUri: `${target.origin}/#companion-connect=${value.userCode}`,
    expiresAt: value.expiresAt,
    phoneReachable: !["127.0.0.1", "localhost", "[::1]"].includes(
      target.hostname,
    ),
  };
}

export async function publicLoginRequest(
  fetchImpl: typeof fetch,
  origin: string,
  path: "device-login/start",
  body: { label: string },
): Promise<LoginStart>;
export async function publicLoginRequest(
  fetchImpl: typeof fetch,
  origin: string,
  path: "device-login/poll",
  body: { deviceCode: string },
): Promise<LoginPoll>;
export async function publicLoginRequest(
  fetchImpl: typeof fetch,
  origin: string,
  path: string,
  body: unknown,
): Promise<LoginStart | LoginPoll> {
  const response = await fetchImpl(`${origin}/api/v1/companion/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const problem: unknown = await response.json().catch(() => null);
    throw createCompanionRequestError(
      problem,
      response.status,
      response.status === 410 ? "login_expired" : "device_login_unavailable",
    );
  }
  const value: unknown = await response.json().catch(() => {
    throw createCompanionRequestError(null, 502, "invalid_login_response");
  });
  if (!isRecord(value)) throw new Error("invalid_login_response");
  if (
    path === "device-login/start" &&
    typeof value.deviceCode === "string" &&
    typeof value.userCode === "string" &&
    typeof value.expiresAt === "string" &&
    typeof value.intervalSeconds === "number"
  ) {
    return {
      deviceCode: value.deviceCode,
      userCode: value.userCode,
      expiresAt: value.expiresAt,
      intervalSeconds: value.intervalSeconds,
    };
  }
  if (path === "device-login/poll") {
    if (
      value.state === "approved" &&
      typeof value.deviceId === "string" &&
      typeof value.accessToken === "string" &&
      typeof value.expiresAt === "string"
    ) {
      return {
        state: value.state,
        deviceId: value.deviceId,
        accessToken: value.accessToken,
        expiresAt: value.expiresAt,
      };
    }
    if (value.state === "pending" || value.state === "expired") {
      return { state: value.state };
    }
  }
  throw new Error("invalid_login_response");
}
