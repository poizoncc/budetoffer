import { isRecord } from '../shared/companion-protocol.ts';
import type { Device } from './device-login.ts';
export interface OnboardingConfig { version: string; termsUrl: string; privacyUrl: string }
export interface OnboardingMessage { version?: unknown; adult?: unknown; terms?: unknown; privacy?: unknown; computerAwake?: unknown }
export const ONBOARDING_KEY = 'chairs-companion-onboarding-v1';

function documentUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && local))) return null;
    return url.href;
  } catch { return null; }
}

export function legalLinks(config: OnboardingConfig) {
  return { termsUrl: documentUrl(config.termsUrl), privacyUrl: documentUrl(config.privacyUrl) };
}

export function onboardingAccepted(value: unknown, device: Device, config: OnboardingConfig): boolean {
  const links = legalLinks(config);
  return !!(links.termsUrl && links.privacyUrl && isRecord(value)
    && value.deviceId === device.deviceId && value.origin === device.origin
    && value.version === config.version && value.termsUrl === links.termsUrl && value.privacyUrl === links.privacyUrl
    && ['adult', 'terms', 'privacy', 'computerAwake'].every(key => value[key] === true));
}

export function acceptedOnboarding(message: unknown, device: Device, config: OnboardingConfig, now: number) {
  const links = legalLinks(config);
  if (!links.termsUrl || !links.privacyUrl || !isRecord(message) || message.version !== config.version
    || !['adult', 'terms', 'privacy', 'computerAwake'].every(key => message[key] === true)) throw new Error('onboarding_required');
  return { deviceId: device.deviceId, origin: device.origin, version: config.version,
    adult: true, terms: true, privacy: true, computerAwake: true, ...links, acceptedAt: new Date(now).toISOString() };
}
