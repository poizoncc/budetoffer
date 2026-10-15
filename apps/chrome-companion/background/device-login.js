export const LOGIN_KEY = 'chairs-companion-device-login-v1';
export const LOGIN_ALARM = 'chairs-companion-device-login';
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const USER_CODE = /^[2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{3}$/u;

export function pairingCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  if (TOKEN.test(code)) return code;
  const short = code.toUpperCase();
  if (!/^[2-9A-HJKMNP-Z]{3}-?[2-9A-HJKMNP-Z]{3}$/u.test(short)) return null;
  const raw = short.replace('-', '');
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

export function validDevice(value, origins, now) {
  return !!(value && origins.has(value.origin) && TOKEN.test(value.accessToken)
    && typeof value.deviceId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(value.deviceId)
    && typeof value.expiresAt === 'string' && Date.parse(value.expiresAt) > now);
}

export function validPendingLogin(value, origins, now) {
  return !!(value && origins.has(value.origin) && TOKEN.test(value.deviceCode) && USER_CODE.test(value.userCode)
    && typeof value.expiresAt === 'string' && Date.parse(value.expiresAt) > now
    && Number.isFinite(value.nextPollAt) && Number.isInteger(value.intervalSeconds) && value.intervalSeconds >= 5 && value.intervalSeconds <= 60);
}

export function publicPendingLogin(value) {
  const target = new URL(value.origin);
  return { userCode: value.userCode, verificationUri: `${target.origin}/#companion-connect=${value.userCode}`,
    expiresAt: value.expiresAt, phoneReachable: !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) };
}

export async function publicLoginRequest(fetchImpl, origin, path, body) {
  const response = await fetchImpl(`${origin}/api/v1/companion/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(response.status === 410 ? 'login_expired' : 'device_login_unavailable');
  return response.json();
}
