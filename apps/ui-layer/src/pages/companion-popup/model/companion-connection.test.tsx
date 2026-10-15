import {act, cleanup, renderHook} from '@testing-library/react';
import {StrictMode, useLayoutEffect} from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {useCompanionConnection} from './companion-connection';
import type {CompanionMessage, CompanionPopupClient, CompanionStatus} from './companion-popup';

const config = {origin: 'http://127.0.0.1:6971', serverOnly: true};
const ready: CompanionStatus = {ok: true, paired: true, origin: config.origin, expiresAt: '2099-10-10T12:00:00Z', onboardingRequired: false};
const login: CompanionStatus = {ok: true, paired: false, origin: null};
const pending = {userCode: '4GN-5TY', verificationUri: `${config.origin}/#companion-connect=4GN-5TY`, expiresAt: '2099-10-10T12:00:00Z', phoneReachable: false};
afterEach(() => {cleanup(); vi.useRealTimers();});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {resolve = accept; reject = fail;});
  return {promise, resolve, reject};
}
function fakeClient(initial: CompanionStatus) {
  let changed = () => {};
  const send = vi.fn<(message: CompanionMessage) => Promise<CompanionStatus>>(async () => initial);
  const unsubscribe = vi.fn();
  const client: CompanionPopupClient = {send, open: vi.fn(async () => {}), subscribe: listener => {changed = listener; return unsubscribe;}};
  return {client, send, unsubscribe, changed: () => changed()};
}
async function mount(client: CompanionPopupClient) {
  const hook = renderHook(() => useCompanionConnection({client, config}));
  await act(async () => {});
  return hook;
}

it('retains the last confirmed connection on a check failure and blocks actions until a successful retry', async () => {
  const fake = fakeClient(ready), hook = await mount(fake.client);
  expect(hook.result.current.stage).toBe('ready');
  fake.send.mockRejectedValueOnce(new Error('synthetic transport failure'));
  await act(async () => hook.result.current.update());
  expect(hook.result.current.status).toEqual(ready);
  expect(hook.result.current.stage).toBe('unavailable');
  expect(hook.result.current.error).toMatch(/Повторите проверку/);
  await act(async () => hook.result.current.update());
  expect(hook.result.current.stage).toBe('ready');
  expect(hook.result.current.error).toBe('');
});

it('expires a displayed login code at its deadline without deleting the pending background request', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
  const status = {...login, pendingLogin: {...pending, expiresAt: '2026-10-10T12:00:05Z'}};
  const fake = fakeClient(status), hook = await mount(fake.client);
  const nextStatus = deferred<CompanionStatus>();
  fake.send.mockReturnValueOnce(nextStatus.promise);
  expect(hook.result.current.loginExpired).toBe(false);
  await act(async () => vi.advanceTimersByTime(5000));
  expect(hook.result.current.loginExpired).toBe(true);
  expect(hook.result.current.status?.pendingLogin).toEqual(status.pendingLogin);
  expect(hook.result.current.checking).toBe(true);
  await act(async () => nextStatus.resolve(login));
  expect(hook.result.current.loginExpired).toBe(false);
  expect(hook.result.current.status?.pendingLogin).toBeUndefined();
  expect(fake.send.mock.calls.every(([message]) => message.type === 'chairs:device-status')).toBe(true);
});

it('requires the exact connected origin and rejects a missing paired origin', async () => {
  const foreign = fakeClient({...ready, origin: 'http://localhost:6971'}), hook = await mount(foreign.client);
  expect(hook.result.current.stage).toBe('conflict');
  foreign.send.mockResolvedValueOnce({...ready, origin: null});
  await act(async () => hook.result.current.update());
  expect(hook.result.current.stage).toBe('unavailable');
  expect(hook.result.current.status?.origin).toBe('http://localhost:6971');
});

it('fails closed when onboarding is unknown, while preserving explicit onboarding and ready states', async () => {
  const fake = fakeClient({...ready, onboardingRequired: undefined}), hook = await mount(fake.client);
  expect(hook.result.current.stage).toBe('unavailable');
  expect(hook.result.current.status).toBeNull();
  fake.send.mockResolvedValueOnce({...ready, onboardingRequired: true});
  await act(async () => hook.result.current.update());
  expect(hook.result.current.stage).toBe('onboarding');
  fake.send.mockResolvedValueOnce(ready);
  await act(async () => hook.result.current.update());
  expect(hook.result.current.stage).toBe('ready');
});

it('fails closed when a paired device has a missing or invalid expiry', async () => {
  for (const expiresAt of [undefined, null, 'synthetic-invalid-time']) {
    const fake = fakeClient({...ready, expiresAt}), hook = await mount(fake.client);
    expect(hook.result.current.stage).toBe('unavailable');
    expect(hook.result.current.status).toBeNull();
    hook.unmount();
  }
});

it('never presents a connected device and a simultaneous pending login as ready', async () => {
  const fake = fakeClient({...ready, pendingLogin: pending}), hook = await mount(fake.client);
  expect(hook.result.current.stage).toBe('conflict');
  expect(fake.send).toHaveBeenCalledOnce();
});

it('does not let a late status check overwrite a newer pairing result', async () => {
  const fake = fakeClient(login), hook = await mount(fake.client);
  const oldCheck = deferred<CompanionStatus>(), pair = deferred<CompanionStatus>();
  fake.send.mockReturnValueOnce(oldCheck.promise).mockReturnValueOnce(pair.promise);
  let changing!: Promise<boolean>;
  act(() => {void hook.result.current.update();});
  act(() => {changing = hook.result.current.change('chairs:pair-device', {code: '4gn5ty'});});
  await act(async () => {pair.resolve({...ready, onboardingRequired: true}); await changing;});
  expect(hook.result.current.stage).toBe('onboarding');
  await act(async () => oldCheck.resolve(login));
  expect(hook.result.current.stage).toBe('onboarding');
  expect(hook.result.current.checking).toBe(false);
  expect(fake.send).toHaveBeenLastCalledWith({type: 'chairs:pair-device', origin: config.origin, label: 'Chrome на этом компьютере', code: '4GN-5TY'});
});

it('serializes mutations and defers storage refresh until the active mutation finishes', async () => {
  const fake = fakeClient(login), hook = await mount(fake.client), pair = deferred<CompanionStatus>(), refresh = deferred<CompanionStatus>();
  fake.send.mockReturnValueOnce(pair.promise).mockReturnValueOnce(refresh.promise);
  let changing!: Promise<boolean>;
  act(() => {changing = hook.result.current.change('chairs:pair-device', {code: '4GN-5TY'});});
  await act(async () => {fake.changed(); await hook.result.current.update(); expect(await hook.result.current.change('chairs:start-device-login')).toBe(false);});
  expect(fake.send).toHaveBeenCalledTimes(2);
  await act(async () => {pair.resolve({...ready, onboardingRequired: true}); await changing;});
  expect(fake.send).toHaveBeenCalledTimes(3);
  expect(hook.result.current.stage).toBe('onboarding');
  await act(async () => refresh.resolve(ready));
  expect(hook.result.current.stage).toBe('ready');
  expect(hook.result.current.busy).toBe(false);
});

it('requires a fresh check after a lost mutation response instead of pretending that pairing failed or succeeded', async () => {
  const fake = fakeClient(login), hook = await mount(fake.client);
  fake.send.mockRejectedValueOnce(new Error('synthetic response lost'));
  await act(async () => expect(await hook.result.current.change('chairs:pair-device', {code: '4GN-5TY'})).toBe(false));
  expect(hook.result.current.status).toEqual(login);
  expect(hook.result.current.stage).toBe('unavailable');
  await act(async () => expect(await hook.result.current.change('chairs:pair-device', {code: '4GN-5TY'})).toBe(false));
  expect(fake.send).toHaveBeenCalledTimes(2);
  fake.send.mockResolvedValueOnce({...ready, onboardingRequired: true});
  await act(async () => hook.result.current.update());
  expect(hook.result.current.stage).toBe('onboarding');
});

it('ignores responses from the previous client lifecycle and unsubscribes it', async () => {
  const old = fakeClient(login), newClient = fakeClient(ready), oldResponse = deferred<CompanionStatus>();
  old.send.mockReturnValueOnce(oldResponse.promise);
  const hook = renderHook(({client}) => useCompanionConnection({client, config}), {initialProps: {client: old.client}});
  hook.rerender({client: newClient.client});
  await act(async () => {});
  expect(hook.result.current.stage).toBe('ready');
  await act(async () => oldResponse.resolve(login));
  expect(hook.result.current.stage).toBe('ready');
  expect(old.unsubscribe).toHaveBeenCalledOnce();
  hook.unmount();
  expect(newClient.unsubscribe).toHaveBeenCalledOnce();
});

it('hides the old connection and rejects a command after config changes, even before the reset effect runs', async () => {
  const fake = fakeClient({...login, pendingLogin: pending});
  const stages: string[] = [], commands: Promise<boolean>[] = [];
  let previousChange: ReturnType<typeof useCompanionConnection>['change'] | undefined;
  const hook = renderHook(({origin}) => {
    const connection = useCompanionConnection({client: fake.client, config: {...config, origin}});
    useLayoutEffect(() => {
      stages.push(connection.stage);
      commands.push(connection.change('chairs:pair-device', {code: '4GN-5TY'}));
      if (previousChange) commands.push(previousChange('chairs:pair-device', {code: '4GN-5TY'}));
    }, [origin]);
    return connection;
  }, {initialProps: {origin: config.origin}});
  await act(async () => {});
  expect(hook.result.current.stage).toBe('login');
  previousChange = hook.result.current.change;
  hook.rerender({origin: 'http://127.0.0.1:7971'});
  await act(async () => {});
  expect(stages).toEqual(['loading', 'loading']);
  expect(await Promise.all(commands)).toEqual([false, false, false]);
  expect(fake.send.mock.calls.every(([message]) => message.type === 'chairs:device-status')).toBe(true);
});

it('ignores the first StrictMode lifecycle request while keeping the second subscription active', async () => {
  const fake = fakeClient(ready), first = deferred<CompanionStatus>();
  fake.send.mockReturnValueOnce(first.promise);
  const hook = renderHook(() => useCompanionConnection({client: fake.client, config}), {wrapper: StrictMode});
  await act(async () => {});
  expect(hook.result.current.stage).toBe('ready');
  await act(async () => first.resolve(login));
  expect(hook.result.current.stage).toBe('ready');
  expect(fake.unsubscribe).toHaveBeenCalledOnce();
  hook.unmount();
  expect(fake.unsubscribe).toHaveBeenCalledTimes(2);
});

it('sends all consent flags only after the explicit onboarding callback', async () => {
  const fake = fakeClient({...ready, onboardingRequired: true}), hook = await mount(fake.client);
  expect(fake.send.mock.calls.every(([message]) => message.type === 'chairs:device-status')).toBe(true);
  fake.send.mockResolvedValueOnce(ready);
  await act(async () => expect(await hook.result.current.change('chairs:accept-onboarding')).toBe(true));
  expect(fake.send).toHaveBeenLastCalledWith({type: 'chairs:accept-onboarding', origin: config.origin, adult: true, terms: true, privacy: true, computerAwake: true, version: '2026-10-10'});
  await act(async () => expect(await hook.result.current.change('chairs:accept-onboarding')).toBe(false));
  expect(fake.send).toHaveBeenCalledTimes(2);
});

it('refreshes after visibility and storage events, while a device expiry blocks work during a pending check', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
  const fake = fakeClient({...ready, expiresAt: '2026-10-10T12:00:05Z'}), hook = await mount(fake.client);
  await act(async () => {document.dispatchEvent(new Event('visibilitychange')); fake.changed();});
  expect(fake.send).toHaveBeenCalledTimes(3);
  const expiryCheck = deferred<CompanionStatus>();
  fake.send.mockReturnValueOnce(expiryCheck.promise);
  await act(async () => vi.advanceTimersByTime(5000));
  expect(hook.result.current.stage).toBe('unavailable');
  expect(hook.result.current.status?.paired).toBe(true);
  await act(async () => expiryCheck.resolve(login));
  expect(hook.result.current.stage).toBe('login');
});
