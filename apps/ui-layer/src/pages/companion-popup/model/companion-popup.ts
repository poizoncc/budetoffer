export type CompanionLegalLinks = {termsUrl: string | null; privacyUrl: string | null};
export type PendingLogin = {userCode: string; verificationUri: string; expiresAt: string; phoneReachable: boolean};
export type CompanionStatus = {ok: boolean; paired?: boolean; origin?: string | null; expiresAt?: string | null; onboardingRequired?: boolean; onboardingVersion?: string; requiresReconciliation?: boolean; pendingLogin?: PendingLogin | null; legalLinks?: CompanionLegalLinks; error?: string; backgroundError?: string};
export type CompanionMessage = {type: 'chairs:device-status' | 'chairs:start-device-login' | 'chairs:pair-device' | 'chairs:disconnect-device' | 'chairs:accept-onboarding'; origin: string; label?: string; code?: string; adult?: true; terms?: true; privacy?: true; computerAwake?: true; version?: '2026-10-10'};
export type LocalCompanionApplication = {id: string; title: string; company?: string; status: string; version: number};
export type LocalCompanionPage = {title?: string; url: string; formDetected?: boolean};
export type LocalCompanionState = {application: LocalCompanionApplication | null; page: LocalCompanionPage | null; matches: number; total: number; busy: boolean; message: string; error: string; connection: {status: string} | null};
export type LocalCompanionController = {state: LocalCompanionState; check: () => Promise<unknown>; load: () => Promise<unknown>; act: (action: 'prepare' | 'reject' | 'delay', reason?: string) => Promise<unknown>};
export type CompanionPopupClient = {send: (message: CompanionMessage) => Promise<CompanionStatus>; open: (url: string) => Promise<void>; subscribe: (changed: () => void) => () => void; createLocalController?: (changed: (state: LocalCompanionState) => void) => Promise<LocalCompanionController>};
export type CompanionPopupConfig = {origin: string; serverOnly: boolean; logoUrl?: string};
export const DEVICE_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}-?[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}$/i;
export function displayDeviceCode(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/-/g, '');
  return normalized.length === 6 ? `${normalized.slice(0, 3)}-${normalized.slice(3)}` : value.trim().toUpperCase();
}
export function validLegalLink(value: string | null | undefined, origin: string): value is string {
  if (!value) return false;
  try {const url = new URL(value, origin); return url.protocol === 'https:' || url.origin === origin && url.protocol === 'http:';} catch {return false;}
}
