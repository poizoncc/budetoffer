import {afterEach, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {CompanionPopup} from './CompanionPopup';
import type {CompanionMessage, CompanionPopupClient, CompanionStatus, LocalCompanionController, LocalCompanionState} from '../model/companion-popup';

vi.mock('qrcode', () => ({default: {toDataURL: vi.fn(async () => 'data:image/png;base64,c3ludGhldGlj')}}));
afterEach(cleanup);
const config = {origin: 'http://127.0.0.1:6971', serverOnly: true};
function fakeClient(initial: CompanionStatus) {
  const normalize = (next: CompanionStatus) => next.paired ? {origin: config.origin, expiresAt: '2099-10-10T12:00:00Z', ...next} : next;
  let status = normalize(initial), changed = () => {};
  const send = vi.fn(async (message: CompanionMessage) => {
    if (message.type === 'chairs:pair-device') status = normalize({ok: true, paired: true, onboardingRequired: true});
    if (message.type === 'chairs:disconnect-device') status = {ok: true, paired: false};
    return status;
  });
  const client: CompanionPopupClient = {send, open: vi.fn(async () => {}), subscribe: listener => {changed = listener; return vi.fn();}};
  return {client, send, change: async (next: CompanionStatus) => {status = normalize(next); await act(async () => changed());}};
}

it('accepts pasted human codes while rejecting ambiguous characters and never exposes device tokens', async () => {
  const fake = fakeClient({ok: true, paired: false});
  render(<CompanionPopup client={fake.client} config={config} />);
  await screen.findByRole('heading', {name: 'Вход в расширение'});
  fireEvent.click(screen.getByText('У меня уже есть код из кабинета'));
  const input = screen.getByLabelText('Код из кабинета');
  fireEvent.change(input, {target: {value: '0GN-5TY'}});
  expect((screen.getByRole('button', {name: 'Войти по коду'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input, {target: {value: '4gn5ty'}});
  fireEvent.click(screen.getByRole('button', {name: 'Войти по коду'}));
  await screen.findByRole('heading', {name: 'Перед началом работы'});
  expect(fake.send).toHaveBeenCalledWith({type: 'chairs:pair-device', origin: config.origin, label: 'Chrome на этом компьютере', code: '4GN-5TY'});
  expect((screen.getByRole('button', {name: 'Продолжить'}) as HTMLButtonElement).disabled).toBe(true);
});

it('offers only the code while the cabinet is on loopback and requires setup after pairing', async () => {
  const fake = fakeClient({ok: true, paired: false, pendingLogin: {userCode: '4GN-5TY', verificationUri: `${config.origin}/#companion-connect=4GN-5TY`, expiresAt: '2099-10-10T12:00:00Z', phoneReachable: false}});
  render(<CompanionPopup client={fake.client} config={config} />);
  await screen.findByRole('heading', {name: 'Ваш код входа'});
  expect(screen.queryByRole('img', {name: 'QR-код для подтверждения входа в Chrome'})).toBeNull();
  expect(screen.getByText(/Для QR-входа с телефона нужен доступный адрес/)).toBeTruthy();
  expect(fake.client.open).not.toHaveBeenCalled();
  await fake.change({ok: true, paired: true, onboardingRequired: true, legalLinks: {termsUrl: `${config.origin}/legal/terms`, privacyUrl: `${config.origin}/legal/privacy`}});
  await screen.findByRole('heading', {name: 'Перед началом работы'});
  expect(screen.queryByRole('img', {name: 'QR-код для подтверждения входа в Chrome'})).toBeNull();
});

it('bundles a QR image for a reachable cabinet without opening the approval automatically', async () => {
  const fake = fakeClient({ok: true, paired: false, pendingLogin: {userCode: '4GN-5TY', verificationUri: 'https://example.test/#companion-connect=4GN-5TY', expiresAt: '2099-10-10T12:00:00Z', phoneReachable: true}});
  render(<CompanionPopup client={fake.client} config={{origin: 'https://example.test', serverOnly: true}} />);
  const image = await screen.findByRole('img', {name: 'QR-код для подтверждения входа в Chrome'});
  expect(image.getAttribute('src')).toMatch(/^data:image/);
  expect(fake.client.open).not.toHaveBeenCalled();
});

it('preserves the reconciliation warning after the popup is reopened', async () => {
  const fake = fakeClient({ok: true, paired: true, onboardingRequired: false, requiresReconciliation: true});
  render(<CompanionPopup client={fake.client} config={config} />);
  await screen.findByRole('heading', {name: 'Требуется сверка задания'});
  expect(screen.getByText(/Свернуть вкладку HH/)).toBeTruthy();
  expect(fake.send.mock.calls.every(([message]) => message.type === 'chairs:device-status')).toBe(true);
});

it('never mounts Local actions before both login and onboarding are explicitly complete', async () => {
  const fake = fakeClient({ok: true, paired: false});
  const state: LocalCompanionState = {application: null, page: null, matches: 0, total: 0, busy: false, message: '', error: '', connection: null};
  const create = vi.fn(async (): Promise<LocalCompanionController> => ({state, check: vi.fn(), load: vi.fn(), act: vi.fn()}));
  fake.client.createLocalController = create;
  render(<CompanionPopup client={fake.client} config={{...config, serverOnly: false}} />);
  await screen.findByRole('heading', {name: 'Вход в расширение'});
  expect(create).not.toHaveBeenCalled();
  await fake.change({ok: true, paired: true, onboardingRequired: true});
  await screen.findByRole('heading', {name: 'Перед началом работы'});
  expect(create).not.toHaveBeenCalled();
  await fake.change({ok: true, paired: true});
  expect(create).not.toHaveBeenCalled();
  await fake.change({ok: true, paired: true, onboardingRequired: false});
  await screen.findByRole('tab', {name: 'Личная очередь'});
  expect(create).not.toHaveBeenCalled();
  fireEvent.mouseDown(screen.getByRole('tab', {name: 'Личная очередь'}), {button: 0, ctrlKey: false});
  await screen.findByRole('heading', {name: 'Личная очередь на этом компьютере'});
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  await fake.change({ok: true, paired: false});
  expect(screen.queryByRole('heading', {name: 'Личная очередь на этом компьютере'})).toBeNull();
});

it('keeps Local staging in the existing controller and confirms cancellation explicitly', async () => {
  const fake = fakeClient({ok: true, paired: true, onboardingRequired: false});
  const state: LocalCompanionState = {application: {id: 'synthetic-local', title: 'Тестовая вакансия', status: 'pending', version: 3}, page: {url: 'https://hh.ru/vacancy/123'}, matches: 1, total: 1, busy: false, message: '', error: '', connection: null};
  const actLocal = vi.fn(async () => {});
  fake.client.createLocalController = vi.fn(async () => ({state, check: vi.fn(), load: vi.fn(), act: actLocal}));
  render(<CompanionPopup client={fake.client} config={{...config, serverOnly: false}} />);
  await screen.findByRole('tab', {name: 'Личная очередь'});
  fireEvent.mouseDown(screen.getByRole('tab', {name: 'Личная очередь'}), {button: 0, ctrlKey: false});
  await screen.findByText('Тестовая вакансия');
  fireEvent.click(screen.getByRole('button', {name: 'Подготовить эту заявку'}));
  await waitFor(() => expect(actLocal).toHaveBeenCalledWith('prepare', ''));
  fireEvent.click(screen.getByRole('button', {name: 'Отменить эту заявку в очереди'}));
  await screen.findByRole('alertdialog');
  expect(actLocal).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', {name: 'Отменить заявку'}));
  await waitFor(() => expect(actLocal).toHaveBeenCalledWith('reject', ''));
});

it('closes Local actions on a failed check and returns to the cabinet after recovery', async () => {
  const fake = fakeClient({ok: true, paired: true, onboardingRequired: false});
  fake.client.createLocalController = vi.fn(async () => ({state: {application: null, page: null, matches: 0, total: 0, busy: false, message: '', error: '', connection: null}, check: vi.fn(), load: vi.fn(), act: vi.fn()}));
  render(<CompanionPopup client={fake.client} config={{...config, serverOnly: false}} />);
  fireEvent.mouseDown(await screen.findByRole('tab', {name: 'Личная очередь'}), {button: 0, ctrlKey: false});
  await screen.findByRole('heading', {name: 'Личная очередь на этом компьютере'});
  await fake.change({ok: false, error: 'Связь потеряна'});
  await screen.findByRole('heading', {name: 'Не удалось проверить подключение'});
  expect(screen.queryByRole('tab', {name: 'Личная очередь'})).toBeNull();
  await fake.change({ok: true, paired: true, onboardingRequired: false});
  await screen.findByRole('heading', {name: 'Вход завершён'});
  expect(screen.getByRole('tab', {name: 'Кабинет'}).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByRole('heading', {name: 'Личная очередь на этом компьютере'})).toBeNull();
});

it('requires a separate confirmation to disconnect and preserves pairing when cancelled', async () => {
  const fake = fakeClient({ok: true, paired: true, onboardingRequired: false});
  render(<CompanionPopup client={fake.client} config={config} />);
  await screen.findByRole('heading', {name: 'Вход завершён'});
  fireEvent.click(screen.getByText('Управление подключением'));
  fireEvent.click(screen.getByRole('button', {name: 'Отключить расширение'}));
  await screen.findByRole('alertdialog');
  expect(fake.send.mock.calls.some(([message]) => message.type === 'chairs:disconnect-device')).toBe(false);
  fireEvent.click(screen.getByRole('button', {name: 'Отмена'}));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', {name: 'Отключить расширение'}));
  fireEvent.click(await screen.findByRole('button', {name: 'Отключить'}));
  await screen.findByRole('heading', {name: 'Вход в расширение'});
  expect(fake.send.mock.calls.filter(([message]) => message.type === 'chairs:disconnect-device')).toHaveLength(1);
});

it('resets every agreement when the public document revision changes during onboarding', async () => {
  const links = {termsUrl: `${config.origin}/legal/terms`, privacyUrl: `${config.origin}/legal/privacy`};
  const fake = fakeClient({ok: true, paired: true, onboardingRequired: true, onboardingVersion: '2026-10-10', legalLinks: links});
  render(<CompanionPopup client={fake.client} config={config} />);
  fireEvent.click(await screen.findByRole('switch', {name: 'Мне есть 18'}));
  for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  expect((screen.getByRole('button', {name: 'Продолжить'}) as HTMLButtonElement).disabled).toBe(false);
  await fake.change({ok: true, paired: true, onboardingRequired: true, onboardingVersion: '2026-10-11', legalLinks: links});
  expect(screen.getByRole('switch', {name: 'Мне есть 18'}).getAttribute('aria-checked')).toBe('false');
  for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox.getAttribute('aria-checked')).toBe('false');
  expect((screen.getByRole('button', {name: 'Продолжить'}) as HTMLButtonElement).disabled).toBe(true);
});

it('dismisses an obsolete cancellation dialog when a different login challenge arrives', async () => {
  const pending = {userCode: '4GN-5TY', verificationUri: `${config.origin}/#companion-connect=4GN-5TY`, expiresAt: '2099-10-10T12:00:00Z', phoneReachable: false};
  const fake = fakeClient({ok: true, paired: false, pendingLogin: pending});
  render(<CompanionPopup client={fake.client} config={config} />);
  await screen.findByRole('heading', {name: 'Ваш код входа'});
  fireEvent.click(screen.getByText('Управление подключением'));
  fireEvent.click(screen.getByRole('button', {name: 'Отменить вход'}));
  await screen.findByRole('alertdialog');
  await fake.change({ok: true, paired: false, pendingLogin: {...pending, userCode: '6PN-8TV', verificationUri: `${config.origin}/#companion-connect=6PN-8TV`}});
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(fake.send.mock.calls.some(([message]) => message.type === 'chairs:disconnect-device')).toBe(false);
  expect(screen.getByText('6PN-8TV')).toBeTruthy();
});
